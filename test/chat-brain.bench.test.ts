// The chat benchmark with the turn context: all 30 tasks on a seeded Space (test/support/bench-tasks.ts). The model is a stand-in that acts only on what its prompt tells it, so the score says how far
// the information a model needs is in front of it. test/chat-brain.benchmark.ts runs both sides and prints the table; this is the "after" side, kept to a test so a regression is caught on every change.
import test from "node:test";
import assert from "node:assert/strict";
import { TASKS, runMode, score } from "./support/bench-tasks.ts";
import { report } from "./chat-brain.benchmark.ts";

const KNOWN_FAILING = new Set<string>([]);

test("chat benchmark, with the turn context: all 30 tasks are done", { timeout: 120_000 }, async () => {
  assert.equal(TASKS.length, 30);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 30);
  assert.deepEqual([...new Set(TASKS.map((t) => t.area))].sort(), ["automations", "computer", "files", "records", "routines", "vault", "where"]);
  const after = await runMode("after");
  assert.deepEqual(after.filter((r) => !r.pass && !KNOWN_FAILING.has(r.id)).map((r) => `${r.id}: ${r.why}`), []);
  const s = score(after);
  assert.equal(s.pass, 30, `${s.pass} of ${s.total} passed`);
  assert.ok(s.calls <= 70, `${s.calls} tool calls`);
  const table = report(after, after);   // the table the runner prints
  assert.match(table, /^task +before +after +tool calls b\/a\n/);
  assert.match(table, new RegExp(`TOTAL +before ${s.pass}/30 `));
});

// The other side of the benchmark: the same 30 tasks and the same model stand-in, on a turn with no context (the one-line role and the memory block, as a chat was answered before the turn
// context). The tasks that need the screen, the thread, the person's time zone or the rules of the routine tools are not done. If this passes more than it should, the contrast is gone and the
// benchmark proves nothing.
test("chat benchmark, without the turn context: the tasks that need to know where the agent is are not done", { timeout: 120_000 }, async () => {
  const before = await runMode("before");
  const passed = new Set(before.filter((r) => r.pass).map((r) => r.id));
  for (const id of ["rec-screen", "file-screen", "aut-test-then-enable", "rtn-weekly", "rtn-change", "rtn-pause", "who-me", "who-question", "who-remember"]) assert.ok(!passed.has(id), `${id} should not be done without the turn context`);
  const s = score(before);
  assert.ok(s.pass <= 22, `${s.pass} of ${s.total} passed without the turn context`);
});
