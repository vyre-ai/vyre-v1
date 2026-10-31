// Shared by the tests of engine processes on a computer that joined the Space: a seeded Personal Space with the owner signed in (injected session), and a node that enrolls, is approved and holds its
// live socket. The node runs in this process (runComputeNode) with a launcher the test supplies.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { runComputeNode } from "../src/compute/node.ts";
import type { NodeDeps, NodeLauncher } from "../src/compute/node.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const OWNER_TOKEN = "tok-usr_olivia";

export type Reply = { status: number; json: { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
export const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

/** `bootCore` is the seeded Space of fixtures/seed/core (a test passes it: only a test file may import the fixtures). */
export async function boot(bootCore: () => { store: { db: { exec(sql: string): void } }; file: string; close(): void }): Promise<{ d: Daemon; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-space-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "relay-space", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, computeLeaseMs: 700,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  return { d, dir };
}

export async function enroll(d: Daemon, nodeDir: string, log: string[], launcher: NodeLauncher): Promise<{ nodeId: string; abort: AbortController; running: Promise<string> }> {
  const abort = new AbortController();
  const deps = (join?: string): NodeDeps => ({
    server: d.url, join, dataDir: nodeDir, name: "relay-node", signal: abort.signal, now: Date.now, pollMs: 100,
    fetch: (url, init) => fetch(url, init) as never,
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
    log: (line) => { log.push(line); }, facts: () => ({ os: "linux", arch: "x64", docker: false, version: "t" }),
    cliLauncher: launcher,
  });
  const made = await post(d, "/v1/network/my_computer_code", { nickname: "relay-box", idempotencyKey: "rc-1" }, OWNER_TOKEN);
  const running = runComputeNode(deps(made.json.data.code as string));
  let waiting: { serverId: string } | undefined;
  for (let i = 0; i < 100 && !waiting; i++) { waiting = (await post(d, "/v1/network/my_computers", {}, OWNER_TOKEN)).json.data?.computers.find((c: { enrollment: string }) => c.enrollment === "pending"); if (!waiting) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(waiting, "the server shows as waiting");
  assert.equal((await post(d, "/v1/network/my_computer_approve", { serverId: waiting!.serverId }, OWNER_TOKEN)).status, 200);
  for (let i = 0; i < 100 && !d.nodeRelay.connected(waiting!.serverId); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(d.nodeRelay.connected(waiting!.serverId), "the node's live socket is up");
  return { nodeId: waiting!.serverId, abort, running };
}

