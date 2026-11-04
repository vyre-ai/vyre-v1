// tool_batch: a model that cannot ask for several tools in one step (a local or custom server) gets one tool that runs up to six independent reads together and answers keyed by request id.
// The other providers do not see it. Anything that is not an independent read is refused on its own; one failed read does not stop the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiTools, BATCH_MAX } from "../src/drivers/open/api-tools.ts";
import type { ToolSession } from "../src/tools/call.ts";

const reads = new Set(["calendar_list_events", "inbox_counts", "tasks_list"]);
function make() {
  const calls: string[] = [];
  let live = 0, peak = 0;
  const session = {
    toolsFor: () => ({ level: "manage", listed: [], searchable: [] }),
    loaded: () => new Set<string>(),
    async call(_ctx: unknown, name: string) {
      calls.push(name); live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
      if (name === "tasks_list") return { kind: "error", result: { ok: false, content: { error: "nope" } } };
      return { kind: "result", result: { ok: true, content: { data: name } } };
    },
  } as unknown as ToolSession;
  const used: string[] = [];
  const tools = createApiTools({ session, space: "s", system: async () => [], isRead: (n) => reads.has(n), used: (_a, t) => used.push(t) });
  return { tools, calls, used, peak: () => peak };
}
const spec = (provider: string) => ({ account: { provider }, agent: { id: "agt" } }) as never;
const input = { threadId: "thr", turnId: "trn", agent: { id: "agt" }, asker: "usr" } as never;
const ctx = { threadId: "thr", agentId: "agt", asker: "usr", turnId: "trn" } as never;

test("a local or custom server is offered tool_batch; every other provider is not", async () => {
  const m = make();
  for (const p of ["local", "custom"]) assert.ok((await m.tools.context(spec(p), input)).tools.some((t) => t.name === "tool_batch"), p);
  for (const p of ["openai", "anthropic", "openrouter", "google", "xai", "opencode_go"]) assert.ok(!(await m.tools.context(spec(p), input)).tools.some((t) => t.name === "tool_batch"), p);
});

test("the reads in a batch run together and each answer comes back under its id; a failed read and a write do not stop the rest", async () => {
  const m = make();
  const out = await m.tools.runner({ id: "c1", name: "tool_batch", input: { requests: [
    { id: "cal", tool: "calendar_list_events", input: {} }, { id: "inb", tool: "inbox_counts" }, { id: "bad", tool: "tasks_list" }, { id: "send", tool: "mail_send", input: {} },
  ] } } as never, ctx);
  const results = (out.content as { data: { results: Record<string, { ok: boolean; content: unknown }> } }).data.results;
  assert.deepEqual(Object.keys(results), ["cal", "inb", "bad", "send"]);
  assert.equal(results["cal"]!.ok, true);
  assert.equal(results["inb"]!.ok, true);
  assert.equal(results["bad"]!.ok, false);
  assert.equal(results["send"]!.ok, false, "a write is refused by itself");
  assert.deepEqual(m.calls.sort(), ["calendar_list_events", "inbox_counts", "tasks_list"], "the write was never called");
  assert.equal(m.peak(), 3, "the reads ran at the same time");
  assert.deepEqual(m.used.sort(), ["calendar_list_events", "inbox_counts"], "the learned counts see the reads inside the batch");
});

test("at most six requests run; the rest are said to be skipped", async () => {
  const m = make();
  const out = await m.tools.runner({ id: "c1", name: "tool_batch", input: { requests: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, tool: "inbox_counts" })) } } as never, ctx);
  const results = (out.content as { data: { results: Record<string, unknown> } }).data.results;
  assert.equal(Object.keys(results).filter((k) => k.startsWith("r")).length, BATCH_MAX);
  assert.ok("_skipped" in results);
  assert.equal(m.calls.length, BATCH_MAX);
});
