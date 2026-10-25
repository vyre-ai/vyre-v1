// Shared by the L11 golden steps (flows 2, 9, 11, 12): a booted daemon on the frozen `core` seed, driven the way a person is, through the gateway with real tokens (rule 27).
// No handler is called directly and no module is replaced: `live` names the modules that are flipped to live in a temporary code root (a copy of host/modules.json), so a flow
// shows what a real boot does once the owning lane flips its modules. Whatever refuses to boot or answers internal.not_implemented is a gap, reported by the caller.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routes } from "../../generated/routes.ts";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { issueSessionToken } from "../../host/src/daemon/session.ts";
import type { Observed } from "../harness/index.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A code root that is this repo with the named modules live: every top-level entry a symlink, host/ rebuilt around an edited modules.json. */
export function codeRootWithLive(live: readonly string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-golden-root-"));
  for (const name of fs.readdirSync(REPO)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(REPO, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(REPO, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(REPO, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(REPO, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  for (const id of live) {
    const m = list.modules.find((x) => x.id === id);
    if (!m) throw new Error(`host/modules.json does not list ${id}`);
    m.status = "live";
  }
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-golden-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** The path of a capability, from the generated route table. */
export function routeOf(cap: string): string {
  const r = routes.find((x) => x.cap === cap);
  if (!r) throw new Error(`no route for ${cap}`);
  return r.path;
}

export interface Reply { status: number; body: any; trace: string | null }
export interface FlowSpace {
  d: Daemon;
  /** One fixed trace id for the whole flow, sent on every call (ARCH 4.9), so the events can be asserted to share it. */
  trace: string;
  /** POST /v1/<capability path> with a bearer token (null: anonymous). */
  call(cap: string, token: string | null, body?: unknown): Promise<Reply>;
  /** A device session for a person who exists in the seed (what sign-in writes), and its bearer token. */
  signedIn(person: string, device?: string): string;
  /** Every event in the log, optionally only those of this flow's trace. */
  events(onlyTrace?: boolean): Promise<Observed[]>;
  stop(): Promise<void>;
}

/** Boots a daemon on the `core` seed with `live` flipped in a temporary code root. Rejects with the host's own refusal text when the boot is refused. */
export async function bootFlowSpace(live: readonly string[]): Promise<FlowSpace> {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithLive(live),
    platform: fakePlatform({
      os: "linux", hostname: "golden", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  const trace = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  let n = 0;
  return {
    d, trace,
    async call(cap, token, body = {}) {
      const res = await fetch(`${d.url}${routeOf(cap)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vyre-trace": `${trace}-${(++n).toString(16).padStart(16, "0")}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { status: res.status, body: parsed, trace: res.headers.get("x-vyre-trace") };
    },
    signedIn(person, device = `dev_${person.slice(4)}1`) {
      const now = Date.now(), session = `ses_${person.slice(4)}1`;
      d.db!.run(`INSERT OR IGNORE INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, device, person, `${person} laptop`, now, now);
      d.db!.run(`INSERT OR IGNORE INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, session, person, device, now, now);
      return issueSessionToken(d.db!, session);
    },
    async events(onlyTrace = true) {
      const all = await d.log!.read({ limit: 5000, ...(onlyTrace ? { trace_id: trace } : {}) });
      return all.map((e) => ({ type: e.type, traceId: e.trace_id }));
    },
    stop: () => d.stop(),
  };
}

/** The steps of a flow, run in order. A step that throws is recorded and the steps after it that need its result are skipped, so one run prints every independent failure. */
export class Trail {
  readonly lines: string[] = [];
  readonly failures: string[] = [];
  private readonly vals = new Map<string, unknown>();

  /** Runs one step. Returns its value, or undefined when it failed (or when `needs` names a step that did not produce a value). */
  async step<T>(name: string, fn: () => Promise<T> | T, needs: readonly string[] = []): Promise<T | undefined> {
    const missing = needs.filter((n) => !this.vals.has(n));
    if (missing.length) { this.lines.push(`skip  ${name} (needs ${missing.join(", ")})`); return undefined; }
    try {
      const v = await fn();
      this.vals.set(name, v);
      this.lines.push(`ok    ${name}`);
      return v;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.failures.push(`${name}: ${msg}`);
      this.lines.push(`FAIL  ${name}: ${msg}`);
      return undefined;
    }
  }

  report(): string { return this.lines.join("\n"); }
}

export const short = (x: unknown): string => JSON.stringify(x).slice(0, 300);
/** Throws unless the reply has the status; the message carries the error code and text so a gap names itself. */
export function expectStatus(r: Reply, status: number, what: string): any {
  if (r.status !== status) throw new Error(`${what}: expected ${status}, got ${r.status} ${short(r.body?.error ?? r.body)}`);
  return r.body?.data;
}

/** A known reason a flow cannot pass yet: the packet that owns the fix, its lane, and what is missing. A flow with gaps runs as a node:test todo (it still runs and prints its trail). */
export interface Gap { packet: string; lane: string; what: string }

/** The `todo` option for node:test: the gaps in one line, or false when the flow has none. */
export const todoOf = (gaps: readonly Gap[]): string | false => (gaps.length ? gaps.map((g) => `${g.packet} (${g.lane}): ${g.what}`).join("; ") : false);

/** The steps that must be ok whatever the gaps are (they are real, passing proof). */
export function okSteps(trail: Trail): string[] {
  return trail.lines.filter((l) => l.startsWith("ok    ")).map((l) => l.slice(6));
}
