import test from "node:test";
import assert from "node:assert/strict";
import { createTurnStreams, turnRowId } from "./turn-streams.ts";

const f = (turn: string, delta: Record<string, unknown>) => ({ t: "turn", turn, delta: { threadId: "thr_a", agentId: "agt_x", ...delta } });
function timers() {
  let n = 0;
  const live = new Map<number, { fn: () => void; ms: number }>();
  return { set: (fn: () => void, ms: number) => { live.set(++n, { fn, ms }); return n; }, clear: (h: unknown) => { live.delete(h as number); }, fire: (ms: number) => { for (const [k, v] of [...live]) if (v.ms <= ms) { live.delete(k); v.fn(); } }, count: () => live.size };
}
const text = (s: ReturnType<ReturnType<typeof createTurnStreams>["streamOf"]> ) => JSON.stringify(s?.getSnapshot().blocks ?? []);

test("a turn opens on its first frame, grows with each piece, ends, and is named by its message", () => {
  const t = timers();
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear });
  let heard = 0;
  s.subscribe(() => heard++);
  assert.deepEqual(s.turnsOf("thr_a"), []);
  s.onFrame(f("trn_1", { kind: "start" }));
  assert.equal(s.turnsOf("thr_a").length, 1);
  assert.equal(s.turnsOf("thr_a")[0]?.state, "writing");
  s.onFrame(f("trn_1", { kind: "delta", text: "Hel" }));
  s.onFrame(f("trn_1", { kind: "delta", text: "lo." }));
  s.onFrame(f("trn_1", { kind: "end", state: "done" }));
  assert.equal(s.turnsOf("thr_a")[0]?.state, "ended");
  assert.match(text(s.streamOf(turnRowId("trn_1"))), /Hello\./);
  assert.equal(s.streamOf(turnRowId("trn_1"))?.getSnapshot().done, true);
  s.onFrame(f("trn_1", { kind: "final", messageId: "msg_9" }));
  assert.equal(s.turnsOf("thr_a")[0]?.messageId, "msg_9");
  assert.equal(s.streamOf("msg_9"), s.streamOf(turnRowId("trn_1")), "the saved message reads the same store");
  s.settle("msg_9");
  assert.deepEqual(s.turnsOf("thr_a"), []);
  assert.equal(s.streamOf("msg_9"), undefined);
  assert.ok(heard >= 3);
});

test("a delta for a turn whose start was missed still opens it; other threads are kept apart", () => {
  const s = createTurnStreams();
  s.onFrame(f("trn_1", { kind: "delta", text: "late" }));
  s.onFrame({ t: "turn", turn: "trn_2", delta: { kind: "start", threadId: "thr_b", agentId: "agt_y" } });
  assert.equal(s.turnsOf("thr_a").length, 1);
  assert.equal(s.turnsOf("thr_b").length, 1);
  assert.equal(s.turnsOf("thr_c").length, 0);
});

test("a turn that made no message goes away at once", () => {
  const s = createTurnStreams();
  s.onFrame(f("trn_1", { kind: "start" }));
  s.onFrame(f("trn_1", { kind: "end", state: "cancelled" }));
  s.onFrame(f("trn_1", { kind: "final", messageId: null }));
  assert.deepEqual(s.turnsOf("thr_a"), []);
});

test("a turn that goes quiet is dropped, and a finished one waits only so long for its row", () => {
  const t = timers();
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear, quietMs: 90_000, settleMs: 10_000 });
  s.onFrame(f("trn_1", { kind: "start" }));
  s.onFrame(f("trn_2", { kind: "start" }));
  s.onFrame(f("trn_2", { kind: "end", state: "done" }));
  t.fire(10_000);
  assert.deepEqual(s.turnsOf("thr_a").map((x) => x.turnId), ["trn_1"], "the finished turn gave up waiting; the writing one has a longer rope");
  t.fire(90_000);
  assert.deepEqual(s.turnsOf("thr_a"), []);
  assert.equal(t.count(), 0);
});

test("frames that are not turn frames, or are malformed, change nothing", () => {
  const s = createTurnStreams();
  let heard = 0;
  s.subscribe(() => heard++);
  for (const x of [null, 7, "x", { t: "ev" }, { t: "turn" }, { t: "turn", turn: "trn_1" }, { t: "turn", turn: "trn_1", delta: { kind: "start" } }, { t: "turn", turn: "trn_1", delta: { kind: "bogus", threadId: "thr_a", agentId: "agt_x" } }]) s.onFrame(x);
  assert.equal(heard, 0);
  assert.deepEqual(s.turnsOf("thr_a"), []);
});

test("reset forgets every turn when the link drops", () => {
  const s = createTurnStreams();
  s.onFrame(f("trn_1", { kind: "start" }));
  s.reset();
  assert.deepEqual(s.turnsOf("thr_a"), []);
});
