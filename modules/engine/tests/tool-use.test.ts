// Learned preload: an agent's most used tools are counted and listed at the start of its next turn; a one-off use is not learned; a tool already listed for everyone is not counted; each agent has its own.
import test from "node:test";
import assert from "node:assert/strict";
import { LEARNED_MAX, recordToolUse, topTools } from "../tool-use.ts";
import { createEngineApiTools } from "../api-tools.ts";
import { harness } from "../fixtures/harness.ts";

test("the top tools are the ones used at least twice, most used first, at most ten, per agent", () => {
  const h = harness();
  const db = h.ctx.db as never;
  for (let i = 0; i < 3; i++) recordToolUse(db, "agt_a", "goals_get", 1000 + i);
  for (let i = 0; i < 5; i++) recordToolUse(db, "agt_a", "calendar_find_time", 2000 + i);
  recordToolUse(db, "agt_a", "vault_fill", 3000);   // once: an accident, not learned
  for (let i = 0; i < 2; i++) recordToolUse(db, "agt_b", "files_move", 4000 + i);
  assert.deepEqual(topTools(db, "agt_a"), ["calendar_find_time", "goals_get"]);
  assert.deepEqual(topTools(db, "agt_b"), ["files_move"]);
  assert.deepEqual(topTools(db, "agt_nobody"), []);
  for (let n = 0; n < 15; n++) for (let i = 0; i < 2; i++) recordToolUse(db, "agt_c", `tool_${String(n).padStart(2, "0")}`, 5000 + n);
  assert.equal(topTools(db, "agt_c").length, LEARNED_MAX);
});

test("a turn starts with the agent's learned tools listed, and counts what it uses, but not a tool everyone already has", async () => {
  const seen: string[] = [];
  const known = new Map<string, number>();
  const usage = { record: (a: string, t: string) => { seen.push(`${a}:${t}`); known.set(t, (known.get(t) ?? 0) + 1); }, top: (a: string) => (a === "agt_a" ? ["goals_get", "calendar_find_time"] : []) };
  const tools = createEngineApiTools({ invoke: (async () => ({ status: "ok", output: {}, traceId: "t" })) as never, space: "s", system: async () => [], call: async () => undefined, usage });
  const input = { threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_a" }, asker: "usr_1" } as never;
  const ctx = await tools.context({} as never, input);
  const listed = ctx.tools.map((t) => t.name);
  assert.ok(listed.includes("goals_get") && listed.includes("calendar_find_time"), "learned tools are listed without a search");
  const other = await tools.context({} as never, { ...(input as object), threadId: "thr_2", turnId: "trn_2", agent: { id: "agt_b" } } as never);
  assert.ok(!other.tools.map((t) => t.name).includes("goals_get"), "another agent does not get them");
  await tools.runner({ id: "c1", name: "goals_get", input: { goalId: "gol_1" } } as never, { threadId: "thr_1", agentId: "agt_a", asker: "usr_1", turnId: "trn_1" } as never);
  await tools.runner({ id: "c2", name: "tasks_list", input: {} } as never, { threadId: "thr_1", agentId: "agt_a", asker: "usr_1", turnId: "trn_1" } as never);
  assert.deepEqual(seen, ["agt_a:goals_get"], "a default-listed tool (tasks_list) is not counted");
});
