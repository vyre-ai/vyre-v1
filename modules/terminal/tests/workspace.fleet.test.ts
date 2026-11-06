// Workspaces on more than one machine (6 Nov): each agent goes to the machine its workspace is on, the Space's own runtime first, else the server the agent's owner has that joined; the Docker questions for a
// server travel as one question each over its socket and come back as a Docker answer; a Space with no machine at all says so and leaves the agent's commands where its turn runs.
import test from "node:test";
import assert from "node:assert/strict";
import { createDockerApi } from "../../../sandbox/src/docker.ts";
import { createWorkspaceFleet, NO_PLACE, remoteDockerHttp } from "../fleet.ts";
import { createWorkspaceManager, createWorkspaceTerminalHost, workspaceName } from "../workspace.ts";
import type { WorkspaceCapacity } from "../workspace.ts";
import { bindWorkspaces, workspacesFor } from "../projections.ts";
import { fakeDocker } from "../fixtures/fake-docker.ts";

const A = "agt_dex", B = "agt_pam";
const mgr = (dk: ReturnType<typeof fakeDocker>, o: { capacity?: WorkspaceCapacity; runner?: boolean } = {}) => createWorkspaceManager({ api: createDockerApi(dk.http), http: dk.http, idleMs: 600_000, ...o });

test("remote Docker: a request becomes one question with its body as text or base64, and the answer comes back as a Docker answer", async () => {
  const asked: Array<{ input: Record<string, unknown>; timeoutMs: number }> = [];
  const http = remoteDockerHttp(async (input, timeoutMs) => { asked.push({ input: input as Record<string, unknown>, timeoutMs }); return { status: 201, bodyB64: Buffer.from('{"Id":"abc"}').toString("base64") }; });
  const r = await http({ method: "POST", path: "/containers/create", query: { name: "vyre-ws-x" }, json: { Image: "i" }, timeoutMs: 5000 });
  assert.deepEqual([r.status, new TextDecoder().decode(r.body)], [201, '{"Id":"abc"}']);
  assert.deepEqual(asked[0]!.input, { method: "POST", path: "/containers/create", query: { name: "vyre-ws-x" }, jsonText: '{"Image":"i"}', timeoutMs: 5000 });
  assert.equal(asked[0]!.timeoutMs, 15_000, "the link waits a little longer than Docker is given");
  await http({ method: "PUT", path: "/containers/x/archive", query: { path: "/home/agent/Vyre" }, body: new Uint8Array([1, 2, 3]), contentType: "application/x-tar" });
  assert.equal(asked[1]!.input["bodyB64"], "AQID");
  assert.equal(asked[1]!.input["contentType"], "application/x-tar");
  const none = remoteDockerHttp(async () => null);
  await assert.rejects(() => none({ method: "GET", path: "/_ping" }), /did not answer for Docker/);
});

test("the Space's own runtime takes a workspace first; with none, the server the owner has that is connected; with neither, nothing and a plain line", async () => {
  const space = fakeDocker(), node = fakeDocker();
  const both = createWorkspaceFleet({ space: mgr(space), node: () => mgr(node), place: async () => "srv_a" });
  await both.ensure(A);
  assert.equal(space.boxes.has(workspaceName(A)), true);
  assert.equal(node.boxes.size, 0, "the Space's runtime is first");
  const noSpace = fakeDocker(), onNode = fakeDocker();
  const nodes: string[] = [];
  const f = createWorkspaceFleet({ space: null, node: (id) => { nodes.push(id); return mgr(onNode, { runner: true }); }, place: async (a) => (a === A ? "srv_a" : null) });
  assert.equal(await f.available(A), true);
  assert.equal(await f.available(B), false, "no server for this agent's owner");
  assert.equal(await f.ensure(A), "created");
  assert.deepEqual([nodes, onNode.boxes.has(workspaceName(A)), noSpace.boxes.size], [["srv_a"], true, 0]);
  await assert.rejects(() => f.ensure(B), (e: Error) => e.message === NO_PLACE && (e as { workspace?: boolean }).workspace === true);
});

test("a workspace stays on the machine it is on: found there after a restart, whatever the placement says now", async () => {
  const space = fakeDocker(), node = fakeDocker();
  const first = createWorkspaceFleet({ space: mgr(space), node: () => mgr(node), place: async () => "srv_a" });
  await first.ensure(A);
  // the same workspace, a new process: the Space's runtime has it, so it is not made again on the server the placement now names
  const second = createWorkspaceFleet({ space: mgr(space), node: () => mgr(node), place: async () => "srv_a" });
  assert.equal(await second.ensure(A), "running");
  assert.equal(node.boxes.size, 0);
  // the other way: it was made on a server (the Space had no runtime then); the Space has one now, and the workspace stays where its volumes are
  const sp2 = fakeDocker(), nd2 = fakeDocker();
  const onNode = createWorkspaceFleet({ space: null, node: () => mgr(nd2, { runner: true }), place: async () => "srv_a" });
  await onNode.ensure(A);
  const later = createWorkspaceFleet({ space: mgr(sp2), node: () => mgr(nd2, { runner: true }), place: async () => "srv_a" });
  assert.equal(await later.ensure(A), "running", "found on the server");
  assert.equal(sp2.boxes.size, 0);
});

test("a server's workspace is run through the same terminal: commands, tabs and the list of all machines' workspaces", async () => {
  const node = fakeDocker({ tmux: { scripts: { "echo hi": { out: "hi", code: 0 } } } });
  const calls: Array<{ node: string; method: string; path: string }> = [];
  const fleet = createWorkspaceFleet({
    space: null, place: async () => "srv_a",
    node: (id) => createWorkspaceManager({ api: createDockerApi(remoteDockerHttp(async (input) => { const i = input as { method: string; path: string; query?: Record<string, string>; jsonText?: string; bodyB64?: string }; calls.push({ node: id, method: i.method, path: i.path }); const r = await node.http({ method: i.method, path: i.path, ...(i.query ? { query: i.query } : {}), ...(i.jsonText ? { json: JSON.parse(i.jsonText) } : {}), ...(i.bodyB64 ? { body: new Uint8Array(Buffer.from(i.bodyB64, "base64")) } : {}) }); return { status: r.status, bodyB64: Buffer.from(r.body).toString("base64") }; })), http: remoteDockerHttp(async (input) => { const i = input as { method: string; path: string; query?: Record<string, string>; jsonText?: string }; calls.push({ node: id, method: i.method, path: i.path }); const r = await node.http({ method: i.method, path: i.path, ...(i.query ? { query: i.query } : {}), ...(i.jsonText ? { json: JSON.parse(i.jsonText) } : {}) }); return { status: r.status, bodyB64: Buffer.from(r.body).toString("base64") }; }), runner: true, idleMs: 600_000 }),
  });
  const h = createWorkspaceTerminalHost({ manager: fleet });
  await h.open({ terminalId: "trm_1", target: { host: "agent_computer", agentId: A }, name: "agent", cols: 100, rows: 30, folders: [] });
  const r = await h.run("trm_1", { command: "echo hi", env: {}, timeoutMs: 5000 });
  assert.deepEqual([r.exitCode, r.output], [0, "hi"]);
  assert.ok(calls.length > 5 && calls.every((c) => c.node === "srv_a"), "every Docker question went to that server");
  assert.deepEqual((await fleet.list()).map((x) => [x.agentId, x.state]), [[A, "running"]]);
  assert.equal((await fleet.health()).ok, true);
  assert.equal(await h.has("trm_1"), true);
});

test("room is asked for on the server the workspace is on, and given back there", async () => {
  const node = fakeDocker();
  const log: string[] = [];
  const f = createWorkspaceFleet({ space: null, place: async () => "srv_a", node: () => mgr(node, { runner: true, capacity: { claim: async (a) => { log.push(`claim ${a}`); return { state: "running" }; }, release: async (a) => { log.push(`release ${a}`); } } }) });
  await f.ensure(A);
  await f.sleep(A);
  assert.deepEqual(log, [`claim ${A}`, `release ${A}`]);
});

test("workspacesFor follows the fleet: a machine for this agent now, or the agent's commands go where its turn runs", async () => {
  const f = createWorkspaceFleet({ space: null, node: () => mgr(fakeDocker()), place: async (a) => (a === A ? "srv_a" : null) });
  bindWorkspaces((id) => f.available(id));
  assert.deepEqual([await workspacesFor(A), await workspacesFor(B)], [true, false]);
  bindWorkspaces(() => Promise.reject(new Error("boom")));
  assert.equal(await workspacesFor(A), false, "a probe that fails is no workspace, not an error");
  bindWorkspaces(false);
  assert.equal(await workspacesFor(A), false);
});

test("status: a manager says asleep, running, waiting (with the line) or none, without waking or making anything; the fleet says which machine", async () => {
  const space = fakeDocker(), nodeDk = fakeDocker();
  let full = true;
  const cap: WorkspaceCapacity = { claim: async () => (full ? { state: "waiting", line: "Waiting for room on the Space server." } : { state: "running" }), release: async () => undefined };
  const m = createWorkspaceManager({ api: createDockerApi(space.http), http: space.http, idleMs: 600_000, capacity: cap, projectsOf: () => ["prj_a"] });
  assert.deepEqual(await m.status(A), { state: "none" });
  await assert.rejects(() => m.ensure(A));
  assert.deepEqual(await m.status(A), { state: "waiting", line: "Waiting for room on the Space server." });
  assert.equal(space.boxes.size, 0, "a status read makes nothing");
  full = false;
  await m.ensure(A);
  assert.deepEqual(await m.status(A), { state: "running", projects: ["prj_a"] });
  await m.sleep(A);
  assert.equal((await m.status(A)).state, "asleep");
  assert.equal(space.box(workspaceName(A)).running, false, "a status read does not wake it");
  const f = createWorkspaceFleet({ space: m, node: () => mgr(nodeDk, { runner: true }), place: async () => "srv_a" });
  assert.deepEqual(await f.status(A), { state: "asleep", host: "space", projects: ["prj_a"] });
  assert.deepEqual(await f.status(B), { state: "none" });
  const onlyNode = createWorkspaceFleet({ space: null, node: () => mgr(nodeDk, { runner: true }), place: async () => "srv_a" });
  await onlyNode.ensure(B);
  assert.deepEqual(await onlyNode.status(B), { state: "running", host: "server", nodeId: "srv_a" });
});
