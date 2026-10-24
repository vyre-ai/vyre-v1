// Agent parity (ARCH 3.7 output 6, 6.7; spec "native"): the tools the MCP server can offer are exactly the capabilities that have an MCP surface plus the agentTools wrappers, minus the
// capabilities that opt out of agents; and what the mcp module's own capabilities report matches what the server serves.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolSearch, toolDescribe, toolsList, toolsetsList, health } from "../handlers/server.ts";
import { harness } from "../fixtures/harness.ts";
import { loadGenerated as moduleGenerated } from "../projections.ts";
import { createMcpServer, scopeAllows } from "../../../agent/src/mcp/index.ts";
import type { McpCaller, Scopes } from "../../../agent/src/mcp/index.ts";
import { fakeInvoke, loadGenerated } from "../../../agent/src/tools/harness.ts";
import type { McpToolRow } from "../../../agent/src/tools/types.ts";

const read = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
interface Cap { name: string; v: number; module: string; caller?: string; effects: string; surfaces?: { mcp?: { toolset: string }; agent?: boolean } }
const reg = JSON.parse(read("generated/registry.json")) as { capabilities: Cap[]; agentTools: Array<{ name: string; cap?: string }> };
const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
const g = loadGenerated();

const optedOut = new Set(reg.capabilities.filter((c) => c.surfaces?.agent === false).map((c) => c.name));
const mcpCaps = new Set(reg.capabilities.filter((c) => c.surfaces?.mcp !== undefined && !optedOut.has(c.name)).map((c) => c.name));
const wrapped = new Set(reg.agentTools.flatMap((a) => (a.cap !== undefined ? [a.cap] : [])).filter((c) => !optedOut.has(c)));

test("the tool list is the capability list: every MCP capability and every agentTools wrapper has a tool, nothing else does, names are unique", () => {
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names are unique");
  const toolCaps = new Set(tools.map((t) => t.cap));
  for (const c of mcpCaps) assert.ok(toolCaps.has(c), `capability ${c} has an MCP surface and no tool`);
  for (const c of wrapped) assert.ok(toolCaps.has(c), `agentTools wrapper for ${c} has no tool`);
  for (const c of toolCaps) assert.ok(mcpCaps.has(c as string) || wrapped.has(c as string), `tool for ${String(c)} has neither an MCP surface nor an agentTools entry`);
  for (const c of optedOut) assert.ok(!toolCaps.has(c), `${c} opted out of agents and still has a tool`);
  assert.equal(g.catalog.all.length, tools.length, "the catalog joins every generated tool with its capability");
});

test("agent-optout is empty today, and pre-auth capabilities are never tools", () => {
  assert.deepEqual([...optedOut], [], "no capability sets agent: false (docs/frozen/agent-tools.md)");
  const pre = reg.capabilities.filter((c) => c.caller === "anonymous" || c.caller === "pending").map((c) => c.name);
  assert.ok(pre.length >= 10);
  const toolCaps = new Set(tools.map((t) => t.cap));
  for (const c of pre) assert.ok(!toolCaps.has(c), `${c} is pre-auth and must not be an agent tool`);
});

test("the default listed set is in the catalog; everything else is found with tool_search", () => {
  for (const n of g.defaults) assert.ok(g.catalog.byName(n), `default tool ${n} exists`);
  assert.ok(g.defaults.size >= 55 && g.defaults.size <= 65, `${g.defaults.size} default tools`);
  assert.ok(g.defaults.has("tool_search"));
  assert.ok(![...g.defaults].some((n) => g.catalog.byName(n)!.toolset === "engineer"), "the engineer toolset is never in the default list");
});

test("mcp.toolsets.list counts every toolset from the generated list, and engineer is allowed only with engineer.mcp", () => {
  const hn = harness();
  const out = toolsetsList(hn.ctx, {});
  assert.equal(out.toolsets.reduce((n, t) => n + t.tools, 0), tools.length);
  assert.equal(out.toolsets.reduce((n, t) => n + t.listed, 0), g.defaults.size);
  for (const t of out.toolsets) {
    assert.equal(t.tools, tools.filter((x) => x.toolset === t.toolset).length, t.toolset);
    assert.equal(t.allowed, true);
  }
  hn.allowOnly((a) => a.perm !== "engineer.mcp");
  const noEng = toolsetsList(hn.ctx, {});
  assert.equal(noEng.toolsets.find((t) => t.toolset === "engineer")?.allowed, false);
  assert.equal(noEng.toolsets.filter((t) => !t.allowed).length, 1);
});

test("mcp.tools.list: the default set, or with includeDeferred every tool the caller may use (engineer only with engineer.mcp)", () => {
  const hn = harness();
  const def = toolsList(hn.ctx, {});
  assert.equal(def.total, g.defaults.size);
  assert.deepEqual(new Set(def.tools.map((t) => t.name)), g.defaults);
  assert.ok(def.tools.every((t) => t.deferred === false));
  const all = toolsList(hn.ctx, { includeDeferred: true });
  assert.equal(all.total, tools.length);
  assert.equal(all.tools.filter((t) => t.deferred).length, tools.length - g.defaults.size);
  hn.allowOnly((a) => a.perm !== "engineer.mcp");
  const noEng = toolsList(hn.ctx, { includeDeferred: true });
  assert.equal(noEng.total, tools.length - tools.filter((t) => t.toolset === "engineer").length);
  assert.ok(noEng.tools.every((t) => t.toolset !== "engineer"));
  const files = toolsList(hn.ctx, { toolset: "files", includeDeferred: true });
  assert.ok(files.tools.length > 20 && files.tools.every((t) => t.toolset === "files"));
});

test("mcp.tool.search and describe return the schemas, search respects the limit and toolset, describe skips what the caller may not see", () => {
  const hn = harness();
  const found = toolSearch(hn.ctx, { query: "mail send draft", limit: 5 });
  assert.ok(found.tools.length > 0 && found.tools.length <= 5);
  assert.ok(found.tools.every((t) => t.deferred && t.input !== undefined && t.summary.length > 0), "search finds deferred tools, with their schemas");
  const inFiles = toolSearch(hn.ctx, { query: "file", toolset: "files" });
  assert.ok(inFiles.tools.every((t) => t.toolset === "files"));
  assert.deepEqual(toolSearch(hn.ctx, { query: "   " }).tools, []);
  const names = [found.tools[0]!.name, "records_query", "no_such_tool"];
  const d = toolDescribe(hn.ctx, { names });
  assert.deepEqual(d.tools.map((t) => t.name), [found.tools[0]!.name, "records_query"]);
  hn.allowOnly((a) => a.perm !== "engineer.mcp");
  const eng = tools.find((t) => t.toolset === "engineer")!;
  assert.deepEqual(toolDescribe(hn.ctx, { names: [eng.name] }).tools, []);
});

test("the capability and the server agree: tool_search over MCP finds what mcp.tool.search finds, for a caller without engineer.mcp", async () => {
  const hn = harness();
  hn.allowOnly((a) => a.perm !== "engineer.mcp");
  const caller: McpCaller = { kind: "driver", sessionId: "ses_d", space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_dana", threadId: "thr_1" };
  const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fakeInvoke(g.caps).invoke, open: async () => caller });
  let n = 0;
  for (const query of ["invoice", "record history", "browser", "calendar event", "github pull request"]) {
    const r = await server.handle({ method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: "tool_search", arguments: { query } } }) });
    const over = (JSON.parse(r.body) as any).result.structuredContent.data.tools.map((t: any) => t.name) as string[];
    const cap = toolSearch(hn.ctx, { query }).tools.map((t) => t.name);
    assert.deepEqual(over, cap, `search for "${query}"`);
  }
});

test("the outside tool's list is the default set cut by its scopes, for every combination of scopes", async () => {
  const bools = [false, true];
  for (const read_ of bools) for (const post of bools) for (const cs of bools) for (const wb of bools) {
    const scopes: Scopes = { read: read_, post, readChangesets: cs, writeBranch: wb };
    const caller: McpCaller = { kind: "outside", sessionId: "ses_o", space: "spc_1", principal: { kind: "actor", id: "act_cc" }, actingFor: "usr_dana", scopes };
    const server = createMcpServer({ catalog: g.catalog, defaults: g.defaults, invoke: fakeInvoke(g.caps).invoke, open: async () => caller });
    const r = await server.handle({ method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const listed = new Set(((JSON.parse(r.body) as any).result.tools as Array<{ name: string }>).map((t) => t.name));
    const expected = new Set([...g.defaults].filter((n) => scopeAllows(scopes, g.catalog.byName(n)!)));
    assert.deepEqual(listed, expected, JSON.stringify(scopes));
    for (const n of listed) {
      const t = g.catalog.byName(n)!;
      assert.ok(!["vault", "terminal", "computer", "engineer"].includes(t.toolset), `${n} (${t.toolset}) listed for ${JSON.stringify(scopes)}`);
      if (!post && !wb) assert.ok(t.effects === "read", `${n} is not a read tool and nothing but read is on`);
    }
  }
});

test("mcp.health reports the registry hash served, the live sessions and whether this host runs the endpoint", () => {
  const hn = harness();
  const out = health(hn.ctx, {});
  assert.equal(out.registryHash, read("generated/hash.txt").trim());
  assert.equal(out.registryHash, moduleGenerated().registryHash);
  assert.equal(out.sessions, 0);
  assert.equal(out.state, "degraded", "no MCP endpoint bound on a bare test host");
  assert.ok(out.detail);
});
