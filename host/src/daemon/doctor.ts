// `vyre-server doctor` (ARCH 7.10): works with the gateway down. It reads the data directory and nothing else: events.db opened read-only (hash chain re-verified), logs.db opened read-only, modules.db read-only for the Space's own domain (its Caddy route is checked),
// the pid file, the disk and the machine. It never starts, signals or writes anything, so it is safe to run on a broken server. Keys and next steps match the health module's checks
// (health.doctor answers the same findings from inside the gateway).
import fs from "node:fs";
import { genesis, hashOf } from "../../../kernel/src/log/index.ts";
import { hostOf, ingressHostOf, routesOf } from "../caddy/routes.ts";
import type { Envelope } from "../../../kernel/src/log/index.ts";
import { nodePlatform } from "../platform/index.ts";
import type { Platform } from "../platform/index.ts";
import * as probes from "../platform/probes.ts";
import type { FetchFn, ProbeResult } from "../platform/probes.ts";
import { alive, pathsFor, readInfo } from "./config.ts";
import { NEXT, OK } from "./doctor-next.ts";
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
  /** what the person chose about disk encryption at install */
  diskChoice?: { kind: string; since?: string };
  /** Docker's data root as the host sees it: agent browser sign-ins live in Docker volumes there */
  dockerRoot?: { dir: string; state: string };
}

const finding = (key: string, r: ProbeResult, next: string): Finding => ({ key, state: r.state, detail: r.detail ?? "", next: r.state === "healthy" ? OK : next });

/** The next step for the disk check: a recorded choice has its own (the person is not told to do what they decided not to, or to enable what they said is on). */
export function diskNext(detail: string | undefined): string {
  const d = detail ?? "";
  if (d.startsWith("Not verified: your provider's encryption")) return NEXT.diskProvider;
  if (d.startsWith("The data is NOT encrypted at rest")) return NEXT.diskPlain;
  return NEXT.disk;
}

/**
 * Docker's data root, as the host reported it: encrypted, plain, or unknown (the host cannot look at it: Docker in a virtual machine as on a Mac, or a root it cannot resolve). Agent browser sign-ins, the Chrome
 * profiles of agent computers and of the Space browser, are stored unsealed in Docker volumes there (nothing in this version seals them; the hook in modules/computers is not supplied), so only that disk's
 * encryption protects them. A finding of its own; it only reports.
 */
export function dockerRootFinding(root: { dir: string; state: string } | undefined, dataVerified: boolean, choice: string | undefined): Finding | null {
  if (!root) return null;
  const key = "host.docker_root";
  const unsealed = "Agent browser sign-ins (agent computers' and the Space browser's Chrome profiles) are stored unsealed in Docker volumes";
  if (root.state === "encrypted") return { key, state: "healthy", detail: `Docker's data root ${root.dir} is on an encrypted volume (verified by the host). ${unsealed} there; that disk's encryption protects them.`, next: OK };
  if (root.state === "unknown") return { key, state: "degraded", detail: `Could not tell whether Docker's data root (${root.dir}) is encrypted: it is not a disk this server can look at (as when Docker runs in a virtual machine, as on a Mac, where FileVault covers that machine's disk image). ${unsealed} there.`, next: NEXT.dockerRootUnknown };
  if (dataVerified) return { key, state: "degraded", detail: `Docker's data root (${root.dir}) is not on an encrypted volume, but the Space's data is. ${unsealed} there, so they are not encrypted at rest.`, next: NEXT.dockerRoot };
  if (choice === "plain") return { key, state: "degraded", detail: `${unsealed} on Docker's disk (${root.dir}), which is not encrypted at rest (the plain-disk choice you made covers it).`, next: NEXT.dockerRoot };
  if (choice === "provider") return { key, state: "degraded", detail: `Not verified: ${unsealed.charAt(0).toLowerCase()}${unsealed.slice(1)} on Docker's disk (${root.dir}). Your provider's encryption, as you stated, covers them only if Docker's data root is on that volume.`, next: NEXT.dockerRoot };
  return { key, state: "degraded", detail: `${unsealed} on Docker's disk (${root.dir}), which is not verified encrypted.`, next: NEXT.dockerRoot };
}

export interface ChainResult { ok: boolean; seq: number; why?: string }

/** Re-verify the hash chain of an events.db opened read-only: contiguous seq, prev links, envelope hashes, and the head the last commit recorded. `tail` checks only the last that-many events, linked
 * from the hash of the event before them, so the container health check stays fast on a Space with a long history (a full pass over 400,000 events took 12 s and the check gives the doctor 8). */
export function verifyChainReadOnly(file: string, tail?: number): ChainResult {
  const db = openDb(file, { readOnly: true });
  try {
    const meta = (key: string): string | undefined => (db.all("SELECT value FROM log_meta WHERE key = ?", key)[0] as { value?: string } | undefined)?.value;
    const space = meta("space");
    if (!space) return { ok: false, seq: 0, why: "the file has no Space id, so it is not an event log" };
    let prev = genesis(space), n = 0;
    if (tail !== undefined && tail > 0) {
      const head = Number((db.all("SELECT MAX(seq) AS n FROM events")[0] as { n: number | null } | undefined)?.n ?? 0);
      const from = Math.max(0, head - tail);
      if (from > 0) {
        const row = db.all("SELECT event FROM events WHERE seq = ?", from)[0] as { event: string } | undefined;
        if (!row) return { ok: false, seq: 0, why: `seq is not contiguous at ${from}` };
        try { prev = (JSON.parse(row.event) as Envelope).hash; } catch { return { ok: false, seq: from - 1, why: `event ${from} is not JSON` }; }
        n = from;
      }
    }
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

function eventsFinding(file: string, tail?: number): Finding {
  if (!fs.existsSync(file)) return { key: "kernel.events_db", state: "degraded", detail: "There is no event log in this data directory yet.", next: "Start the server once so it creates the Space, or point --data-dir at the right folder." };
  try {
    const r = verifyChainReadOnly(file, tail);
    return r.ok ? { key: "kernel.events_db", state: "healthy", detail: `Chain verifies through event ${r.seq}.`, next: OK } : { key: "kernel.events_db", state: "down", detail: `The event log failed verification: ${r.why ?? "unknown reason"}.`, next: NEXT.events };
  } catch (e) {
    return { key: "kernel.events_db", state: "down", detail: `events.db cannot be opened read-only: ${e instanceof Error ? e.message : String(e)}`, next: NEXT.events };
  }
}

function logsFinding(file: string, now: number): Finding {
  if (!fs.existsSync(file)) return { key: "logs.errors", state: "healthy", detail: "No log file yet.", next: OK };
  try {
    // logs.db is WAL: with no -wal beside it the daemon closed it and nothing writes it, so it is read as it is and no journal files are made in the data directory
    const db = openDb(file, fs.existsSync(`${file}-wal`) ? { readOnly: true } : { immutable: true });
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

/** The own-domain address the Space recorded in modules.db (network_config), or null for a relay Space, a Space with no address, or no modules.db yet. Read-only, like the rest. */
function ownDomain(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    const db = openDb(file, fs.existsSync(`${file}-wal`) ? { readOnly: true } : { immutable: true });
    try {
      const row = db.all("SELECT address, mode FROM network_config WHERE id = 1")[0] as { address?: string; mode?: string } | undefined;
      return row?.mode === "own_domain" ? ingressHostOf(row.address) : null;
    } finally { db.close(); }
  } catch { return null; }   // no network table yet: nothing to check
}

/** A Space with its own domain needs its route in Caddy, or https://<domain>/ refuses connections (the claim link included). */
async function ingressFinding(host: string, f: FetchFn | null, adminUrl: string): Promise<Finding> {
  const key = "host.ingress";
  if (!f) return { key, state: "degraded", detail: `Could not check the route for ${host}: no HTTP client to reach the Caddy admin API.`, next: NEXT.ingress };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    timer.unref();
    const r = await f(`${adminUrl.replace(/\/$/, "")}/config/`, { signal: ctl.signal, headers: { origin: new URL(adminUrl).origin } }).finally(() => clearTimeout(timer));
    if (!r.ok) return { key, state: "degraded", detail: `Could not check the route for ${host}: Caddy admin answered ${r.status}.`, next: NEXT.caddy };
    const text = (await r.text()).trim();
    const config = text && text !== "null" ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    return routesOf(config).map(hostOf).includes(host)
      ? { key, state: "healthy", detail: `Caddy routes ${host} to vyred.`, next: OK }
      : { key, state: "down", detail: `Caddy has no route for ${host}, so https://${host}/ refuses connections.`, next: NEXT.ingress };
  } catch {
    return { key, state: "degraded", detail: `Could not check the route for ${host}: the Caddy admin API does not answer.`, next: NEXT.caddy };
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
  const disk = await (o.diskEncrypted ? o.diskEncrypted() : probes.diskEncrypted(platform, o.dataDir, o.diskChoice));
  findings.push(finding("host.disk_encrypted", disk, diskNext(disk.detail)));
  const root = dockerRootFinding(o.dockerRoot, o.diskChoice?.kind === "detected", o.diskChoice?.kind);
  if (root) findings.push(root);
  findings.push(finding("host.disk_space", probes.diskSpace(platform, o.dataDir), NEXT.space));
  if (space) {
    findings.push(eventsFinding(paths.events, o.chainTail));
    findings.push(finding("host.docker", await probes.docker(platform), NEXT.docker));
    const f = o.fetch === undefined ? (typeof fetch === "function" ? (fetch as unknown as FetchFn) : null) : o.fetch;
    findings.push(finding("host.caddy", f ? await probes.caddy(f, o.caddyAdmin ?? "http://127.0.0.1:2019", now) : { state: "down", detail: "No HTTP client to reach the Caddy admin API." }, NEXT.caddy));
    const domain = ownDomain(paths.modules);
    if (domain) findings.push(await ingressFinding(domain, f, o.caddyAdmin ?? "http://127.0.0.1:2019"));
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
