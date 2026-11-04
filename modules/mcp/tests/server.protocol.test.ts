// The MCP endpoint (spec 2.2, 4.12, "native"; ARCH 6.6, 6.7): JSON-RPC over HTTP for outside tools and for the loopback session of a CLI engine. Auth, the tool list a caller sees, tool_search,
// tool calls as the agent acting for the person, what stays with people, the Gate, and every way a request can be wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer, MAX_RESULT_CHARS, isPersonOnly, outsideAllows, outsideDoor, setupCovers, setupRefusal } from "../../../agent/src/mcp/index.ts";
import type { McpCaller, McpServerDeps } from "../../../agent/src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";
import type { Invoke } from "../../../host/src/invoke.ts";

const g = loadGenerated();
const outside = (over: Partial<McpCaller> = {}): McpCaller => ({
  kind: "outside", sessionId: "ses_out", space: "spc_1", principal: { kind: "agent", id: "agt_cc" }, actingFor: "usr_dana", name: "Claude Code", ...over,
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

test("one token, one session: a CLI engine's auth runs once, an outside agent's on every request, DELETE ends it, the next request opens a new one", async () => {
  const r = rig();
  await r.rpc("drv", "ping");
  await r.rpc("drv", "ping");
  assert.deepEqual(r.opened, ["drv"]);
  await r.rpc("out", "ping");
  await r.rpc("out", "ping");
  assert.deepEqual(r.opened, ["drv", "out", "out"]);
  assert.equal(r.server.sessions(), 2);
  const del = await r.server.handle({ method: "DELETE", headers: { authorization: "Bearer out" }, body: "" });
  assert.equal(del.status, 204);
  assert.deepEqual(r.closed, ["ses_out"]);
  assert.equal(r.server.sessions(), 1);
  await r.rpc("out", "ping");
  assert.deepEqual(r.opened, ["drv", "out", "out", "out"]);
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

test("a closed engine session is cut within the recheck interval, before its next call", async () => {
  let valid = true;
  const r = rig({ stillValid: async () => valid });
  assert.equal((await r.rpc("drv", "ping")).status, 200);
  valid = false;
  assert.equal((await r.rpc("drv", "ping")).status, 200, "not asked again yet");
  r.callers.delete("drv");
  r.clock.t += 31_000;
  const cut = await r.rpc("drv", "ping");
  assert.equal(cut.status, 401, "asked again, no longer valid, and the token no longer opens");
  assert.deepEqual(r.closed, ["ses_drv"]);
  assert.equal(r.server.sessions(), 0);
});

test("an outside agent's token that stops working is refused at its very next request", async () => {
  const r = rig();
  assert.equal((await r.rpc("out", "ping")).status, 200);
  r.callers.delete("out");
  assert.equal((await r.rpc("out", "ping")).status, 401);
});

// ---- the tool list

test("tools/list for an outside agent: common tools it may use, none of the vault, terminal or computer tools, with schemas and hints", async () => {
  const r = rig();
  const tools = (await r.list("out")).filter((t) => t.name !== "use_tool");
  const names = new Set(tools.map((t) => t.name));
  assert.ok(names.has("tool_search") && names.has("records_query") && names.has("chat_post"));
  assert.ok(tools.length >= 20 && tools.length < g.defaults.size + 1, `${tools.length} tools`);
  for (const n of names) assert.ok(g.defaults.has(n) || n === "agents_next", `${n} is in the frozen default set`);
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
  assert.equal(names.size, g.defaults.size + 10);   // and helper_note (a helper and the agent that started it talk with it, l-crews), people_status, message_person: who is in and a message to a teammate (lane l-agentdm), task_submit and task_ask: how a helper hands in
  assert.ok(names.has("terminal_run") && names.has("vault_use") && names.has("screen_screenshot") && names.has("use_tool") && names.has("files_create") && names.has("files_tree"));
  assert.ok(names.has("people_status") && names.has("message_person"));
  assert.ok(names.has("task_submit") && names.has("task_ask") && names.has("helper_note"), "a helper hands in with what is already listed, never searching for it");
});

test("a CLI engine lists once, so use_tool calls what tool_search found; a tool it never searched for stays refused", async () => {
  const r = rig();
  const deferred = g.catalog.all.find((t) => !g.defaults.has(t.name) && t.toolset !== "engineer")!;
  const before = await r.callTool("drv", "use_tool", { name: deferred.name, arguments: {} });
  assert.equal(before.result.isError, true);
  assert.equal(before.result.structuredContent.error.details.reason, "not_loaded");
  await r.callTool("drv", "tool_search", { query: deferred.name });
  const after = await r.callTool("drv", "use_tool", { name: deferred.name, arguments: {} });
  assert.notEqual(after.result.structuredContent?.error?.details?.reason, "not_loaded");
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

test("a session opened in Plan by chat mode (mode, not the older planMode flag) offers and runs nothing that changes or sends; Auto and Ask first keep the full list", async () => {
  const r = rig({ callers: { plan: driver({ sessionId: "ses_p", mode: "plan" }), auto: driver({ sessionId: "ses_a", mode: "auto" }), ask: driver({ sessionId: "ses_k", mode: "ask" }) } });
  for (const t of await r.list("plan")) assert.equal(g.catalog.byName(t.name)!.planMode === "blocked" || g.catalog.byName(t.name)!.effects === "outward", false, `${t.name} is offered in plan`);
  assert.equal((await r.callTool("plan", "records_create", {})).result.structuredContent.error.code, "permission.plan_mode");
  const full = (await r.list("auto")).length;
  assert.equal((await r.list("ask")).length, full);
  assert.ok(full > (await r.list("plan")).length);
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

test("tool_search for an outside agent finds what it may run, and marks what asks the person; never what is off from outside; and needs a query", async () => {
  const r = rig();
  const found = await r.callTool("out", "tool_search", { query: "vault secret terminal run command chat post delete sso sign in" });
  const tools = found.result.structuredContent.data.tools as Array<{ name: string; toolset: string; asksPerson?: boolean }>;
  for (const t of tools) {
    const door = outsideDoor(g.catalog.byName(t.name)!);
    assert.notEqual(door, "off", `${t.name} (${t.toolset}) is off from outside`);
    if (t.asksPerson) assert.ok(door === "ask" || door === "paste", `${t.name} is marked as asking the person`);
    else {
      assert.equal(outsideAllows(g.catalog.byName(t.name)!), true, `${t.name} stays with people`);
      assert.ok(!["vault", "terminal", "computer", "engineer"].includes(t.toolset), `${t.name} (${t.toolset}) leaked to an outside tool`);
    }
  }
  assert.ok(tools.some((t) => t.asksPerson === true), "what only a person does is found, marked");
  const noQuery = await r.callTool("out", "tool_search", {});
  assert.equal(noQuery.result.isError, true);
  assert.equal(noQuery.result.structuredContent.error.code, "validation.bad_input");
});

// ---- tool calls

test("a call is one invoke, as the agent acting for the person who allowed it", async () => {
  const r = rig();
  const out = await r.callTool("out", "records_query", { type: "lead" });
  assert.equal(out.result.isError, false);
  assert.deepEqual(out.result.structuredContent, { data: { cap: "records.query" } });
  assert.equal(JSON.parse(out.result.content[0].text).data.cap, "records.query");
  assert.deepEqual(r.fake.calls, [{ cap: "records.query", principal: "agt_cc", actingFor: "usr_dana", approval: undefined, preAuth: undefined }]);
  assert.deepEqual(r.calls, [{ tool: "records_query", outcome: "ok" }]);

  const seeds: Array<{ kind: string; origin: string | undefined; thread: string | undefined; run: string | undefined }> = [];
  const spy: Invoke = async (_cap, _input, seed) => { seeds.push({ kind: seed.principal.kind, origin: seed.origin, thread: seed.thread, run: seed.run }); return { status: "ok", output: {}, traceId: "t" }; };
  const r2 = rig({ invoke: spy });
  await r2.callTool("out", "records_query", { type: "lead" });
  await r2.callTool("drv", "records_query", { type: "lead" });
  assert.deepEqual(seeds, [
    { kind: "agent", origin: "mcp", thread: undefined, run: undefined },
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
  assert.equal(out.result.structuredContent.error.traceId, undefined, "the model never reads the trace id");
  assert.ok(!JSON.stringify(out.result.content).includes("b".repeat(32)), "nor in the text");
  assert.equal(out.result._meta["vyre/traceId"], "b".repeat(32), "it travels beside the result, for the turn's Details");
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

// ---- outside agents

test("an outside agent has no scope list: it can write; what is off from outside is refused before anything runs; what only a person does asks that person", async () => {
  const r = rig();
  const names = new Set((await r.list("out")).map((t) => t.name));
  assert.ok(names.has("records_query") && names.has("chat_post") && names.has("records_create") && names.has("use_tool") && names.has("agents_next"), [...names].join(" "));
  for (const n of ["members_sso_set", "access_share", "terminal_run", "vault_item_reveal"]) assert.equal(names.has(n), false, `${n} is not listed as the agent's own`);
  assert.equal((await r.callTool("out", "chat_post", { threadId: "thr_1", body: "hi" })).result.isError, false);
  for (const tool of ["terminal_run", "vault_item_reveal", "vault_folders_list"]) {
    if (!g.catalog.byName(tool)) continue;
    const before = r.fake.calls.length;
    const refused = await r.callTool("out", "use_tool", { name: tool, arguments: {} });
    assert.equal(refused.result.isError, true, tool);
    assert.equal(refused.result.structuredContent.error.details.reason, "not_from_outside", tool);
    assert.equal(r.fake.calls.length, before, `${tool} reached the pipeline`);
  }
  for (const tool of ["access_share", "members_invites_create", "members_sso_set", "connections_create", "gate_rules_set", "company_status"]) {
    const def = g.catalog.byName(tool);
    if (!def) continue;
    const asked = await r.callTool("out", "use_tool", { name: tool, arguments: { a: 1 } });
    assert.equal(asked.result.isError, true, `${tool}: not an answer yet`);
    assert.deepEqual([asked.result.structuredContent.held, asked.result.structuredContent.asksPerson], [true, true], `${tool}: ${JSON.stringify(asked.result)}`);
    assert.deepEqual(r.fake.calls.at(-1), { cap: def.cap, principal: "agt_cc", actingFor: "usr_dana", approval: undefined, preAuth: undefined, askPerson: "always" }, `${tool} goes to the pipeline as the agent asking its person, never as the agent's own call`);
    assert.deepEqual(r.calls.at(-1), { tool, outcome: "held" });
  }
});

test("a key from outside is a paste request: names only, never a value, and the agent gets the handle", async () => {
  const r = rig();
  const before = r.fake.calls.length;
  const withValue = await r.callTool("out", "use_tool", { name: "vault_item_put", arguments: { name: "Google_Client_Secret", folderId: "vfd_x", kind: "api_key", fields: [{ key: "value", value: "GOCSPX-abc", secret: true }] } });
  assert.equal(withValue.result.isError, true);
  assert.equal(withValue.result.structuredContent.error.details.reason, "value_sent");
  assert.equal(JSON.stringify(withValue).includes("GOCSPX-abc"), false, "the value is not echoed");
  assert.equal(r.fake.calls.length, before, "nothing reached the pipeline");
  let seen: unknown = null;
  const spy: Invoke = async (cap, input, seed) => { seen = { cap, input, principal: seed.principal.id, actingFor: seed.actingFor }; return { status: "ok", output: { request: { id: "vrq_1", taskId: "tsk_1", name: "Google_Client_Secret" } }, traceId: "t" }; };
  const r2 = rig({ invoke: spy });
  const asked = await r2.callTool("out", "use_tool", { name: "vault_item_put", arguments: { name: "Google_Client_Secret", folderId: "vfd_x", fields: [{ key: "value" }] } });
  assert.equal(asked.result.isError, true, "not an answer yet");
  assert.deepEqual([asked.result.structuredContent.held, asked.result.structuredContent.requestId, asked.result.structuredContent.handle], [true, "vrq_1", "#Google_Client_Secret"]);
  const s = seen as { cap: string; input: Record<string, unknown>; principal: string; actingFor: string };
  assert.equal(s.cap, "vault.request");
  assert.deepEqual([s.input["name"], s.input["fields"], s.input["folderId"], s.input["handleOnly"], s.principal, s.actingFor], ["Google_Client_Secret", ["value"], "vfd_x", true, "agt_cc", "usr_dana"]);
});

test("use_tool calls what tool_search found, for a client that lists once", async () => {
  const r = rig();
  const deferred = g.catalog.all.find((t) => !g.defaults.has(t.name) && t.effects === "read" && outsideAllows(t) && t.local === "none")!;
  const out = await r.callTool("out", "use_tool", { name: deferred.name, arguments: {} });
  assert.equal(out.result.isError, false);
  assert.equal(r.fake.calls.at(-1)?.cap, deferred.cap);
  assert.equal(r.fake.calls.at(-1)?.principal, "agt_cc");
});

test("the families a person keeps: nothing that changes sign-in, access or the company's connections is an outside tool", () => {
  for (const t of g.catalog.all) {
    if (t.effects === "read") continue;
    if (/^(identity|members|devices|access|connections|network|mcp|gate)\./.test(t.cap) && !["access.request"].includes(t.cap)) assert.equal(isPersonOnly(t.cap, t.effects), true, t.cap);
  }
  assert.equal(outsideAllows({ cap: "mcp.tool.search", toolset: "meta", effects: "read", local: "none" }), true);
  assert.equal(outsideAllows({ cap: "access.request", toolset: "meta", effects: "write", local: "none" }), true, "asking is not doing");
});

test("a 401 names where to sign in, with no token and with a bad one", async () => {
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fakeInvoke(g.caps).invoke, open: async () => null, challenge: (origin, error) => `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ""}` });
  const none = await server.handle({ method: "POST", headers: {}, body: "{}", origin: "https://acme.vyre.run" });
  assert.equal(none.status, 401);
  assert.equal(none.headers["www-authenticate"], 'Bearer resource_metadata="https://acme.vyre.run/.well-known/oauth-protected-resource/mcp"');
  const bad = await server.handle({ method: "POST", headers: { authorization: "Bearer nope" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), origin: "https://acme.vyre.run" });
  assert.equal(bad.status, 401);
  assert.match(bad.headers["www-authenticate"]!, /error="invalid_token"/);
});

test("a rotated token keeps its session, and a token that stops working stops at the next request", async () => {
  const caller = outside({ sessionId: "ses_keep" });
  const live = new Set(["t1", "t2"]);
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fakeInvoke(g.caps).invoke, open: async (token) => (live.has(token) ? caller : null) });
  const post = (token: string, session?: string) => server.handle({ method: "POST", headers: { authorization: `Bearer ${token}`, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal((await post("t1")).status, 200);
  assert.equal(server.sessions(), 1);
  assert.equal((await post("t2", "ses_keep")).status, 200, "the session id the client holds still works");
  assert.equal(server.sessions(), 1);
  live.delete("t2");
  assert.equal((await post("t2", "ses_keep")).status, 401, "no recheck window for an outside agent");
});

test("a session that ends fails the call in flight at once", async () => {
  let release = (): void => undefined;
  const slow: Invoke = () => new Promise((resolve) => { release = () => resolve({ status: "ok", output: { late: true }, traceId: "t" }); });
  const caller = outside({ sessionId: "ses_slow" });
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: slow, open: async () => caller });
  const call = server.handle({ method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "records_query", arguments: { type: "lead" } } }) });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(server.end("ses_slow"), true);
  const out = JSON.parse((await call).body) as { result: { isError: boolean; structuredContent: { error: { code: string } } } };
  assert.equal(out.result.isError, true);
  assert.equal(out.result.structuredContent.error.code, "permission.revoked");
  release();
});

test("the setup grant's scope: setting the Space up, never what goes out, never anything that gives an agent more", () => {
  for (const cap of ["members.sso.set", "members.invites.create", "company.connect", "settings.set_space", "providers.add", "vault.item.put", "connections.create"]) {
    const t = g.catalog.all.find((x) => x.cap === cap);
    if (t) assert.equal(setupCovers(t), true, cap);
  }
  for (const t of g.catalog.all) {
    if (t.effects === "outward") assert.equal(setupCovers(t), false, `${t.cap} goes out`);
    // groups and roles of people are in scope, each subject checked (setupRefusal); reading them, removing someone and deleting a group only narrow. The Space's name and logo are in scope.
    const peopleOnly = /^access\.(groups\.(create|update|add_member|remove_member|delete|list|get)|roles\.(assign|unassign|list|get))$|^spaces\.(update|get)$/;
    if (/^(access|gate|agents|mcp|devices|network|spaces|identity)\./.test(t.cap) && !peopleOnly.test(t.cap)) assert.equal(setupCovers(t), false, `${t.cap} could widen an agent or a sign-in`);
    // sharing a Vault item or folder with people or groups is setup (l-vaultmatrix; setupRefusal refuses an agent as the subject); reading a value back never is
    if (/^vault\.(item\.reveal|export|items\.export|use|fill|inject)/.test(t.cap)) assert.equal(setupCovers(t), false, `${t.cap} reads a secret`);
  }
});

test("with the setup grant, an outside agent's person-only call goes to the pipeline as the agent with setupGrant; without it, as an ask", async () => {
  const seen: Array<{ cap: string; askPerson?: string | undefined; setupGrant?: boolean | undefined }> = [];
  const spy: Invoke = async (cap, _input, seed) => { seen.push({ cap, askPerson: seed.askPerson, setupGrant: seed.setupGrant }); return { status: "ok", output: { ok: true }, traceId: "t" }; };
  let granted = true;
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: spy, open: async () => outside(), setupGrant: () => granted });
  const call = async (name: string) => JSON.parse((await server.handle({ method: "POST", headers: { authorization: "Bearer out" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "use_tool", arguments: { name, arguments: { a: 1 } } } }) })).body).result;
  const ran = await call("members_sso_set");
  assert.equal(ran.isError, false);
  assert.deepEqual(seen.at(-1), { cap: "members.sso.set", askPerson: "always", setupGrant: true });
  await call("vault_item_put");
  assert.deepEqual(seen.at(-1), { cap: "vault.item.put", askPerson: "always", setupGrant: true }, "a key goes in as the person, not as a paste request");
  const before = seen.length;
  assert.equal((await call("vault_item_reveal")).isError, true, "reading back stays off");
  assert.equal(seen.length, before);
  granted = false;
  await call("members_sso_set");
  assert.deepEqual(seen.at(-1), { cap: "members.sso.set", askPerson: "always", setupGrant: undefined }, "taken back: an ask again");
});

test("loading up a Space is in the setup scope; groups and roles go to people only; nothing that widens an agent or goes out", () => {
  const has = (cap: string): boolean => { const t = g.catalog.all.find((x) => x.cap === cap); assert.ok(t, cap); return setupCovers(t); };
  for (const cap of ["spaces.update", "telephony.number.import", "telephony.number.assign", "schema.apply", "schema.set_label", "schema.layout.set", "import.commit", "access.groups.create", "access.groups.add_member", "access.roles.assign", "journeys.create", "automations.create", "automations.promote", "automations.set_enabled", "skills.add", "channels.create", "channels.members.add", "projects.create", "calendar.connect_provider", "calendar.sync_now"]) assert.equal(has(cap), true, cap);
  for (const cap of ["telephony.dial", "telephony.send_sms", "telephony.number.buy", "telephony.answer", "spaces.transfer_ownership", "spaces.delete", "access.roles.update", "access.roles.create", "access.groups.defaults_set", "access.share", "channels.agents.add", "projects.teammates.create", "projects.share_out", "automations.run", "automations.test", "automations.connector_share", "agents.update"]) {
    const t = g.catalog.all.find((x) => x.cap === cap);
    if (t) assert.equal(setupCovers(t), false, cap);
  }
  const groupCreate = { cap: "access.groups.create" }, addMember = { cap: "access.groups.add_member" }, assign = { cap: "access.roles.assign" };
  assert.equal(setupRefusal(groupCreate, { name: "Intake", members: [{ kind: "person", id: "usr_a" }, { kind: "person", id: "usr_b" }] }), null);
  assert.match(setupRefusal(groupCreate, { name: "Intake", members: [{ kind: "person", id: "usr_a" }, { kind: "agent", id: "agt_x" }] }) ?? "", /people only/);
  assert.match(setupRefusal(addMember, { groupId: "grp_1", member: { kind: "actor", id: "act_x" } }) ?? "", /people only/);
  assert.match(setupRefusal(assign, { subject: { kind: "service", id: "svc_x" }, roleId: "rol_admin" }) ?? "", /people only/);
  assert.match(setupRefusal(assign, { subject: { kind: "group", id: "grp_1" }, roleId: "rol_admin" }) ?? "", /people only/);
  assert.equal(setupRefusal(assign, { subject: { kind: "person", id: "usr_a" }, roleId: "rol_admin" }), null);
});
