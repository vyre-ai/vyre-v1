// The chat benchmark without the turn context, the "before" side of test/chat-brain.bench.test.ts (split from it so each file stays under its 120 s cap on a loaded runner). The same 30 tasks
// on a seeded Space (test/support/bench-tasks.ts) and the same model stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import { runMode, score } from "./support/bench-tasks.ts";

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
