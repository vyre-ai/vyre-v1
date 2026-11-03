// The booted daemon the daemon.boot tests share (daemon.boot.test.ts and daemon.boot.wiring.test.ts): the example.echo capability, a seeded data directory, the machine as a
// recorded platform, a recording network port, the boot and the HTTP helpers. Each test boots its own daemon from it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NewEvent } from "../../kernel/src/log/types.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { processUnit } from "../src/supervisor/index.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import type { NetworkPort } from "../src/daemon/commands.ts";

export const echoCap = {
  name: "example.echo", v: 1, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: ["example.said"],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Echo",
} as unknown as CapabilityDef;
export const echoRoute = { method: "POST", path: "/v1/example/echo", cap: "example.echo", v: 1, effects: "write" as const };
export const echoHandler = (ctx: { emit(n: never, s: string, p: unknown): unknown }, input: unknown): unknown => { ctx.emit("example.said" as never, "echo:1", input); return input; };

export const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

type SeedCore = { store: { appendBatch(e: NewEvent[]): { ok: boolean }[]; db: { exec(sql: string): void } }; file: string; close(): void };

/** A data directory holding a copy of the seeded core Space's events.db. `bootCore` is fixtures/seed/core's (a test passes it: only a test file may import the fixtures). */
export const seededDirFrom = (bootCore: () => SeedCore) => (extra: NewEvent[] = []): string => {
  const core = bootCore();
  const appended = core.store.appendBatch(extra);
  if (appended.some((r) => !r.ok)) throw new Error("could not build the seeded test log");
  const dir = tmp("vyre-daemon-boot-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
};

/** The machine as a recorded platform: encrypted volume, Docker answering. */
export function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "boot-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
export const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A network port that records what the daemon asked of it. */
export function recordingNetwork() {
  const calls: string[] = [];
  const port: NetworkPort = {
    checkDns: (d) => { calls.push(`dns ${d}`); return Promise.resolve({ ok: true, records: [{ type: "CNAME", name: d, value: "relay.vyre.run" }] }); },
    applyAddress: (a) => { calls.push(`apply ${a.mode} ${a.address}`); return Promise.resolve(); },
    renew: (h) => { calls.push(`renew ${h}`); return Promise.resolve({ expiresAt: 1_900_000_000_000 }); },
    reconnect: (id) => { calls.push(`reconnect ${id}`); return Promise.resolve("healthy" as const); },
    disconnect: (id) => { calls.push(`disconnect ${id}`); return Promise.resolve(); },
  };
  return { port, calls };
}

export async function boot(dir: string, extra: { network?: NetworkPort } = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "space.example.com"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch, ...(extra.network ? { network: extra.network } : {}),
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    services: [{ name: "sidecar", start: processUnit(process.execPath, ["-e", "setInterval(() => {}, 1000)"]) }],
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000 },
  });
}

export const post = (d: Daemon, p: string, body: unknown, token: string | null = d.token) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
/** A keep-alive socket to a server that was just restarted can be stale: try once more on a fresh one. */
export const twice = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch { return f(); } };
export const one = (d: Daemon, sql: string, ...a: unknown[]): Record<string, unknown> => (d.db!.all(sql, ...a)[0] ?? {}) as Record<string, unknown>;
