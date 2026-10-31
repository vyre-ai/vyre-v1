// A Personal Space with a server of its own, on a booted daemon (C1 and C3 of the computers design): the owner makes a join code with a nickname, the server enrolls and is approved by the owner,
// reports in, and becomes a place an agent computer can run. An agent's computer is provisioned on it, and a private chat pinned to it routes there; a chat is never routed to a server that is
// not the asker's. The server here runs in this process (runComputeNode) with a stand-in for Docker, which this machine may not have.
import test from "node:test";
import assert from "node:assert/strict";
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
import type { NodeDeps } from "../src/compute/node.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

type Reply = { status: number; json: { data?: any; error?: { code: string; message: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (d: Daemon, p: string, body: unknown, token?: string): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Reply["json"] };
};

const OWNER_TOKEN = "tok-usr_olivia";

/** The seeded Space started as a Personal one, with the owner already signed in (the sign-in itself is not what this test is about). */
async function boot(): Promise<{ d: Daemon; owner: string; dir: string }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-personal-space-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "personal-space", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch, computeLeaseMs: 700,
    session: (h) => (/^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER_TOKEN ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "mac" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  return { d, owner: OWNER_TOKEN, dir };
}

function node(d: Daemon, dataDir: string, executed: string[]) {
  const abort = new AbortController();
  const deps = (join?: string): NodeDeps => ({
    server: d.url, join, dataDir, name: "ubuntu-8gb-fsn1", signal: abort.signal, now: Date.now, pollMs: 100,
    fetch: (url, init) => fetch(url, init) as never,
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
    log: () => undefined, facts: () => ({ os: "linux", arch: "x64", docker: true, version: "t" }),
    makeHost: () => ({
      async run(kind) {
        executed.push(kind);
        if (kind === "create") return { diskBytes: 1024 };
        if (kind === "stop") return { sessions: [], diskBytes: 2048, homeSynced: true };
        if (kind === "probe") return { running: true, busy: false, tabs: 1 };
        return {};
      },
    }),
  });
  return { abort, run: (join?: string) => runComputeNode(deps(join)) };
}

const wait = async (ok: () => Promise<boolean>, what: string): Promise<void> => { for (let i = 0; i < 100; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(what); };

test("a Personal Space with an approved server provisions an agent computer on it, and a chat pinned to it routes there", async () => {
  const { d, owner, dir } = await boot();
  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-personal-node-"));
  const executed: string[] = [];
  const n = node(d, nodeDir, executed);
  let running: Promise<string> | undefined;
  try {
    // nothing is offered before a host exists: no server, and the container runtime is not reachable here
    const before = await post(d, "/v1/computers/hosts", {}, owner);
    assert.equal(before.status, 200, JSON.stringify(before.json));
    assert.deepEqual(before.json.data.hosts.filter((h: { kind: string }) => h.kind === "server"), []);

    // the owner names a server, gets one code, and the server asks to join under that name
    const made = await post(d, "/v1/network/my_computer_code", { nickname: "home-box", idempotencyKey: "pc-1" }, owner);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    running = n.run(made.json.data.code as string);
    let waiting: { serverId: string; name: string; fingerprint?: string; enrollment: string } | undefined;
    await wait(async () => { waiting = (await post(d, "/v1/network/my_computers", {}, owner)).json.data?.computers.find((c: { enrollment: string }) => c.enrollment === "pending"); return waiting !== undefined; }, "the server shows as waiting");
    assert.equal(waiting!.name, "home-box", "it arrived under the nickname, not its host name");
    assert.match(waiting!.fingerprint ?? "", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal((await post(d, "/v1/network/my_computer_approve", { serverId: waiting!.serverId }, owner)).status, 200);
    await wait(async () => (await post(d, "/v1/network/my_computers", {}, owner)).json.data.computers.some((c: { state: string }) => c.state === "healthy"), "it reports in");

    // it is now a place an agent computer can run
    const hosts = (await post(d, "/v1/computers/hosts", {}, owner)).json.data;
    assert.equal(hosts.available, true);
    const server = hosts.hosts.find((h: { hostId: string }) => h.hostId === waiting!.serverId);
    assert.deepEqual([server.kind, server.name, server.online, server.canRun], ["server", "home-box", true, true]);
    assert.equal(hosts.hosts.some((h: { kind: string }) => h.kind === "space"), false, "a Personal Space has no Space server of its own");

    const agent = await post(d, "/v1/agents/create", { name: "Scout", role: "Use Scout.", idempotencyKey: "ag-scout" }, owner);
    assert.equal(agent.status, 200, JSON.stringify(agent.json));
    const agentId = (d.db!.all("SELECT id FROM agents_agent WHERE name = ?", "Scout")[0] as { id: string }).id;
    const prov = await post(d, "/v1/computers/provision", { agentId, nodeId: waiting!.serverId, idempotencyKey: "pv-1" }, owner);
    assert.equal(prov.status, 200, JSON.stringify(prov.json));
    assert.equal(prov.json.data.computer.nodeId, waiting!.serverId, "the computer record lives on the server");
    assert.ok(executed.includes("create"), "the server was asked to make it");

    // a private chat with that agent: pinned to the server, the next turn goes there
    const chat = await post(d, "/v1/chat/start", { kind: "chat", agentIds: [agentId], idempotencyKey: "chat-1" }, owner);
    assert.equal(chat.status, 200, JSON.stringify(chat.json));
    const threadId = chat.json.data.thread.threadId as string;
    const options = (await post(d, "/v1/engine/placement/options", { threadId, agentId }, owner)).json.data;
    assert.equal(options.private, true);
    assert.deepEqual(options.options.map((o: { target: string; name: string }) => [o.target, o.name]), [["device", "This computer"], ["server", "home-box"]], "no Space of its own in a Personal Space");
    const pinned = await post(d, "/v1/engine/placement/set", { threadId, target: "server", serverId: waiting!.serverId }, owner);
    assert.equal(pinned.status, 200, JSON.stringify(pinned.json));
    const decided = (await post(d, "/v1/engine/placement/decide", { threadId, agentId, kind: "message" }, owner)).json.data;
    assert.deepEqual([decided.placement, decided.reason, decided.nodeId], ["host", "chosen_server", waiting!.serverId]);
    // someone else's server is never a place for this chat
    const stranger = await post(d, "/v1/engine/placement/set", { threadId, target: "server", serverId: "srv_not_mine" }, owner);
    assert.equal(stranger.status, 403, JSON.stringify(stranger.json));
    // removing the server ends the pin: the rules apply again and the computer's host is gone
    assert.equal((await post(d, "/v1/network/my_computer_remove", { serverId: waiting!.serverId }, owner)).status, 200);
    const after = (await post(d, "/v1/engine/placement/decide", { threadId, agentId, kind: "message" }, owner)).json.data;
    assert.notEqual(after.reason, "chosen_server");
    assert.deepEqual((await post(d, "/v1/network/my_computers", {}, owner)).json.data.computers, []);
  } finally { n.abort.abort(); await running?.catch(() => undefined); await d.stop(); fs.rmSync(nodeDir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});
