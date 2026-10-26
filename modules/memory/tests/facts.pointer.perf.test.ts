// The speed half of facts.pointer.test.ts (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// The pointer block (spec 2.15, ARCH 6.10): a local lookup with no model call, up to about five lines, 300 to 400 tokens, nothing repeated in a thread,
// none for a short acknowledgement or a step in the middle of a tool loop, and fast on a big memory.
import test from "node:test";
import assert from "node:assert/strict";
import { pointer } from "../handlers/facts.ts";
import { contractErrors, DAY, harness, NOW, seedFact, seedNote } from "../fixtures/harness.ts";

const base = { agentId: "agt_intake" };

test("the lookup is fast on a big memory", async () => {
  const h = harness();
  for (let i = 0; i < 1500; i++) seedFact(h, { id: `fct_big${i}`, layer: "agent", agentId: "agt_intake", text: `Account ${i} is owned by region ${i % 40} and renews in month ${i % 12}` });
  seedFact(h, { id: "fct_target", layer: "agent", agentId: "agt_intake", text: "Quasar contract renews in November under Fiona" });
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    const out = await pointer(h.ctx, { ...base, threadId: `thr_${i}`, text: "When does the quasar contract renew?" });
    times.push(performance.now() - t0);
    assert.equal(out.lines[0]?.fact, "Quasar contract renews in November under Fiona");
  }
  // The budget is 20 to 50 ms for a lookup. A shared CI runner can be slowed by its neighbours, so the budget is held by the best of nine and the median only has to be sane.
  const sorted = [...times].sort((a, b) => a - b);
  assert.ok(sorted[0]! < 50, `fastest ${sorted[0]} ms`);
  assert.ok(sorted[4]! < 400, `median ${sorted[4]} ms`);
});
