// `vyre-server doctor` (ARCH 7.10): works with the gateway down. It reads the data directory and nothing else: events.db opened read-only (hash chain re-verified), logs.db opened read-only,
// the pid file, the disk and the machine. It never starts, signals or writes anything, so it is safe to run on a broken server. Keys and next steps match the health module's checks
// (health.doctor answers the same findings from inside the gateway).
import fs from "node:fs";
import { genesis, hashOf } from "../../../kernel/src/log/index.ts";
import type { Envelope } from "../../../kernel/src/log/index.ts";
import { nodePlatform } from "../platform/index.ts";
import type { Platform } from "../platform/index.ts";
import * as probes from "../platform/probes.ts";
import type { FetchFn, ProbeResult } from "../platform/probes.ts";
import { alive, pathsFor, readInfo } from "./config.ts";
import { openDb } from "./sqlite.ts";

export interface Finding { key: string; state: "healthy" | "degraded" | "down"; detail: string; next: string }
export interface DoctorReport { ok: boolean; dataDir: string; findings: Finding[] }
export interface DoctorOptions {
  dataDir: string;
  /** device = no event log, Docker or Caddy to check */
  role?: "space" | "device";
  platform?: Platform;
  fetch?: FetchFn | null;
  caddyAdmin?: string;
  now?: () => number;
  /** replace the disk check (recorded-output version from P-L7b_04) */
  diskEncrypted?: () => Promise<ProbeResult>;
}

const OK = "No action needed.";
const NEXT = {
  process: "Start it with vyre server start.",
  disk: "Enable FileVault or LUKS for the data directory, then run vyre-server doctor.",
  space: "Free disk space or extend the volume.",
  events: "Restore from the last backup (Console, Data, Backups), then run vyre-server doctor again.",
  docker: "Start Docker or Colima; sites and agent computers need it.",
  caddy: "Restart Caddy in Console, Infrastructure, Services.",
  logs: "Read them with vyre logs --level error.",
} as const;

const finding = (key: string, r: ProbeResult, next: string): Finding => ({ key, state: r.state, detail: r.detail ?? "", next: r.state === "healthy" ? OK : next });

export interface ChainResult { ok: boolean; seq: number; why?: string }

/** Re-verify the whole hash chain of an events.db opened read-only: contiguous seq, prev links, envelope hashes, and the head the last commit recorded. */
export function verifyChainReadOnly(file: string): ChainResult {
  const db = openDb(file, { readOnly: true });
  try {
    const meta = (key: string): string | undefined => (db.all("SELECT value FROM log_meta WHERE key = ?", key)[0] as { value?: string } | undefined)?.value;
    const space = meta("space");
    if (!space) return { ok: false, seq: 0, why: "the file has no Space id, so it is not an event log" };
    let prev = genesis(space), n = 0;
    for (;;) {
      const rows = db.all("SELECT seq, event FROM events WHERE seq > ? ORDER BY seq LIMIT 500", n) as { seq: number; event: string }[];
      if (!rows.length) break;
      for (const r of rows) {
        let e: Envelope;
        try { e = JSON.parse(r.event) as Envelope; } catch { return { ok: false, seq: n, why: `event ${r.seq} is not JSON` }; }
        n++;
        if (r.seq !== n || e.seq !== n) return { ok: false, seq: n - 1, why: `seq is not contiguous at ${n}` };
        if (e.prev !== prev) return { ok: false, seq: n - 1, why: `event ${n} does not follow the one before it` };
        if (hashOf(e) !== e.hash) return { ok: false, seq: n - 1, why: `event ${n} was changed after it was written` };
        prev = e.hash;
      }
    }
    const recorded = Number(meta("head_seq") ?? 0);
    if (n < recorded) return { ok: false, seq: n, why: `the log has ${n} events but ${recorded} were recorded` };
    return { ok: true, seq: n };
  } finally { db.close(); }
}

function eventsFinding(file: string): Finding {
  if (!fs.existsSync(file)) return { key: "kernel.events_db", state: "degraded", detail: "There is no event log in this data directory yet.", next: "Start the server once so it creates the Space, or point --data-dir at the right folder." };
  try {
    const r = verifyChainReadOnly(file);
    return r.ok ? { key: "kernel.events_db", state: "healthy", detail: `Chain verifies through event ${r.seq}.`, next: OK } : { key: "kernel.events_db", state: "down", detail: `The event log failed verification: ${r.why ?? "unknown reason"}.`, next: NEXT.events };
  } catch (e) {
    return { key: "kernel.events_db", state: "down", detail: `events.db cannot be opened read-only: ${e instanceof Error ? e.message : String(e)}`, next: NEXT.events };
  }
}

function logsFinding(file: string, now: number): Finding {
  if (!fs.existsSync(file)) return { key: "logs.errors", state: "healthy", detail: "No log file yet.", next: OK };
  try {
    const db = openDb(file, { readOnly: true });
    try {
      const since = now - 86_400_000;
      const total = (db.all("SELECT COUNT(*) AS n FROM logs WHERE level >= 40 AND at >= ?", since)[0] as { n: number }).n;
      if (!total) return { key: "logs.errors", state: "healthy", detail: "No errors in the last 24 hours.", next: OK };
      const top = db.all("SELECT msg, COUNT(*) AS n FROM logs WHERE level >= 40 AND at >= ? GROUP BY msg ORDER BY n DESC LIMIT 3", since) as { msg: string; n: number }[];
      return { key: "logs.errors", state: "degraded", detail: `${total} errors in the last 24 hours (${top.map((t) => `${t.msg} x${t.n}`).join(", ")}).`, next: NEXT.logs };
    } finally { db.close(); }
  } catch (e) {
    return { key: "logs.errors", state: "degraded", detail: `logs.db cannot be read: ${e instanceof Error ? e.message : String(e)}`, next: NEXT.logs };
  }
}

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const platform = o.platform ?? nodePlatform();
  const now = o.now ?? Date.now;
  const paths = pathsFor(o.dataDir);
  const space = (o.role ?? "space") === "space";
  const findings: Finding[] = [];

  const info = readInfo(paths);
  findings.push(info && alive(info.pid)
    ? { key: "daemon.process", state: "healthy", detail: `vyred runs as pid ${info.pid} on ${info.url}.`, next: OK }
    : { key: "daemon.process", state: "degraded", detail: "vyred is not running.", next: NEXT.process });
  findings.push(finding("host.disk_encrypted", await (o.diskEncrypted ? o.diskEncrypted() : probes.diskEncrypted(platform, o.dataDir)), NEXT.disk));
  findings.push(finding("host.disk_space", probes.diskSpace(platform, o.dataDir), NEXT.space));
  if (space) {
    findings.push(eventsFinding(paths.events));
    findings.push(finding("host.docker", await probes.docker(platform), NEXT.docker));
    const f = o.fetch === undefined ? (typeof fetch === "function" ? (fetch as unknown as FetchFn) : null) : o.fetch;
    findings.push(finding("host.caddy", f ? await probes.caddy(f, o.caddyAdmin ?? "http://127.0.0.1:2019", now) : { state: "down", detail: "No HTTP client to reach the Caddy admin API." }, NEXT.caddy));
  }
  findings.push(logsFinding(paths.logs, now()));
  return { ok: findings.every((x) => x.state === "healthy"), dataDir: o.dataDir, findings };
}

/** The text `vyre-server doctor` prints: one line per check, the next step under each one that is not healthy. */
export function formatDoctor(r: DoctorReport): string {
  const width = Math.max(...r.findings.map((f) => f.key.length));
  const lines = r.findings.flatMap((f) => [`${f.state.padEnd(8)} ${f.key.padEnd(width)}  ${f.detail}`, ...(f.state === "healthy" ? [] : [`${" ".repeat(9)}${" ".repeat(width)}  Next: ${f.next}`])]);
  return `${lines.join("\n")}\n${r.ok ? "Everything checks out." : "Some checks need attention."}\n`;
}
