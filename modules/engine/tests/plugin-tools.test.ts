// The MCP tools of plugins as tools for an API chat: listed to the model with a safe name, a read-only tool goes through engine.mcp.read and any other through engine.mcp.call (which the Gate holds
// for an agent), a call for a tool the turn has not listed yet finds it, a server that is waiting for an option is left out, and the hooks run around every call.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../../../agent/src/tools/call.ts";
import { createApiTools } from "../../../agent/src/drivers/open/api-tools.ts";
import { loadGenerated } from "../../../agent/src/tools/harness.ts";
import type { ToolCtx } from "../../../agent/src/tools/types.ts";
import { createPluginTools, matches, mcpToolName } from "../plugin-tools.ts";
import type { HookSpec, PluginRuntime, ServerSpec } from "../plugin-runtime.ts";

const spec = (key: string, over: Partial<ServerSpec> = {}): ServerSpec => ({ key, name: key.split("/").pop()!, from: "plugin", pluginId: "plg_a", transport: "stdio", command: "node", args: [], env: {}, headers: {}, needs: [], ...over });
const ctx = (thread = "thr_1"): ToolCtx => ({ space: "spc_1", agentId: "agt_1", asker: "usr_1", thread: { threadId: thread, kind: "chat", planMode: false } });

function fixture(servers: ServerSpec[], hooks: HookSpec[] = [], hookRun: (h: HookSpec, ev: any) => { code: number; stderr?: string } = () => ({ code: 0 })) {
  const ran: string[] = [];
  const invoked: Array<{ cap: string; input: unknown }> = [];
  const rt = {
    tools: async (s: ServerSpec) => (s.key === "bad/down" ? Promise.reject(new Error("down")) : [
      { name: "look up", description: "Find a thing", inputSchema: { type: "object", properties: { q: { type: "string" } } }, readOnly: true },
      { name: "change", description: "Change a thing", inputSchema: { type: "object" }, readOnly: false },
    ]),
    runHook: async (h: HookSpec, _w: unknown, ev: any) => { ran.push(`${h.event}:${ev.tool_name}`); const r = hookRun(h, ev); return { code: r.code, stdout: "", stderr: r.stderr ?? "", timedOut: false }; },
  } as unknown as PluginRuntime;
  const plugins = createPluginTools({ call: async (cap) => (cap === "plugins.mcp.servers" ? { servers } : cap === "plugins.hooks.list" ? { hooks } : {}), runtime: () => rt });
  const { catalog, defaults } = loadGenerated();
  const session = createToolSession({
    invoke: (async (cap: string, input: unknown) => { invoked.push({ cap, input }); return { status: "ok", output: { isError: false, text: "done" }, traceId: "t".repeat(32) }; }) as never,
    catalog, defaults, levelFor: () => null, canEngineer: () => false, dynamic: plugins.dynamic, hooks: plugins.hooks,
  });
  const api = createApiTools({ session, space: "spc_1", system: () => [], extra: plugins.extra });
  return { api, session, invoked, ran };
}

test("names: mcp__<server>__<tool>, only safe characters, at most 64, and two long names stay apart", () => {
  assert.equal(mcpToolName("greeter/echo", "look up"), "mcp__greeter-echo__look-up");
  const a = mcpToolName("x".repeat(80), "tool_a"), b = mcpToolName("x".repeat(80), "tool_b");
  assert.ok(a.length <= 64 && b.length <= 64 && a !== b);
  assert.ok(matches("", "x") && matches("*", "x") && matches("a|b", "b") && !matches("a", "ab") && !matches("(", "x"));
});

test("the tools of the agent's servers are listed to the model; a server waiting for an option or one that is down is left out", async () => {
  const f = fixture([spec("p/ok"), spec("p/wait", { needs: ["token"] }), spec("bad/down")]);
  const c = await f.api.context({ agent: { id: "agt_1" }, asker: "usr_1" } as never, { threadId: "thr_1", agent: { id: "agt_1" }, asker: "usr_1" } as never);
  const names = c.tools.map((t) => t.name).filter((n) => n.startsWith("mcp__"));
  assert.deepEqual(names, ["mcp__p-ok__change", "mcp__p-ok__look-up"]);
  assert.match(c.tools.find((t) => t.name === "mcp__p-ok__look-up")!.description, /^\[ok\] Find a thing/);
});

test("a read-only tool is engine.mcp.read, the other engine.mcp.call, each with the server and tool it stands for", async () => {
  const f = fixture([spec("p/ok")]);
  await f.api.context({ agent: { id: "agt_1" }, asker: "usr_1" } as never, { threadId: "thr_1", agent: { id: "agt_1" }, asker: "usr_1" } as never);
  const a = await f.session.call(ctx(), "mcp__p-ok__look-up", { q: "dana" });
  const b = await f.session.call(ctx(), "mcp__p-ok__change", { x: 1 });
  assert.equal(a.kind, "result");
  assert.equal(b.kind, "result");
  assert.match((f.invoked[1]!.input as { idempotencyKey: string }).idempotencyKey, /^mcp-[0-9a-z]+$/, "a call that may change things carries a key");
  assert.equal("idempotencyKey" in (f.invoked[0]!.input as object), false);
  assert.deepEqual(f.invoked, [
    { cap: "engine.mcp.read", input: { agentId: "agt_1", server: "p/ok", tool: "look up", input: { q: "dana" } } },
    { cap: "engine.mcp.call", input: { agentId: "agt_1", server: "p/ok", tool: "change", input: { x: 1 }, idempotencyKey: (f.invoked[1]!.input as { idempotencyKey: string }).idempotencyKey } },
  ]);
});

test("a turn that did not list its tools yet (resumed after a hold) finds the tool on its first call; an unknown name is refused", async () => {
  const f = fixture([spec("p/ok")]);
  const ok = await f.session.call(ctx("thr_resumed"), "mcp__p-ok__look-up", {});
  assert.equal(ok.kind, "result");
  const no = await f.session.call(ctx("thr_resumed"), "mcp__p-ok__nothing", {});
  assert.equal(no.kind, "error");
});

test("plan mode refuses a tool that may change things and allows a read-only one", async () => {
  const f = fixture([spec("p/ok")]);
  const plan = { ...ctx(), thread: { threadId: "thr_1", kind: "chat" as const, planMode: true } };
  await f.session.call(plan, "mcp__p-ok__look-up", {});
  const refused = await f.session.call(plan, "mcp__p-ok__change", {});
  assert.equal(refused.kind, "error");
  assert.equal(f.invoked.length, 1);
});

test("hooks: a PreToolUse hook that exits 2 stops the call with its reason; a PostToolUse hook runs after a call; a hook for another tool does not run", async () => {
  const hooks: HookSpec[] = [
    { pluginId: "plg_a", plugin: "a", event: "PreToolUse", matcher: "mcp__p-ok__change", command: "check", args: [] },
    { pluginId: "plg_a", plugin: "a", event: "PostToolUse", matcher: "*", command: "log", args: [] },
    { pluginId: "plg_a", plugin: "a", event: "PostToolUse", matcher: "records_.*", command: "other", args: [] },
  ];
  const f = fixture([spec("p/ok")], hooks, (h) => (h.command === "check" ? { code: 2, stderr: "not on a Friday" } : { code: 0 }));
  const stopped = await f.session.call(ctx(), "mcp__p-ok__change", {});
  assert.equal(stopped.kind, "error");
  assert.match(JSON.stringify(stopped.result), /not on a Friday/);
  assert.equal(f.invoked.length, 0, "the call never reached the pipeline");
  await f.session.call(ctx(), "mcp__p-ok__look-up", {});
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(f.ran, ["PreToolUse:mcp__p-ok__change", "PostToolUse:mcp__p-ok__look-up"]);
});
