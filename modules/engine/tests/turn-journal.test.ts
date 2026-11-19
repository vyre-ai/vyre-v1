// The journal of a turn's tool calls in SQL (r42-runtime): written at a call's start and end under one key, read back by a host that took the thread over, dropped with its turn, swept after a week.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { sqlJournal } from "../projections.ts";
import { planResume } from "../../../agent/src/turn-engine/journal.ts";

const entry = (over: Record<string, unknown> = {}) => ({
  threadId: "thr_a",
  turnId: "trn_1",
  callId: "c1",
  name: "read_prices",
  input: { sheet: "A" },
  safety: "read" as const,
  state: "started" as const,
  at: 1_000,
  ...over,
});

test("a call is one row that is written twice: started, then answered; a second host reads it back whole", () => {
  const h = harness();
  const a = sqlJournal(h.ctx.db, () => 2_000);
  a.put(entry());
  a.put(entry({ state: "done", summary: '{"rows":3}', endedAt: 1_500 }));
  a.put(entry({ callId: "c2", name: "send_email", safety: "unsafe", at: 1_600 }));
  const b = sqlJournal(h.ctx.db, () => 2_000); // another host over the same database
  const rows = b.list("trn_1");
  assert.deepEqual(
    rows.map((r) => [r.callId, r.state, r.safety]),
    [
      ["c1", "done", "read"],
      ["c2", "started", "unsafe"],
    ],
  );
  assert.deepEqual(rows[0]!.input, { sheet: "A" });
  assert.equal(rows[0]!.summary, '{"rows":3}');
  const plan = planResume(rows);
  assert.equal(plan.resumable, false);
  assert.equal(plan.why, "unsafe_in_flight");
  assert.equal(plan.tool, "send_email");
});

test("drop removes a turn's rows and no one else's; a row a week old is swept when the next call starts", () => {
  const h = harness();
  let now = 1_000;
  const j = sqlJournal(h.ctx.db, () => now);
  j.put(entry());
  j.put(entry({ turnId: "trn_2", at: 1_000 }));
  j.drop("trn_1");
  assert.equal(j.list("trn_1").length, 0);
  assert.equal(j.list("trn_2").length, 1);
  now = 1_000 + 8 * 86_400_000;
  j.put(entry({ turnId: "trn_3", at: now }));
  assert.equal(j.list("trn_2").length, 0, "a turn that was never resumed does not stay for ever");
  assert.equal(j.list("trn_3").length, 1);
});

test("held and own-tool calls say why the turn is not resumed", () => {
  assert.equal(planResume([entry({ state: "held" })]).why, "held");
  assert.equal(planResume([entry({ own: true, safety: "unsafe" })]).why, "own_tool");
  assert.equal(planResume([]).why, "no_record");
  const ok = planResume([entry({ state: "done" }), entry({ callId: "c2", state: "started", safety: "keyed" })]);
  assert.equal(ok.resumable, true);
  assert.deepEqual(
    ok.replay.map((e) => e.callId),
    ["c2"],
  );
});
