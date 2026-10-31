// An engine process on a computer that joined the Space, on a booted daemon: the Space starts a process on the node over the node's live socket, feeds it input, reads its output and end, and
// kills it; a node that is not connected is refused with the server_off code; a node that goes away ends its processes. The node runs in this process (runComputeNode) with a launcher that starts
// a real child process; the Space's loopback address in the process's arguments is rewritten to the address the node joined by.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { runComputeNode } from "../src/compute/node.ts";
import type { NodeDeps, NodeLauncher, NodeProc } from "../src/compute/node.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER_TOKEN = "tok-usr_olivia";

type Reply = { status: number; json: { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

async function boot(): Promise<{ d: Daemon; dir: string }> {
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

/** A launcher that starts a real child process, as the node's sandboxed one would. */
function childLauncher(seen: { argv: string[][]; env: Record<string, string>[]; cwd: string[] }): NodeLauncher {
  return {
    async spawn(spec): Promise<NodeProc> {
      seen.argv.push([...spec.argv]); seen.env.push({ ...spec.env }); seen.cwd.push(spec.cwd ?? "");
      const [cmd, ...args] = spec.argv;
      const child = spawn(cmd!, args, { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
      let tail = "";
      child.stderr.setEncoding("utf8"); child.stderr.on("data", (c: string) => { tail = (tail + c).slice(-4096); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.once("close", (code, signal) => r({ code, signal })));
      await new Promise<void>((ok, bad) => { child.once("spawn", ok); child.once("error", bad); });
      return {
        pid: child.pid, stdout: child.stdout as AsyncIterable<Uint8Array>, exited, stderrTail: () => tail,
        write: (data) => new Promise<void>((ok, bad) => child.stdin.write(data, (e) => (e ? bad(e) : ok()))),
        endInput: () => { child.stdin.end(); }, kill: (sig = "SIGTERM") => { child.kill(sig); },
      };
    },
  };
}

async function enroll(d: Daemon, nodeDir: string, log: string[], launcher: NodeLauncher): Promise<{ nodeId: string; abort: AbortController; running: Promise<string> }> {
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

const text = async (it: AsyncIterable<Uint8Array>): Promise<string> => { let out = ""; for await (const c of it) out += Buffer.from(c).toString("utf8"); return out; };

test("the Space runs a process on an approved node: input goes in, output and the end come back, the loopback address is the node's server address, and a kill ends it", async () => {
  const { d, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-node-"));
  const log: string[] = [];
  const seen = { argv: [] as string[][], env: [] as Record<string, string>[], cwd: [] as string[] };
  const { nodeId, abort, running } = await enroll(d, nodeDir, log, childLauncher(seen));
  try {
    const prog = "process.stdin.on('data',c=>process.stdout.write('echo:'+c)).on('end',()=>{process.stdout.write('|'+process.env.SECRET+'|'+process.argv[1]);process.exit(3)})";
    const proc = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", prog, "http://127.0.0.1:8421/mcp/x"], env: { SECRET: "http://localhost:1/s" } });
    assert.ok(proc.pid !== undefined);
    await proc.write("hello ");
    await proc.write("node");
    proc.endInput();
    const out = await text(proc.stdout);
    const exit = await proc.exited;
    assert.ok(out.startsWith("echo:hello echo:node") || out.startsWith("echo:hello node"), out);
    assert.ok(out.includes(`|${d.url}/s|${d.url}/mcp/x`), `the Space's loopback address became the node's server address: ${out}`);
    assert.equal(exit.code, 3);
    assert.ok(seen.cwd[0]!.startsWith(path.join(nodeDir, "turns")), "the engine works in a folder of the node's own");
    assert.ok(log.some((l) => /engine prc_[a-f0-9]+ started/.test(l)) && log.some((l) => /engine prc_[a-f0-9]+ ended: 3/.test(l)), JSON.stringify(log));

    const long = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], env: {} });
    long.kill("SIGKILL");
    const killed = await long.exited;
    assert.equal(killed.signal, "SIGKILL");

    await assert.rejects(() => d.nodeRelay.spawnProc("srv_nobody", { argv: ["x"], env: {} }), (e) => (e as { code?: string }).code === "engine.server_off");
    const missing = childLauncher(seen);
    assert.ok(missing);
  } finally { abort.abort(); await running.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a node that is not running an engine launcher refuses, and a node that goes away ends the process it was running", async () => {
  const { d, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-node-"));
  const log: string[] = [];
  const seen = { argv: [] as string[][], env: [] as Record<string, string>[], cwd: [] as string[] };
  const { nodeId, abort, running } = await enroll(d, nodeDir, log, childLauncher(seen));
  try {
    const proc = await d.nodeRelay.spawnProc(nodeId, { argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], env: {} });
    await assert.rejects(() => d.nodeRelay.spawnProc(nodeId, { argv: ["definitely-not-installed-xyz"], env: {} }).then(() => { throw new Error("started"); }), (e) => (e as { code?: string }).code !== undefined);
    abort.abort();
    await running.catch(() => undefined);
    const gone = await proc.exited;
    assert.ok(gone.code === null, "the process ended as killed when its node went away");
    await assert.rejects(() => d.nodeRelay.spawnProc(nodeId, { argv: ["x"], env: {} }), (e) => (e as { code?: string }).code === "engine.server_off");
  } finally { abort.abort(); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
