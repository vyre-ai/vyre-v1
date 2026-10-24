// Compaction and rollover (ARCH 6.9, from 0.6 rollover.js): how full a window is, when to roll, the rolling summary and what a rolled session starts from.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLL, SUMMARY_CHARS, contextOf, createTranscript, decide, extractiveSummary, fit, personTurn, pointersOf, refreshSummary, rollSeed, rolloverCheck, windowFor,
} from "../src/transcript/index.ts";
import type { SummarizeInput, Transcript } from "../src/transcript/index.ts";
import { createTurnBuilder } from "../src/transcript/index.ts";

const T = "thr_a";
function chat(n: number, size = 40): Transcript {
  const t = createTranscript();
  for (let i = 1; i <= n; i++) t.append(personTurn({ threadId: T, authorId: "usr_dana", text: `ask ${i}: ${"w".repeat(size)}`, at: i }));
  return t;
}

test("windows by model", () => {
  assert.equal(windowFor("claude-sonnet-5-5", "anthropic"), 200_000);
  assert.equal(windowFor("claude-opus-4[1m]", "anthropic"), 1_000_000);
  assert.equal(windowFor("gemini-2.5-pro", "google"), 1_000_000);
  assert.equal(windowFor("gpt-5-codex", "openai"), 258_400);
  assert.equal(windowFor("grok-4", "xai"), 256_000);
  assert.equal(windowFor("some-local-model", "local"), 128_000);
  assert.equal(windowFor(null, null), 200_000);
});

test("a reported count wins; with none, the characters said are estimated against the model's window", () => {
  const r = contextOf({ used: 100_000, window: 200_000 });
  assert.deepEqual([r.used, r.window, r.share, r.source], [100_000, 200_000, 0.5, "reported"]);
  const e = contextOf({ chars: 400_000, model: "claude-sonnet-5-5" });
  assert.deepEqual([e.used, e.window, e.source], [100_000 + ROLL.baseline, 200_000, "estimated"]);
  assert.equal(contextOf({ chars: 0, model: "gpt-5" }).used, ROLL.baseline);
});

test("the decision to roll", () => {
  const rep = (share: number) => ({ share, source: "reported" as const });
  assert.deepEqual(decide({ ctx: rep(0.5) }), { roll: false, why: "below the threshold" });
  assert.deepEqual(decide({ ctx: rep(0.8) }), { roll: true, why: "at the threshold" });
  assert.deepEqual(decide({ ctx: rep(0.95) }), { roll: true, why: "forced" });
  assert.deepEqual(decide({ ctx: rep(0.85), blocked: "a build is running" }), { roll: false, why: "waiting for: a build is running", wait: true });
  assert.deepEqual(decide({ ctx: rep(0.85), blocked: "a build is running", waited: 3 }), { roll: true, why: "waited 3 turns for: a build is running" });
  assert.deepEqual(decide({ ctx: rep(0.91), blocked: "a build is running" }), { roll: true, why: "forced (a build is running)" });
  assert.deepEqual(decide({ ctx: rep(0.9), sinceRoll: 4 }), { roll: false, why: "rolled 4 turns ago" }, "a seed already over the line never rolls again at once");
  assert.equal(decide({ ctx: rep(0.9), sinceRoll: 10 }).roll, true);
  // An estimate errs early: 5/6 of the share a report would need.
  assert.equal(decide({ ctx: { share: 0.7, source: "estimated" } }).roll, true);
  assert.equal(decide({ ctx: { share: 0.7, source: "reported" } }).roll, false);
  assert.equal(decide({ ctx: { share: 0.5, source: "reported" }, limits: { at: 0.4 } }).roll, true, "a setting moves the line");
});

test("rolloverCheck estimates from the transcript when the engine reports nothing", () => {
  const small = chat(3);
  const none = rolloverCheck(small, { threadId: T, model: "claude-sonnet-5-5" });
  assert.equal(none.roll, false);
  assert.equal(none.ctx.source, "estimated");

  const big = createTranscript();
  for (let i = 1; i <= 10; i++) big.append(personTurn({ threadId: T, authorId: "usr_dana", text: "q".repeat(50_000), at: i }));
  const full = rolloverCheck(big, { threadId: T, model: "claude-sonnet-5-5" });
  assert.equal(full.roll, true);
  assert.ok(full.ctx.share > 0.6);
  assert.equal(rolloverCheck(big, { threadId: T, model: "claude-sonnet-5-5", fromTurn: 10 }).roll, false, "only what was said since the last roll counts");
  assert.equal(rolloverCheck(big, { threadId: T, used: 50_000, window: 200_000 }).ctx.source, "reported");
});

test("the rolling summary is refreshed in steps, and only from turns it does not yet cover", async () => {
  const t = chat(30);
  const calls: SummarizeInput[] = [];
  const summarize = async (i: SummarizeInput): Promise<string> => { calls.push(i); return `${i.previous}\nsummary through ${i.turns.at(-1)?.n}`.trim(); };

  const first = await refreshSummary(t, summarize, { threadId: T, now: () => 7 });
  assert.deepEqual([first?.upTo, first?.by, first?.at], [10, "summarizer", 7]);
  assert.deepEqual([calls[0]?.previous, calls[0]?.turns.length, calls[0]?.turns[0]?.n, calls[0]?.maxChars], ["", 10, 1, SUMMARY_CHARS]);

  for (let i = 31; i <= 33; i++) t.append(personTurn({ threadId: T, authorId: "usr_dana", text: `ask ${i}`, at: i }));
  await refreshSummary(t, summarize, { threadId: T });
  assert.equal(calls.length, 1, "3 waiting turns are fewer than 6: no call");

  for (let i = 34; i <= 36; i++) t.append(personTurn({ threadId: T, authorId: "usr_dana", text: `ask ${i}`, at: i }));
  const second = await refreshSummary(t, summarize, { threadId: T });
  assert.equal(calls.length, 2);
  assert.deepEqual([calls[1]?.previous, calls[1]?.turns.map((x) => x.n)], ["summary through 10", [11, 12, 13, 14, 15, 16]]);
  assert.equal(second?.upTo, 16);
  assert.equal(second?.text, "summary through 10\nsummary through 16");
});

test("with no summarizer, an empty answer or a failure, the plain extract stands in and the turns are never lost", async () => {
  for (const summarize of [undefined, async () => "   ", async () => { throw new Error("down"); }]) {
    const t = chat(30);
    const s = await refreshSummary(t, summarize, { threadId: T });
    assert.equal(s?.by, "extract");
    assert.equal(s?.upTo, 10);
    assert.match(s?.text ?? "", /^Asked \(turn 1\): ask 1: w+\nAsked \(turn 2\)/);
    assert.equal(t.count(T), 30, "the summary stands in for turns in a hand-over; the turns stay");
  }
});

test("the extract names asks, answers, tool counts and failures", () => {
  const t = createTranscript();
  t.append(personTurn({ threadId: T, authorId: "usr_dana", text: "Check the deed", at: 1 }));
  const b = createTurnBuilder({ threadId: T, authorId: "agt_a", engine: "anthropic", model: null, now: () => 2 });
  b.push({ type: "text", text: "Checked it." });
  b.push({ type: "tool_call", id: "c", name: "Read", input: { file_path: "deed.pdf" } });
  t.append(b.build());
  const f = createTurnBuilder({ threadId: T, authorId: "agt_a", engine: "anthropic", model: null, now: () => 3 });
  f.push({ type: "error", code: "provider.overloaded", message: "busy" });
  t.append(f.build());
  assert.equal(
    extractiveSummary("earlier line", t.turns(T)),
    "earlier line\nAsked (turn 1): Check the deed\nAnswered (turn 2), 1 tool call: Checked it.\nAnswered (turn 3): no words (failed: provider.overloaded)",
  );
});

test("fit keeps the newest lines whole under the cap", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1} ${"k".repeat(80)}`);
  const out = fit(lines.join("\n"), 1_000);
  assert.ok(out.length <= 1_000);
  assert.match(out, /^\[earlier lines of this summary were dropped/);
  assert.ok(out.endsWith(`line 100 ${"k".repeat(80)}`));
  assert.ok(!out.includes("line 1 "));
  assert.equal(fit("short", 1_000), "short");
  assert.ok(fit("z".repeat(5_000), 1_000).length <= 1_000, "one line longer than the cap keeps its tail");
});

test("a rolled session starts from the summary, the pointers and the last turns", async () => {
  const t = chat(30);
  const seed = await rollSeed(t, async () => "Dana asked 10 things about the Lee estate.", { threadId: T, now: () => 1 });
  assert.match(seed.text, /rolled over to keep the window small/);
  assert.match(seed.text, /Summary of the conversation so far \(up to turn 10\):\n  \| Dana asked 10 things about the Lee estate\./);
  assert.match(seed.text, /Earlier in this conversation \(10 turns before what follows\)/);
  assert.match(seed.text, /ask 30:/);
  assert.equal(seed.turns, 20);
  assert.equal(t.summary(T)?.upTo, 10);
});

test("pointers: one per request, thinned evenly with the newest kept, plus files and commits", () => {
  const t = createTranscript();
  for (let i = 1; i <= 100; i++) t.append(personTurn({ threadId: T, authorId: "usr_dana", text: `request ${i}`, at: i }));
  const p = pointersOf(t.turns(T), 10);
  assert.equal(p.lines.length, 10);
  assert.ok(p.lines[0]?.startsWith("#1 "), "the oldest stretch keeps a pointer");
  assert.ok(p.lines.at(-1)?.startsWith("#100 "));
  assert.deepEqual(p.lines.slice(-6).map((l) => l.split(" ")[0]), ["#95", "#96", "#97", "#98", "#99", "#100"], "the newest window gets most of the lines");
  assert.equal(p.turns, 100);

  const w = createTranscript();
  const b = createTurnBuilder({ threadId: T, authorId: "agt_a", engine: "claude_code", model: null, now: () => 1, cwd: "/w" });
  b.push({ type: "tool_call", id: "1", name: "Edit", input: { file_path: "/w/src/a.ts" } });
  b.push({ type: "tool_call", id: "2", name: "Bash", input: { command: "git commit -m x" } });
  b.toolResult("2", { ok: true, content: "[main abc1234] x" });
  w.append(b.build());
  assert.deepEqual(pointersOf(w.turns(T)).files, [{ ref: "src/a.ts", at: [1] }]);
  assert.deepEqual(pointersOf(w.turns(T)).commits, [{ ref: "abc1234", at: 1 }]);
});
