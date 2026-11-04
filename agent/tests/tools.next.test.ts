// A list result names the tool that reads one item and lists it at once; every name is a real tool; a tool the agent may not use is never named.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createToolSession } from "../src/tools/call.ts";
import { buildCatalog, offerable, parseDefaultTools } from "../src/tools/catalog.ts";
import { NEXT_READS, nextReads } from "../src/tools/next.ts";
import type { AgentToolRow, McpToolRow, RegistryCapRow, ToolCtx } from "../src/tools/types.ts";

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
const mcp = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
const catalog = offerable(buildCatalog(reg.capabilities, mcp, reg.agentTools), () => false);
const defaults = parseDefaultTools(read("docs/frozen/agent-tools.md"));
const invoke = (async () => ({ status: "ok", output: { items: [] }, traceId: "trc_t" })) as never;
const ctx = (extra: Partial<ToolCtx> = {}): ToolCtx => ({ space: "s", agentId: "agt_1", asker: "usr_1", thread: { threadId: "thr_n", kind: "chat", planMode: false }, turnId: "trn_n", ...extra });

test("every name in the next-read table is a real tool, and the derived pair exists too", () => {
  const bad = Object.entries(NEXT_READS).flatMap(([k, v]) => [k, ...v]).filter((n) => !catalog.byName(n));
  assert.deepEqual(bad, []);
  assert.deepEqual(nextReads("widgets_list"), ["widgets_get"]);
  assert.deepEqual(nextReads("tasks_create"), []);
});

test("after tasks_list the result says to call tasks_get, and tasks_get is loaded without a search", async () => {
  const session = createToolSession({ invoke, catalog, defaults, levelFor: () => "manage", canEngineer: () => false });
  const c = ctx();
  const out = await session.call(c, "tasks_list", {});
  assert.equal(out.kind, "result");
  const content = (out as { result: { content: { next?: string } } }).result.content;
  assert.match(content.next ?? "", /call tasks_get with its id/);
  assert.ok(session.loaded("thr_n").has("tasks_get"));
  const read1 = await session.call(c, "tasks_get", { taskId: "tsk_1" });
  assert.equal(read1.kind, "result", "callable at once");
});

test("a read the agent is not allowed to use is not named", async () => {
  const session = createToolSession({ invoke, catalog, defaults, levelFor: () => "manage", canEngineer: () => false });
  const out = await session.call(ctx({ rules: { deny: ["tasks_get"] } }), "tasks_list", {});
  const content = (out as { result: { content: { next?: string } } }).result.content;
  assert.equal(content.next, undefined);
  assert.ok(!session.loaded("thr_n").has("tasks_get"));
});
