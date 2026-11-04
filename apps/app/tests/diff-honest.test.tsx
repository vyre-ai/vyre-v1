// The diff before a save, and the diff of an agent's suggestion, are a real line diff of two real texts: the saved base and the new text. Never written or summarised by a model, never the editor's idea of what changed.
// Identical text is "No changes"; a one-word edit is that line and no other; reordered lines, a long file, trailing whitespace and CRLF against LF are each told truly; and the suggestion card's diff is the diff of its stored before and after.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ReviewDataProvider, SuggestionCard } from "../src/places/files/review/index.ts";
import { applySuggestionStrict, diffLines, diffNote, draftDiff, lineHunks } from "../src/places/files/review/model.ts";
import { AGENT_MD, createSampleReview } from "../src/places/files/review/sample.ts";

const lines = (n: number, f: (i: number) => string = (i) => `line ${i}`): string => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";
const html = (el: ReactElement, s = createSampleReview({})): string => renderToStaticMarkup(<ReviewDataProvider value={s.data}>{el}</ReviewDataProvider>).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

/** What the ops say the two texts are: the old lines are the ctx and del ops, the new lines the ctx and add ops. */
const sides = (ops: ReturnType<typeof diffLines>): { a: string[]; b: string[] } => ({ a: ops.filter((o) => o.op !== "add").map((o) => o.text), b: ops.filter((o) => o.op !== "del").map((o) => o.text) });
const lcs = (a: string[], b: string[]): number => {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  return t[0]![0]!;
};

test("identical text is No changes: no hunks, no counts, no note", () => {
  assert.deepEqual(lineHunks(AGENT_MD, AGENT_MD), []);
  const d = draftDiff("AGENT.md", AGENT_MD, AGENT_MD);
  assert.deepEqual([d.added, d.removed, d.hunks.length], [0, 0, 0]);
  assert.equal(diffNote(AGENT_MD, AGENT_MD), null);
});

test("a one-word edit shows exactly that line, as it was and as it is, and no other", () => {
  const after = AGENT_MD.replace("Warm and brief", "Warm and short");
  const h = lineHunks(AGENT_MD, after);
  assert.equal(h.length, 1);
  assert.equal(h[0]!.removed, "- Warm and brief. Two sentences, then a question.");
  assert.equal(h[0]!.added, "- Warm and short. Two sentences, then a question.");
  const d = draftDiff("AGENT.md", AGENT_MD, after);
  assert.deepEqual([d.added, d.removed], [1, 1]);
});

test("the ops always rebuild both texts exactly, and are as short as the best edit script (checked against a table search on random texts)", () => {
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: rnd(14) }, () => String(rnd(5)));
    const b = Array.from({ length: rnd(14) }, () => String(rnd(5)));
    const ops = diffLines(a, b);
    const { a: ra, b: rb } = sides(ops);
    assert.deepEqual(ra, a, "the old lines are all there, in order");
    assert.deepEqual(rb, b, "the new lines are all there, in order");
    const edits = ops.filter((o) => o.op !== "ctx").length;
    assert.equal(edits, a.length + b.length - 2 * lcs(a, b), `a minimal script for ${JSON.stringify([a, b])}`);
  }
});

test("reordered lines: moving one line is one removed and one added, not a rewrite", () => {
  const a = lines(12);
  const b = a.replace("line 3\n", "").replace("line 9\n", "line 9\nline 3\n");
  const d = draftDiff("f.md", a, b);
  assert.deepEqual([d.added, d.removed], [1, 1]);
  const swap = a.replace("line 5\nline 6\n", "line 6\nline 5\n");
  const s = draftDiff("f.md", a, swap);
  assert.deepEqual([s.added, s.removed], [1, 1], "swapping two neighbours");
  assert.deepEqual(sides(diffLines(a.split("\n"), swap.split("\n"))).b, swap.split("\n"));
});

test("a long file with a few edits shows those edits and nothing else, quickly", () => {
  const a = lines(20000);
  const b = a.replace("line 100\n", "line 100 changed\n").replace("line 10000\n", "").replace("line 19999\n", "line 19999\nan added line\n");
  const t = Date.now();
  const d = draftDiff("long.md", a, b);
  assert.ok(Date.now() - t < 3000, "a 20,000 line file is quick");
  assert.deepEqual([d.hunks.length, d.added, d.removed], [3, 2, 2]);
  assert.equal(d.hunks[0]!.removed, "line 100");
  assert.equal(d.hunks[0]!.added, "line 100 changed");
  assert.equal(d.hunks[1]!.removed, "line 10000");
  assert.equal(d.hunks[2]!.added, "an added line");
  // many changes through a long file are still each told, not "everything changed"
  const c = lines(3000, (i) => (i % 7 === 0 ? `line ${i} edited` : `line ${i}`));
  const many = draftDiff("long.md", lines(3000), c);
  assert.equal(many.added, Math.floor(3000 / 7));
  assert.equal(many.removed, Math.floor(3000 / 7));
});

test("trailing whitespace is a change to that line, shown, not hidden and not spread over the file", () => {
  const a = "one\ntwo\nthree\n";
  const b = "one\ntwo \nthree\n";
  const h = lineHunks(a, b);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0]!.removed, h[0]!.added], ["two", "two "]);
});

test("line endings: CRLF against LF is a note, not every line changed", () => {
  const lf = "# Intake\nBooks calls.\nNever promise.\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  assert.deepEqual(lineHunks(lf, crlf), [], "the same lines");
  assert.match(diffNote(lf, crlf) ?? "", /Line endings changed from LF to CRLF/);
  assert.match(diffNote(crlf, lf) ?? "", /from CRLF to LF/);
  assert.equal(diffNote(lf, lf), null);
  // one changed line in a file that also changed endings is only that line
  const both = crlf.replace("Books calls.", "Books first calls.");
  const h = lineHunks(lf, both);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0]!.removed, h[0]!.added], ["Books calls.", "Books first calls."]);
  assert.ok(!h[0]!.added.includes("\r"), "no carriage returns in what is shown");
  // the final newline
  assert.match(diffNote("a\nb\n", "a\nb") ?? "", /final newline was removed/);
  assert.match(diffNote("a\nb", "a\nb\n") ?? "", /final newline was added/);
  assert.deepEqual(lineHunks("a\nb\n", "a\nb"), [], "not a changed line");
});

test("the suggestion card's diff is the diff of its stored before and after; a suggestion that does not fit says so", () => {
  const before = AGENT_MD;
  const after = before.replace("- No exclamation marks.", "- No exclamation marks.\n- Keep replies under five lines.");
  // how an agent stores its proposal: a unified diff against the file as it was
  assert.equal(applySuggestionStrict(before, "@@ -1 +1 @@\n nothing that is in the file\n-gone\n+x"), null, "a diff that is not about this text does not apply");
  const stored = ["@@ -9,3 +9,4 @@", " - Warm and brief. Two sentences, then a question.", " - No exclamation marks.", "+- Keep replies under five lines.", " - Say what happens next, always."].join("\n");
  const applied = applySuggestionStrict(before, stored);
  assert.equal(applied, after, "the stored proposal makes exactly this text");
  const fromCard = draftDiff("AGENT.md", before, applied!);
  const fromTexts = draftDiff("AGENT.md", before, after);
  assert.deepEqual(fromCard, fromTexts, "the card shows the diff of the two texts");
  assert.deepEqual([fromCard.added, fromCard.removed], [1, 0]);
  assert.equal(fromCard.hunks[0]!.added, "- Keep replies under five lines.");
});

test("the card draws the diff of the file's text against the suggestion's result, and says when it no longer fits", () => {
  const s = createSampleReview({});
  const fits = html(<SuggestionCard agentId="agt_intake" file="AGENT.md" text={AGENT_MD} />, s);
  assert.ok(fits.includes('data-testid="suggestion-card"') && fits.includes('data-testid="suggestion-diff"'), "the diff is drawn");
  assert.ok(!fits.includes('data-testid="suggestion-stale"'));
  const stale = html(<SuggestionCard agentId="agt_intake" file="AGENT.md" text={"# A different file\n\nNothing alike.\n"} />, s);
  assert.ok(stale.includes('data-testid="suggestion-stale"'), "it says it no longer fits");
  assert.ok(!stale.includes('data-testid="suggestion-diff"'), "and draws no diff it cannot stand behind");
  const apply = /<[^>]*data-testid="suggestion-apply"[^>]*>/.exec(stale)?.[0] ?? "";
  assert.ok(apply.includes('aria-disabled="true"'), "Apply is off");
});
