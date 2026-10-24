// The MCP endpoint (spec 2.2, 4.12, "native"; ARCH 6.6, 6.7): JSON-RPC over HTTP for outside tools and for the loopback session of a CLI engine. Auth, the tool list a caller sees, tool_search,
// tool calls as the actor acting for the person, scopes, the Gate, and every way a request can be wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer, MAX_RESULT_CHARS } from "../../../agent/src/mcp/index.ts";
import type { McpCaller, McpServerDeps, Scopes } from "../../../agent/src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";
import type { Invoke } from "../../../host/src/invoke.ts";

const g = loadGenerated();
const FULL: Scopes = { read: true, post: true, readChangesets: true, writeBranch: false };
const outside = (over: Partial<McpCaller> = {}): McpCaller => ({
  kind: "outside", sessionId: "ses_out", space: "spc_1", principal: { kind: "actor", id: "act_cc" }, actingFor: "usr_dana", scopes: FULL, name: "Claude Code", ...over,
});
const driver = (over: Partial<McpCaller> = {}): McpCaller => ({
  kind: "driver", sessionId: "ses_drv", space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana", threadId: "thr_1", runId: "run_1", traceId: "a".repeat(32), ...over,
});

interface RigOptions { callers?: Record<string, McpCaller>; invoke?: Invoke; stillValid?: McpServerDeps["stillValid"]; clock?: { t: number }; maxBodyBytes?: number }

function rig(o: RigOptions = {}) {
  const fake = fakeInvoke(g.caps);
  const callers = new Map(Object.entries(o.callers ?? { out: outside(), drv: driver() }));
  const opened: string[] = [];
  const closed: string[] = [];
  const calls: Array<{ tool: string; outcome: string }> = [];
  const clock = o.clock ?? { t: 1_000_000 };
  const server = createMcpServer({
    catalog: g.catalog, defaults: g.defaults, invoke: o.invoke ?? fake.invoke,
    open: async (token) => { opened.push(token); return callers.get(token) ?? null; },
    ...(o.stillValid ? { stillValid: o.stillValid } : {}),
    onCall: (_c, tool, outcome) => { calls.push({ tool, outcome }); },
    onClose: (c) => { closed.push(c.sessionId); },
    now: () => clock.t,
    ...(o.maxBodyBytes === undefined ? {} : { maxBodyBytes: o.maxBodyBytes }),
  });
  async function post(token: string | null, body: unknown, headers: Record<string, string> = {}) {
    const r = await server.handle({ method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    return { ...r, json: r.body === "" ? null : (JSON.parse(r.body) as any) };
  }
  let n = 0;
  const rpc = async (token: string, method: string, params?: unknown, headers: Record<string, string> = {}) => post(token, { jsonrpc: "2.0", id: ++n, method, ...(params === undefined ? {} : { params }) }, headers);
  const list = async (token: string): Promise<any[]> => (await rpc(token, "tools/list")).json.result.tools;
  const callTool = async (token: string, name: string, args: unknown = {}) => (await rpc(token, "tools/call", { name, arguments: args })).json;
  return { server, fake, post, rpc, list, callTool, opened, closed, calls, clock, callers };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } };

// ---- transport and auth

test("a request without a bearer token is 401 with a challenge; an unknown token is 401 invalid_token", async () => {
  const r = rig();
  const none = await r.post(null, { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(none.status, 401);
  assert.equal(none.headers["www-authenticate"], "Bearer");
  const bad = await r.post("nope", { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(bad.status, 401);
  assert.match(bad.headers["www-authenticate"] ?? "", /invalid_token/);
  assert.equal(r.server.sessions(), 0);
});

test("only POST (and DELETE to end a session) is served; a foreign browser origin is refused", async () => {
  const r = rig();
  assert.equal((await r.server.handle({ method: "GET", headers: { authorization: "Bearer out" }, body: "" })).status, 405);
  assert.equal((await r.server.handle({ method: "PUT", headers: { authorization: "Bearer out" }, body: "" })).status, 405);
  const evil = await r.post("out", { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal(r.opened.length, 0, "a refused origin never reaches auth");
  const local = await r.post("out", { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "http://localhost:3000" });
  assert.equal(local.status, 200);
});

test("bad JSON, an empty batch, a non-request and an oversized body are answered in JSON-RPC terms", async () => {
  const r = rig({ maxBodyBytes: 200 });
  const parse = await r.post("out", "{nope");
  assert.deepEqual([parse.status, parse.json.error.code], [400, -32700]);
  const empty = await r.post("out", []);
  assert.deepEqual([empty.status, empty.json.error.code], [400, -32600]);
  const notReq = await r.post("out", { hello: "world" });
  assert.equal(notReq.json.error.code, -32600);
  const big = await r.post("out", { jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(400) } });
  assert.equal(big.status, 413);
});

test("initialize negotiates the protocol version, names the server, opens a session and points at tool_search", async () => {
  const r = rig();
  const res = await r.rpc("out", "initialize", INIT);
  assert.equal(res.status, 200);
  assert.equal(res.headers["mcp-session-id"], "ses_out");
  assert.equal(res.json.result.protocolVersion, "2025-06-18");
  assert.deepEqual(res.json.result.capabilities, { tools: { listChanged: false } });
  assert.equal(res.json.result.serverInfo.name, "vyre");
  assert.match(res.json.result.instructions, /tool_search/);
  const older = await rig().rpc("out", "initialize", { ...INIT, protocolVersion: "2024-11-05" });
  assert.equal(older.json.result.protocolVersion, "2024-11-05");
  const future = await rig().rpc("out", "initialize", { ...INIT, protocolVersion: "2031-01-01" });
  assert.equal(future.json.result.protocolVersion, "2025-06-18", "an unknown version gets the newest we speak");
  assert.equal(r.server.sessions(), 1);
});

test("notifications get 202 and nothing else; ping answers {}; unknown methods are -32601 (and silent as notifications)", async () => {
  const r = rig();
  const note = await r.post("out", { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.deepEqual([note.status, note.body], [202, ""]);
  assert.deepEqual((await r.rpc("out", "ping")).json.result, {});
  assert.equal((await r.rpc("out", "resources/list")).json.error.code, -32601);
  assert.equal((await r.post("out", { jsonrpc: "2.0", method: "whatever" })).status, 202);
});

test("a batch answers each request and skips notifications; a batch of only notifications is 202", async () => {
  const r = rig();
  const batch = await r.post("out", [
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: "b", method: "tools/list" },
  ]);
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.json.map((x: any) => x.id), ["a", "b"]);
  const only = await r.post("out", [{ jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.equal(only.status, 202);
});

test("one token, one session: auth runs once, DELETE ends it, the next request opens a new one", async () => {
  const r = rig();
  await r.rpc("out", "ping");
  await r.rpc("out", "ping");
  assert.deepEqual(r.opened, ["out"]);
  assert.equal(r.server.sessions(), 1);
  const del = await r.server.handle({ method: "DELETE", headers: { authorization: "Bearer out" }, body: "" });
  assert.equal(del.status, 204);
  assert.deepEqual(r.closed, ["ses_out"]);
  assert.equal(r.server.sessions(), 0);
  await r.rpc("out", "ping");
  assert.deepEqual(r.opened, ["out", "out"]);
  assert.equal((await r.server.handle({ method: "DELETE", headers: { authorization: "Bearer zzz" }, body: "" })).status, 404);
});

test("a wrong Mcp-Session-Id is 404; ending the session from outside (close, revoke) drops it", async () => {
  const r = rig();
  await r.rpc("out", "initialize", INIT);
  assert.equal((await r.rpc("out", "ping", undefined, { "mcp-session-id": "ses_other" })).status, 404);
  assert.equal((await r.rpc("out", "ping", undefined, { "mcp-session-id": "ses_out" })).status, 200);
  assert.equal(r.server.end("ses_out"), true);
  assert.equal(r.server.end("ses_out"), false);
  assert.equal(r.server.sessions(), 0);
});

test("a revoked connection is cut within the recheck interval, before its next call", async () => {
  let valid = true;
  const r = rig({ stillValid: async () => valid });
  assert.equal((await r.rpc("out", "ping")).status, 200);
  valid = false;
  assert.equal((await r.rpc("out", "ping")).status, 200, "not asked again yet");
  r.callers.delete("out");
  r.clock.t += 31_000;
  const cut = await r.rpc("out", "ping");
  assert.equal(cut.status, 401, "asked again, no longer valid, and the token no longer opens");
  assert.deepEqual(r.closed, ["ses_out"]);
  assert.equal(r.server.sessions(), 0);
});

// ---- the tool list

test("tools/list for an outside tool: common tools it may use, none of the vault, terminal or computer tools, with schemas and hints", async () => {
  const r = rig();
  const tools = await r.list("out");
  const names = new Set(tools.map((t) => t.name));
  assert.ok(names.has("tool_search") && names.has("records_query") && names.has("chat_post"));
  assert.ok(tools.length >= 20 && tools.length < g.defaults.size, `${tools.length} tools`);
  for (const n of names) assert.ok(g.defaults.has(n), `${n} is in the frozen default set`);
  for (const t of tools) {
    const def = g.catalog.byName(t.name)!;
    assert.notEqual(def.toolset, "vault", t.name);
    assert.notEqual(def.toolset, "terminal", t.name);
    assert.notEqual(def.toolset, "computer", t.name);
    assert.notEqual(def.toolset, "engineer", t.name);
    assert.equal(typeof t.description, "string");
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.equal(t.annotations.readOnlyHint, def.effects === "read", t.name);
  }
});

test("tools/list for a CLI engine's session is the whole default set (the agent's own rules apply), not the outside tool's cut", async () => {
  const r = rig();
  const names = new Set((await r.list("drv")).map((t) => t.name));
  assert.equal(names.size, g.defaults.size);
  assert.ok(names.has("terminal_run") && names.has("vault_use") && names.has("screen_screenshot"));
});

test("agent rules and plan mode narrow a CLI session's list and its calls", async () => {
  const r = rig({ callers: { rules: driver({ rules: { deny: ["chat_post", "terminal"] } }), plan: driver({ sessionId: "ses_plan", planMode: true }) } });
  const names = new Set((await r.list("rules")).map((t) => t.name));
  assert.ok(!names.has("chat_post") && !names.has("terminal_run") && names.has("records_query"));
  const refused = await r.callTool("rules", "chat_post", { threadId: "thr_1", body: "hi" });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.result.structuredContent.error.code, "permission.role_lacks_permission");
  assert.equal(r.fake.calls.length, 0, "refused before the pipeline");

  const plan = await r.list("plan");
  for (const t of plan) assert.equal(g.catalog.byName(t.name)!.planMode === "blocked" || g.catalog.byName(t.name)!.effects === "outward", false, `${t.name} is offered in plan mode`);
  const blocked = await r.callTool("plan", "records_create", {});
  assert.equal(blocked.result.structuredContent.error.code, "permission.plan_mode");
});

// ---- tool_search and deferred tools

test("a deferred tool must be found with tool_search before it can be called, and then shows in tools/list", async () => {
  const r = rig({ callers: { drv: driver() } });
  const deferred = g.catalog.all.find((t) => !g.defaults.has(t.name) && t.toolset === "records" && t.effects === "read" && t.local === "none")!;
  assert.ok(deferred, "a deferred records read tool exists");
  const before = await r.callTool("drv", deferred.name, {});
  assert.equal(before.result.isError, true);
  assert.equal(before.result.structuredContent.error.details.reason, "not_loaded");
  assert.equal(r.fake.calls.length, 0);

  const found = await r.callTool("drv", "tool_search", { query: deferred.name.replaceAll("_", " ") });
  assert.equal(found.result.isError, false);
  const names = found.result.structuredContent.data.tools.map((t: any) => t.name);
  assert.ok(names.includes(deferred.name), `search found ${deferred.name}: ${names.join(",")}`);
  assert.ok(found.result.structuredContent.data.tools.every((t: any) => t.inputSchema && t.summary));
  assert.ok((await r.list("drv")).some((t) => t.name === deferred.name), "now listed");
  const after = await r.callTool("drv", deferred.name, {});
  assert.equal(after.result.isError, false);
  assert.equal(r.fake.calls.at(-1)?.cap, deferred.cap);
});

test("tool_search for an outside tool never returns what its scopes would refuse, and needs a query", async () => {
  const r = rig();
  const found = await r.callTool("out", "tool_search", { query: "vault secret terminal run command chat post delete" });
  const tools = found.result.structuredContent.data.tools as Array<{ name: string; toolset: string }>;
  for (const t of tools) {
    assert.ok(!["vault", "terminal", "computer", "engineer"].includes(t.toolset), `${t.name} (${t.toolset}) leaked to an outside tool`);
    const def = g.catalog.byName(t.name)!;
    assert.equal(def.effects, "read", `${t.name} is outside the scopes`);
  }
  const noQuery = await r.callTool("out", "tool_search", {});
  assert.equal(noQuery.result.isError, true);
  assert.equal(noQuery.result.structuredContent.error.code, "validation.bad_input");
});

// ---- tool calls

test("a call is one invoke, as the actor acting for the person who connected it", async () => {
  const r = rig();
  const out = await r.callTool("out", "records_query", { type: "lead" });
  assert.equal(out.result.isError, false);
  assert.deepEqual(out.result.structuredContent, { data: { cap: "records.query" } });
  assert.equal(JSON.parse(out.result.content[0].text).data.cap, "records.query");
  assert.deepEqual(r.fake.calls, [{ cap: "records.query", principal: "act_cc", actingFor: "usr_dana", approval: undefined, preAuth: undefined }]);
  assert.deepEqual(r.calls, [{ tool: "records_query", outcome: "ok" }]);

  const seeds: Array<{ kind: string; origin: string | undefined; thread: string | undefined; run: string | undefined }> = [];
  const spy: Invoke = async (_cap, _input, seed) => { seeds.push({ kind: seed.principal.kind, origin: seed.origin, thread: seed.thread, run: seed.run }); return { status: "ok", output: {}, traceId: "t" }; };
  const r2 = rig({ invoke: spy });
  await r2.callTool("out", "records_query", { type: "lead" });
  await r2.callTool("drv", "records_query", { type: "lead" });
  assert.deepEqual(seeds, [
    { kind: "actor", origin: "mcp", thread: "ses_out", run: undefined },
    { kind: "agent", origin: "mcp", thread: "thr_1", run: "run_1" },
  ]);
});

test("a call held at the Gate is reported as waiting for a person, with the task, and is not an answer", async () => {
  const r = rig();
  const gated = g.catalog.all.find((t) => g.defaults.has(t.name) && t.gated && t.local === "none" && t.toolset !== "engineer");
  assert.ok(gated, "a default tool with a Gate rule exists");
  const out = await r.callTool("drv", gated.name, {});
  assert.equal(out.result.isError, true);
  assert.equal(out.result.structuredContent.held, true);
  assert.match(out.result.structuredContent.taskId, /^task_/);
  assert.match(out.result.structuredContent.message, /approve/);
  assert.deepEqual(r.calls.at(-1), { tool: gated.name, outcome: "held" });
});

test("pipeline errors come back as tool errors the model can read, with the code and next steps", async () => {
  const { HostError, makeError } = await import("../../../host/src/routes/errors.ts");
  const denied: Invoke = async () => { throw new HostError(makeError("permission.no_grant", "b".repeat(32), { details: { cap: "records.query" } })); };
  const r = rig({ invoke: denied });
  const out = await r.callTool("out", "records_query", { type: "lead" });
  assert.equal(out.result.isError, true);
  assert.equal(out.result.structuredContent.error.code, "permission.no_grant");
  assert.equal(out.result.structuredContent.error.traceId, "b".repeat(32));
  assert.ok(Array.isArray(out.result.structuredContent.error.next));
  assert.deepEqual(r.calls, [{ tool: "records_query", outcome: "error" }]);

  const boom: Invoke = async () => { throw new Error("db password is hunter2"); };
  const r2 = rig({ invoke: boom });
  const out2 = await r2.callTool("out", "records_query", {});
  assert.equal(out2.result.isError, true);
  assert.equal(out2.result.structuredContent.error.code, "internal.unexpected");
  assert.equal(JSON.stringify(out2).includes("hunter2"), false, "an unexpected failure shows nothing of its cause");
});

test("a result larger than the cap is cut with a note, not dropped", async () => {
  const huge: Invoke = async () => ({ status: "ok", output: { text: "x".repeat(MAX_RESULT_CHARS + 5_000) }, traceId: "t" });
  const r = rig({ invoke: huge });
  const out = await r.callTool("out", "records_query", {});
  assert.equal(out.result.isError, false);
  const text: string = out.result.content[0].text;
  assert.ok(text.length < MAX_RESULT_CHARS + 100);
  assert.match(text, /\[cut: \d+ more characters\]$/);
});

test("tools/call with a missing name, bad arguments or an unknown tool is invalid params, not a tool error", async () => {
  const r = rig();
  assert.equal((await r.rpc("out", "tools/call", {})).json.error.code, -32602);
  assert.equal((await r.rpc("out", "tools/call", { name: "records_query", arguments: [1] })).json.error.code, -32602);
  assert.equal((await r.rpc("out", "tools/call", { name: "records_query", arguments: "x" })).json.error.code, -32602);
  const unknown = await r.rpc("out", "tools/call", { name: "no_such_tool" });
  assert.equal(unknown.json.error.code, -32602);
  assert.match(unknown.json.error.message, /Unknown tool/);
  assert.equal(r.fake.calls.length, 0);
});

// ---- scopes

test("scopes: read-only lists and runs read tools; posting needs the post scope; branch writes need their scope and still go through the Gate", async () => {
  const readOnly: Scopes = { read: true, post: false, readChangesets: false, writeBranch: false };
  const r = rig({ callers: { ro: outside({ scopes: readOnly }), full: outside({ sessionId: "ses_full", scopes: FULL }), branch: outside({ sessionId: "ses_b", scopes: { ...FULL, writeBranch: true } }) } });
  const ro = new Set((await r.list("ro")).map((t) => t.name));
  assert.ok(ro.has("records_query") && !ro.has("chat_post") && !ro.has("files_write") && !ro.has("records_create"));
  for (const n of ro) assert.equal(g.catalog.byName(n)!.effects, "read", `${n} is not a read tool`);
  const refused = await r.callTool("ro", "chat_post", { threadId: "thr_1", body: "hi" });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.result.structuredContent.error.code, "permission.role_lacks_permission");
  assert.equal(refused.result.structuredContent.error.details.reason, "scope");
  assert.equal(r.fake.calls.length, 0);

  const full = new Set((await r.list("full")).map((t) => t.name));
  assert.ok(full.has("chat_post") && !full.has("files_write") && !full.has("records_create"));
  assert.equal((await r.callTool("full", "chat_post", { threadId: "thr_1", body: "hi" })).result.isError, false);
  assert.equal(r.fake.calls.at(-1)?.cap, "chat.post");
  const rc = await r.callTool("full", "records_create", {});
  assert.equal(rc.result.structuredContent.error.details.reason, "scope", "writes other than posts are not a scope of an outside tool");

  const branch = new Set((await r.list("branch")).map((t) => t.name));
  assert.ok(branch.has("files_write"));
  assert.equal((await r.callTool("branch", "files_write", { path: "a.md", content: "x" })).result.isError, false);
});

test("scopes: a changeset reader without general read sees changesets and nothing else, and tool_search stays available to every scope", async () => {
  const cs: Scopes = { read: false, post: false, readChangesets: true, writeBranch: false };
  const r = rig({ callers: { cs: outside({ scopes: cs }), none: outside({ sessionId: "ses_none", scopes: { read: false, post: false, readChangesets: false, writeBranch: false } }) } });
  const names = (await r.list("cs")).map((t) => t.name);
  assert.ok(names.includes("changesets_get") && names.includes("changesets_diff") && names.includes("tool_search"));
  for (const n of names) assert.ok(g.catalog.byName(n)!.cap.startsWith("changesets.") || g.catalog.byName(n)!.cap === "mcp.tool.search", `${n} is not a changeset tool`);
  const nothing = (await r.list("none")).map((t) => t.name);
  assert.deepEqual(nothing, ["tool_search"]);
});
