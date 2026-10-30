// The chat benchmark with the turn context: all 30 tasks on a seeded Space (test/support/bench-tasks.ts). The model is a stand-in that acts only on what its prompt tells it, so the score says how far
// the information a model needs is in front of it. test/chat-brain.benchmark.ts runs both sides and prints the table; this is the "after" side, kept to a test so a regression is caught on every change.
import test from "node:test";
import assert from "node:assert/strict";
import { TASKS, runMode, score } from "./support/bench-tasks.ts";
import { report } from "./chat-brain.benchmark.ts";

/** Tasks that fail today for a reason outside the turn context. vlt-missing: an agent's vault_request cannot read who manages the folder (access.shares_of needs view for the agent), so nobody can decide it. */
const KNOWN_FAILING = new Set(["vlt-missing"]);

test("chat benchmark, with the turn context: 29 of 30 tasks are done", { timeout: 120_000 }, async () => {
  assert.equal(TASKS.length, 30);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 30);
  assert.deepEqual([...new Set(TASKS.map((t) => t.area))].sort(), ["automations", "computer", "files", "records", "routines", "vault", "where"]);
  const after = await runMode("after");
  assert.deepEqual(after.filter((r) => !r.pass && !KNOWN_FAILING.has(r.id)).map((r) => `${r.id}: ${r.why}`), []);
  const s = score(after);
  assert.ok(s.pass >= 29, `${s.pass} of ${s.total} passed`);
  assert.ok(s.calls <= 70, `${s.calls} tool calls`);
  const table = report(after, after);   // the table the runner prints
  assert.match(table, /^task +before +after +tool calls b\/a\n/);
  assert.match(table, new RegExp(`TOTAL +before ${s.pass}/30 `));
});
