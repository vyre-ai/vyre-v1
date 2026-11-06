// A server's answer to the Space's Docker questions (agent workspaces on a node, 6 Nov): put to the runner's policy in this process before Docker sees them, so a Space that is wrong or taken over cannot make
// anything but a workspace. A fake Docker behind it records what arrives.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MAX_BODY, readInput, startWorkspaceDocker } from "./docker-ask.ts";

async function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ask-"));
  const seen: Array<{ method: string; url: string; body: string }> = [];
  const fake = http.createServer((q, s) => {
    let b = "";
    q.on("data", (c) => (b += c));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", body: b });
      if (q.url === "/version") { s.writeHead(200); s.end(JSON.stringify({ ApiVersion: "1.47", MinAPIVersion: "1.24" })); return; }
      if (/\/containers\/vyre-ws-agt_dex\/json$/.test(q.url ?? "")) { s.writeHead(200); s.end(JSON.stringify({ Config: { Labels: { "vyre.workspace": "agt_dex" } } })); return; }
      if (/\/archive/.test(q.url ?? "")) { s.writeHead(200); s.end(Buffer.alloc(MAX_BODY + 10)); return; }
      s.writeHead(/containers\/create/.test(q.url ?? "") ? 201 : 200); s.end(JSON.stringify({ Id: "c".repeat(64) }));
    });
  });
  await new Promise<void>((r) => fake.listen(path.join(dir, "docker.sock"), r));
  const node = await startWorkspaceDocker(dir, { dockerSocket: path.join(dir, "docker.sock") });
  return { ask: node.ask, seen, close: async () => { await node.close(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const net = `vyre-wsnet-${createHash("sha256").update("agt_dex").digest("hex").slice(0, 16)}`;
const ws = (over: Record<string, unknown> = {}, h: Record<string, unknown> = {}) => ({
  Image: "vyre/agent-workspace:1", Hostname: "vyre-ws-agt_dex", User: "10001:10001", WorkingDir: "/home/agent", Cmd: ["sleep", "infinity"], Env: ["VYRE_WORKSPACE_AGENT=agt_dex", "HOME=/home/agent"],
  Labels: { "vyre.workspace": "agt_dex", "vyre.mounts": "0123456789abcdef" }, StopTimeout: 10, ...over,
  HostConfig: { Binds: ["vyre-ws-agt_dex-home:/home/agent:rw"], Tmpfs: { "/tmp": "rw" }, CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges:true"], Privileged: false, NetworkMode: net, PidMode: "", IpcMode: "private", UsernsMode: "", Devices: [], PidsLimit: 512, Memory: 1024 ** 3, MemorySwap: 1024 ** 3, NanoCpus: 1e9, Init: true, AutoRemove: false, ExtraHosts: [], Dns: [], ...h },
});

test("a question is put to Docker through the runner at the API version the engine serves, and the answer comes back as status and body", async (t) => {
  const w = await world();
  t.after(w.close);
  const a = await w.ask({ method: "GET", path: "/_ping" });
  assert.equal(a.status, 200);
  assert.ok(w.seen.some((s) => s.url === "/version"), "the version was asked once");
  assert.ok(w.seen.some((s) => s.url === "/v1.43/_ping"), "1.43 is within what the engine serves");
  const ok = await w.ask({ method: "GET", path: "/containers/vyre-ws-agt_dex/json" });
  assert.equal(ok.status, 200);
  const c = await w.ask({ method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws()) });
  assert.equal(c.status, 201, Buffer.from(c.bodyB64, "base64").toString());
  assert.equal(w.seen.filter((s) => s.url === "/version").length, 1);
});

test("the runner's policy judges what the Space sends: a privileged container, a host folder, another network, the whole list of containers, are refused and never reach Docker", async (t) => {
  const w = await world();
  t.after(w.close);
  const before = w.seen.length;
  for (const [what, input] of [
    ["privileged", { method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws({}, { Privileged: true })) }],
    ["a host folder", { method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws({}, { Binds: ["/:/host:rw"] })) }],
    ["the host network", { method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws({}, { NetworkMode: "host" })) }],
    ["root", { method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws({ User: "0:0" })) }],
    ["another image", { method: "POST", path: "/containers/create", query: { name: "vyre-ws-agt_dex" }, jsonText: JSON.stringify(ws({ Image: "alpine" })) }],
    ["every container", { method: "GET", path: "/containers/json" }],
    ["an exec in another container", { method: "POST", path: "/containers/vyred/exec", jsonText: JSON.stringify({ Cmd: ["id"] }) }],
    ["a build", { method: "POST", path: "/build" }],
  ] as Array<[string, unknown]>) {
    const r = await w.ask(input);
    assert.equal(r.status, 403, `${what}: ${Buffer.from(r.bodyB64, "base64").toString()}`);
  }
  assert.ok(w.seen.slice(before).every((s) => s.url === "/version" || !/create|build|exec|containers\/json/.test(s.url)), "nothing refused reached Docker");
});

test("a question that is not a Docker request, and a body or an answer over one frame, are refused with a plain line", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.throws(() => readInput(null), /not a Docker request/);
  assert.throws(() => readInput({ method: "TRACE", path: "/x" }), /refused/);
  assert.throws(() => readInput({ method: "GET", path: "/x?a=1" }), /path is refused/);
  assert.throws(() => readInput({ method: "GET", path: "/a/../b" }), /path is refused/);
  assert.throws(() => readInput({ method: "GET", path: "//host" }), /path is refused/);
  assert.throws(() => readInput({ method: "GET", path: "/x", query: { a: 1 } }), /query is refused/);
  assert.throws(() => readInput({ method: "PUT", path: "/", stage: { id: "zz", index: 0, total: 1 } }), /staged piece is refused/);
  assert.throws(() => readInput({ method: "PUT", path: "/", stage: { id: "abcdef0123", index: 2, total: 2 } }), /staged piece is refused/);
  assert.throws(() => readInput({ method: "GET", path: "/", chunk: { id: "abcdef0123", index: 0 } }), /piece is refused/);
  assert.throws(() => readInput({ method: "PUT", path: "/x", stagedId: "../x" }), /staged body is refused/);
  // an answer over one frame comes back as its first piece and says there is more
  const big = await w.ask({ method: "GET", path: "/containers/vyre-ws-agt_dex/archive", query: { path: "/home/agent/Vyre/." } }) as { status: number; more?: { id: string; chunks: number } };
  assert.equal(big.status, 200);
  assert.equal(big.more?.chunks, 2);
});
