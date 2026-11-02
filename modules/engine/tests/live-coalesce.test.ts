// Live steps gather to about one frame a second and never out of order (hole 19).
import test from "node:test";
import assert from "node:assert/strict";
import { coalesceLive } from "../live-coalesce.ts";
import type { StreamEvent } from "../handlers/bridge.ts";

function rig() {
  let t = 1_000_000;
  const out: StreamEvent[] = [];
  const timers: Array<() => void> = [];
  const push = coalesceLive((e) => out.push(e), { now: () => t, later: (fn) => { timers.push(fn); return 0 as never; } });
  const step = (id: string, phase: "call" | "result" = "call"): StreamEvent => ({ kind: "step", threadId: "t", turnId: "u", agentId: "a", phase, id, name: "Read" });
  return { out, push, step, advance(ms: number) { t += ms; }, fire() { for (const f of timers.splice(0)) f(); } };
}
const kinds = (o: StreamEvent[]): string[] => o.map((e) => e.kind);

test("a burst is one frame after the first: the turn looks alive at once, and the screen is not asked to draw a hundred steps", () => {
  const r = rig();
  r.push(r.step("s0"));
  for (let i = 1; i < 100; i++) r.push(r.step(`s${i}`));
  assert.deepEqual(kinds(r.out), ["steps"], "the first goes straight away");
  r.advance(1000);
  r.fire();
  assert.deepEqual(kinds(r.out), ["steps", "steps"]);
  const second = r.out[1] as Extract<StreamEvent, { kind: "steps" }>;
  assert.equal(second.steps.length, 99);
  assert.deepEqual(second.steps.slice(0, 2).map((s) => s.id), ["s1", "s2"], "in order");
});

test("words and the end of a turn send what is waiting first, so nothing reads out of order", () => {
  const r = rig();
  r.push(r.step("s0"));
  r.push(r.step("s0", "result"));
  r.push({ kind: "delta", threadId: "t", turnId: "u", agentId: "a", text: "Done", at: 0 });
  r.push({ kind: "end", threadId: "t", turnId: "u", agentId: "a", state: "done" });
  r.push({ kind: "final", threadId: "t", turnId: "u", agentId: "a", messageId: "m" });
  assert.deepEqual(kinds(r.out), ["steps", "steps", "delta", "end", "final"]);
  r.fire();
  assert.equal(r.out.length, 5, "a timer left behind sends nothing");
});

test("thinking gathers too and stays addressed to the person who asked", () => {
  const r = rig();
  const think = (text: string): StreamEvent => ({ kind: "thinking", threadId: "t", turnId: "u", agentId: "a", text, asker: "usr_dana" });
  r.push(think("One"));
  r.push(think(" two"));
  r.push(think(" three"));
  r.advance(1000);
  r.fire();
  assert.deepEqual(r.out.map((e) => (e.kind === "thinking" ? [e.text, e.asker] : [])), [["One", "usr_dana"], [" two three", "usr_dana"]]);
});
