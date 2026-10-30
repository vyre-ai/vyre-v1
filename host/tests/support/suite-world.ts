// A booted daemon for the Google Workspace and Microsoft 365 live tests: the real gateway, the real Vault, mail, inbox, calendar, meetings, files and mounts modules, and a stand-in for the
// provider's APIs. The provider side is a scripted `fetch` (the module's ctx.http egress) plus a token endpoint (the seam's fetch); nothing leaves the machine and no account is touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../src/platform/index.ts";
import type { FetchFn } from "../../src/platform/probes.ts";
import { loadConfig } from "../../src/daemon/config.ts";
import { startDaemon } from "../../src/daemon/daemon.ts";

export const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

export const OWNER = "tok-usr_olivia";
export const MEMBER = "tok-usr_noah";
export const OTHER = "tok-usr_mia";
const WHO: Record<string, string> = { [OWNER]: "usr_olivia", [MEMBER]: "usr_noah", [OTHER]: "usr_mia" };

/** Provider answers for the module's egress (ctx.http): a status, a JSON body or text. */
export type Answer = { status?: number; json?: unknown; text?: string } | undefined;
export type ProviderApi = (req: { method: string; url: string; headers: Record<string, string>; body: string | undefined }) => Answer | Promise<Answer>;
/** The seam's fetch: the token endpoint and the byte transfers. */
export type SeamApi = (req: { method: string; url: string; headers: Record<string, string>; body: string | Uint8Array | undefined }) => Answer | Promise<Answer>;

export interface WorldOptions {
  /** the provider's APIs behind ctx.http */
  api: ProviderApi;
  /** the token endpoint and transfers behind the seam fetch */
  seam: SeamApi;
  /** what the Vault port returns for a handle (the seam reads the key from here), and how it signs */
  secrets: Record<string, string>;
  sign?: (data: string) => string;
  /** every Space member with a work address (what the seams map by email) */
  members: { userId: string; email: string }[];
  prefix: string;
  /** boot over an existing data directory (a restart) instead of a fresh seeded one */
  dir?: string;
}

export interface Req { method: string; url: string }

export async function bootWorld(o: WorldOptions) {
  let dir = o.dir;
  if (!dir) {
    const core = bootCore();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-${o.prefix}-`));
    core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
    fs.copyFileSync(core.file, path.join(dir, "events.db"));
    core.close();
  }
  const dataDir = dir;
  const seen: Req[] = [];
  const reply = (a: Answer) => {
    const status = a?.status ?? (a === undefined ? 404 : 200);
    const body = a?.text ?? (a?.json === undefined ? (a === undefined ? JSON.stringify({ error: { code: 404, errors: [{ reason: "notFound" }] } }) : "") : JSON.stringify(a.json));
    return { status, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: () => null as string | null } };
  };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dataDir, "--port", "0", "--address", "https://space.firm.test"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: `${o.prefix}-live`, free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dataDir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    http: async (url, init) => {
      seen.push({ method: init?.method ?? "GET", url });
      return reply(await o.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body }));
    },
    vault: {
      secret: async (handle: string) => {
        const v = o.secrets[handle];
        if (v === undefined) throw new Error("no such item");
        return v;
      },
      signRs256: async (_h: string, _s: string, data: string) => (o.sign ?? (() => "c2lnbmF0dXJl"))(data),
    },
    seams: {
      fetch: async (url, init) => {
        seen.push({ method: init?.method ?? "GET", url });
        return reply(await o.seam({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body }));
      },
      members: { emails: async () => o.members },
      drivers: { setVaultKeyPort: () => ({ personKey: async (person: string) => (person === "usr_olivia" ? Buffer.alloc(32, 7) : null) }) },
    },
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] ?? "";
      const who = WHO[t];
      return who === undefined ? null : { space: CORE_SPACE, principal: { kind: "person", id: who }, device: `${o.prefix}-live` };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const call = async (token: string, cap: string, input: unknown = {}) => {
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    let body: { data?: any; error?: { code?: string; message?: string } } = {};
    try { body = JSON.parse(text) as typeof body; } catch { /* not JSON */ }
    return { status: r.status, data: body.data, error: body.error, text };
  };
  /** A call that must succeed. */
  const ok = async (token: string, cap: string, input: unknown = {}) => {
    const r = await call(token, cap, input);
    if (r.status !== 200) {
      const trace = /"traceId":"([0-9a-f]+)"/.exec(r.text)?.[1];
      let logs = "";
      if (trace) { d.sink.flush(); logs = ` | log: ${JSON.stringify(d.sink.trace(trace).logs.map((l) => [l.msg, l.attrs]))}`; }
      throw new Error(`${cap} answered ${r.status}: ${r.text}${logs}`);
    }
    return r.data;
  };
  let key = 0;
  const idem = (): string => `${o.prefix}-${++key}`;
  return {
    d, dir: dataDir, seen, call, ok, idem,
    async stop(keep = false) { await d.stop(); if (!keep) fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}
export type World = Awaited<ReturnType<typeof bootWorld>>;
