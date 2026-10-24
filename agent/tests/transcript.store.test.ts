// The transcript store (ARCH 6.9): per-thread turn numbers, the rolling summary that only moves forward, switches, search and the rendered chats/<id>/transcript.md.
import test from "node:test";
import assert from "node:assert/strict";
import { createTranscript, createTurnBuilder, personTurn } from "../src/transcript/index.ts";
import type { Transcript } from "../src/transcript/index.ts";

const T = "thr_a";
const ask = (t: Transcript, text: string, at: number, thread = T) => t.append(personTurn({ threadId: thread, authorId: "usr_dana", text, at }));
function answer(t: Transcript, text: string, at: number, withTool = false) {
  const b = createTurnBuilder({ threadId: T, authorId: "agt_intake", engine: "claude_code", model: "claude-sonnet-5-5", now: () => at });
  b.push({ type: "text", text });
  if (withTool) {
    b.push({ type: "tool_call", id: "c1", name: "Read", input: { file_path: "notes/intake.md" } });
    b.toolResult("c1", { ok: true, content: "# Intake notes\nline two" });
  }
  return t.append(b.build());
}

test("turn numbers count from 1 in each thread and read back by number", () => {
  const t = createTranscript();
  assert.equal(ask(t, "first", 1).n, 1);
  assert.equal(answer(t, "second", 2).n, 2);
  assert.equal(ask(t, "other thread", 3, "thr_b").n, 1);
  assert.equal(t.count(T), 2);
  assert.equal(t.count("thr_b"), 1);
  assert.equal(t.count("thr_none"), 0);
  assert.deepEqual(t.turns(T).map((x) => x.n), [1, 2]);
  assert.deepEqual(t.turns(T, 2).map((x) => x.n), [2]);
  assert.equal(t.get(T, 2)?.role, "agent");
  assert.equal(t.get(T, 3), null);
  assert.equal(t.get(T, 0), null);
});

test("the rendered file only grows at the end, and a partial render has no header", () => {
  const t = createTranscript();
  ask(t, "Draft the closing letter for the Lee estate.", Date.UTC(2026, 9, 1, 9, 0, 0));
  answer(t, "Drafted. See the letter.", Date.UTC(2026, 9, 1, 9, 1, 0), true);
  const two = t.render(T, { title: "Lee estate" });
  ask(t, "Change the date to Friday.", Date.UTC(2026, 9, 1, 9, 5, 0));
  const three = t.render(T, { title: "Lee estate" });

  assert.ok(three.startsWith(two), "append-only: earlier turns never change");
  assert.ok(three.length > two.length);
  assert.ok(two.startsWith("# Lee estate\n\n## Turn 1: person usr_dana, 2026-10-01T09:00:00.000Z\n"));
  assert.match(two, /## Turn 2: agent agt_intake on claude_code claude-sonnet-5-5, 2026-10-01T09:01:00\.000Z/);
  assert.match(two, /- Read notes\/intake\.md -> ok: # Intake notes/);
  assert.ok(!three.slice(two.length).startsWith("# "), "the new turn follows the old ones directly");
  const tail = t.render(T, { from: 3 });
  assert.ok(!tail.startsWith("# "));
  assert.match(tail, /^## Turn 3: person usr_dana/);
  assert.equal(three.endsWith("Change the date to Friday.\n"), true);
});

test("a failed turn says so in the file", () => {
  const t = createTranscript();
  const b = createTurnBuilder({ threadId: T, authorId: "agt_intake", engine: "anthropic", model: null, now: () => 1 });
  b.push({ type: "error", code: "provider.rate_limited", message: "slow down" });
  t.append(b.build());
  assert.match(t.render(T), /Failed: provider\.rate_limited: slow down/);
});

test("the summary only moves forward, and it is redacted like every other text", () => {
  const t = createTranscript();
  const key = ["sk", "ant", "api03", "B".repeat(24)].join("-");
  t.setSummary({ threadId: T, text: `asked about ${key}`, upTo: 10, by: "summarizer", at: 1 });
  assert.ok(!t.summary(T)?.text.includes(key));
  t.setSummary({ threadId: T, text: "older", upTo: 5, by: "summarizer", at: 2 });
  assert.equal(t.summary(T)?.upTo, 10, "an older summary never replaces a newer one");
  t.setSummary({ threadId: T, text: "newer", upTo: 12, by: "extract", at: 3 });
  assert.deepEqual([t.summary(T)?.text, t.summary(T)?.by], ["newer", "extract"]);
  assert.equal(t.summary("thr_none"), null);
});

test("switches are kept in order, copied on the way in and out", () => {
  const t = createTranscript();
  const from = { driver: "claude_code", provider: "anthropic", model: "m1" };
  const to = { driver: "codex", provider: "openai", model: "m2" };
  t.recordSwitch({ threadId: T, agentId: "agt_a", at: 1, atTurn: 4, from, to, handoffTurns: 4, by: "usr_dana" });
  t.recordSwitch({ threadId: T, agentId: "agt_a", at: 2, atTurn: 6, from: to, to: from, handoffTurns: 2, by: "usr_dana" });
  const rows = t.switches(T);
  assert.deepEqual(rows.map((r) => [r.atTurn, r.to.driver]), [[4, "codex"], [6, "claude_code"]]);
  rows[0]!.atTurn = 99;
  assert.equal(t.switches(T)[0]?.atTurn, 4);
});

test("find ranks the turns that hold the most of the query's words", () => {
  const t = createTranscript();
  ask(t, "The Lee estate needs a closing letter and a deed", 1);
  answer(t, "Drafted the closing letter for the Lee estate.", 2);
  ask(t, "Unrelated: lunch on Friday", 3);
  const hits = t.find(T, "closing letter Lee estate");
  assert.deepEqual(hits.map((h) => h.n), [2, 1], "equal matches: the newer turn first");
  assert.ok(hits.every((h) => h.snippet.length > 0 && h.snippet.length <= 160));
  assert.deepEqual(t.find(T, "zebra"), []);
  assert.deepEqual(t.find(T, "a of"), [], "short words are not searched");
  assert.equal(t.find(T, "letter", 1).length, 1);
});
