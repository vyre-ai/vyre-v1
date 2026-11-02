// @tsx
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

test("a chat with no live turn reads the very same list every time, so a store snapshot stays stable", () => {
  const s = createTurnStreams();
  assert.equal(s.turnsOf("thr_a"), s.turnsOf("thr_a"));
  s.onFrame(f("trn_1", { kind: "start" }));
  const one = s.turnsOf("thr_a");
  assert.equal(s.turnsOf("thr_a"), one, "unchanged until something about a turn changes");
  s.onFrame(f("trn_1", { kind: "delta", text: "x" }));
  assert.equal(s.turnsOf("thr_a"), one, "text arriving changes the store, not the list");
  s.onFrame(f("trn_1", { kind: "end", state: "done" }));
  assert.notEqual(s.turnsOf("thr_a"), one, "a state change makes a new list");
  s.reset();
  assert.equal(s.turnsOf("thr_a"), s.turnsOf("thr_b"), "empty is one list");
});

test("a chat opened mid-turn takes the text so far and follows from there, with no piece doubled or lost", () => {
  const t = timers();
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear });
  const gaps: string[] = [];
  s.onGap((th) => gaps.push(th));
  // a piece arrives for a turn whose start this device never saw: held, and the host is asked
  s.onFrame(f("trn_1", { kind: "delta", text: "lo, ", at: 3 }));
  assert.deepEqual(gaps, ["thr_a"]);
  assert.equal(s.turnsOf("thr_a").length, 1);
  s.onFrame(f("trn_1", { kind: "delta", text: "wor", at: 7 }));
  // the host answers with what it has: "Hello, " (7 characters), which already holds the first held piece
  s.seed("thr_a", [{ turnId: "trn_1", agentId: "agt_x", text: "Hello, " }]);
  s.onFrame(f("trn_1", { kind: "delta", text: "ld.", at: 10 }));
  s.onFrame(f("trn_1", { kind: "delta", text: "wor", at: 7 }));   // a repeat adds nothing
  // a second seed of the same text changes nothing
  s.seed("thr_a", [{ turnId: "trn_1", agentId: "agt_x", text: "Hello, world." }]);
  s.onFrame(f("trn_1", { kind: "end", state: "done" }));   // the store shows its text once flushed
  assert.match(text(s.streamOf(turnRowId("trn_1"))), /Hello, world\./);
  assert.doesNotMatch(text(s.streamOf(turnRowId("trn_1"))), /worwor|lolo|world\.world|Hello, Hello/);
  // a turn this device never heard of is created by the seed alone
  s.seed("thr_a", [{ turnId: "trn_2", agentId: "agt_x", text: "Already writing" }]);
  assert.equal(s.turnsOf("thr_a").length, 2);
});

test("a long piece from the provider is shown a few words at a time, and everything waiting is shown when the turn ends", () => {
  const t = timers();
  const pushes: string[] = [];
  let ended = false;
  const store = { push: (x: string) => { pushes.push(x); }, end: () => { ended = true; }, getSnapshot: () => ({ blocks: [], closedCount: 0, done: ended, version: 0 }), subscribe: () => () => undefined, reset: () => undefined, stats: () => ({}) } as never;
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear, makeStore: () => store });
  s.onFrame(f("trn_p", { kind: "start" }));
  const words = Array.from({ length: 30 }, (_, i) => `w${i + 1}`);
  s.onFrame(f("trn_p", { kind: "delta", text: words.join(" "), at: 0 }));
  assert.deepEqual(pushes, [], "nothing at once: the words wait for their beats");
  const sizes: number[] = [];
  for (let i = 0; i < 4; i++) { t.fire(45); sizes.push(pushes.join("").split(/\s+/).filter(Boolean).length); }
  assert.ok(sizes[0]! >= 1 && sizes[0]! < 30, `the first beat shows a few words, not the sentence: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.every((n, i) => i === 0 || n > sizes[i - 1]!) && sizes.at(-1)! < 30, `and each beat adds more: ${JSON.stringify(sizes)}`);
  s.onFrame(f("trn_p", { kind: "end", state: "done" }));
  assert.equal(pushes.join(""), words.join(" "), "the turn ended: every word is there, once, in order");
  assert.ok(ended);
});

test("text so far (a chat opened mid-turn) is shown at once, not paced", () => {
  const t = timers();
  const pushes: string[] = [];
  const store = { push: (x: string) => { pushes.push(x); }, end: () => undefined, getSnapshot: () => ({ blocks: [], closedCount: 0, done: false, version: 0 }), subscribe: () => () => undefined, reset: () => undefined, stats: () => ({}) } as never;
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear, makeStore: () => store });
  s.seed("thr_a", [{ turnId: "trn_s", agentId: "agt_x", text: "already written so far" }]);
  assert.deepEqual(pushes, ["already written so far"]);
});

test("step and thinking frames build what the turn is doing, in order, and are gone with the turn", () => {
  const t = timers();
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear });
  s.onFrame(f("trn_a", { kind: "start" }));
  const act = s.activityOf(turnRowId("trn_a"))!;
  let heard = 0;
  act.subscribe(() => heard++);
  s.onFrame(f("trn_a", { kind: "thinking", text: "Let me look " }));
  s.onFrame(f("trn_a", { kind: "thinking", text: "at the file." }));
  s.onFrame(f("trn_a", { kind: "step", phase: "call", id: "t1", name: "Read" }));
  assert.equal(act.get().thinking, "Let me look at the file.");
  assert.deepEqual(act.get().steps, [{ id: "t1", name: "Read", state: "live" }]);
  s.onFrame(f("trn_a", { kind: "step", phase: "input", id: "t1", detail: "model.ts" }));
  assert.equal(act.get().steps[0]?.detail, "model.ts");
  s.onFrame(f("trn_a", { kind: "step", phase: "result", id: "t1", name: "Read", ok: true }));
  s.onFrame(f("trn_a", { kind: "step", phase: "call", id: "t2", name: "Bash" }));
  s.onFrame(f("trn_a", { kind: "step", phase: "result", id: "t2", ok: false }));
  assert.deepEqual(act.get().steps.map((x) => x.state), ["done", "failed"]);
  assert.ok(heard >= 5, "each change tells the line");
  s.onFrame(f("trn_a", { kind: "step", phase: "call", id: "t1", name: "Read" }));
  assert.equal(act.get().steps.length, 2, "a repeated call frame adds nothing");
  s.onFrame(f("trn_a", { kind: "final", messageId: null }));
  assert.equal(s.activityOf(turnRowId("trn_a")), undefined, "gone with the turn");
});

test("a frame of gathered steps reads as the steps it carries, in order", () => {
  const t = timers();
  const s = createTurnStreams({ setTimer: t.set, clearTimer: t.clear });
  s.onFrame(f("trn_1", { kind: "start" }));
  s.onFrame(f("trn_1", { kind: "steps", steps: [{ phase: "call", id: "s1", name: "Read" }, { phase: "input", id: "s1", detail: "notes.md" }, { phase: "result", id: "s1", ok: true }, { phase: "call", id: "s2", name: "Bash" }] }));
  assert.deepEqual(s.activityOf(turnRowId("trn_1"))?.get().steps.map((x) => [x.id, x.state, x.detail]), [["s1", "done", "notes.md"], ["s2", "live", undefined]]);
});
