// ui/Status StateMark: one small glyph per state of a row's work. Ten states, ten outlines (never told by colour alone), the words in the accessible name and the tip, and no word drawn in the row.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MARK_COLOR, STATE_MARKS, StateMark, WORK_STATES, stateWords } from "./StateMark.tsx";
import type { WorkState } from "./StateMark.tsx";

const html = (state: WorkState, o: { note?: string; tip?: boolean; testID?: string } = {}): string =>
  renderToStaticMarkup(<StateMark state={state} {...o} />);

test("the ten states: needs review, approval, an answer, a signature; blocked, overdue, failed; waiting, done, running", () => {
  assert.deepEqual(WORK_STATES, [
    "review",
    "allow",
    "answer",
    "sign",
    "blocked",
    "overdue",
    "failed",
    "waiting",
    "done",
    "running",
  ]);
});

test("no two states share an outline, so colour is never the only signal", () => {
  const outlines = WORK_STATES.map((s) => STATE_MARKS[s].d.join(" "));
  assert.equal(new Set(outlines).size, WORK_STATES.length);
  // the states that share a colour are the ones that must differ by shape: check each tone's members pairwise
  const byTone = new Map<string, WorkState[]>();
  for (const s of WORK_STATES) byTone.set(STATE_MARKS[s].tone, [...(byTone.get(STATE_MARKS[s].tone) ?? []), s]);
  assert.deepEqual(byTone.get("yours"), ["review", "allow", "answer", "sign"]);
  assert.deepEqual(byTone.get("warn"), ["blocked", "overdue"]);
  assert.deepEqual(byTone.get("bad"), ["failed"]);
  assert.deepEqual(byTone.get("quiet"), ["waiting", "done"]);
  assert.deepEqual(byTone.get("live"), ["running"]);
});

test("colour comes from tokens only, and only three carry meaning: accent is yours, amber and red are wrong, the rest is ink or the live beacon", () => {
  assert.deepEqual(MARK_COLOR, {
    yours: "var(--accent)",
    warn: "var(--warn)",
    bad: "var(--danger)",
    quiet: "var(--ink-3)",
    live: "var(--beacon)",
  });
  for (const s of WORK_STATES) {
    const h = html(s);
    assert.ok(h.includes(`stroke:${MARK_COLOR[STATE_MARKS[s].tone]}`), s);
    assert.doesNotMatch(h, /#[0-9a-fA-F]{3,8}\b/, `${s}: no colour by hand`);
  }
});

test("the row draws the glyph and never the word; the word is the accessible name and the tip", () => {
  for (const s of WORK_STATES) {
    const h = html(s);
    const m = STATE_MARKS[s];
    assert.match(h, /<svg[^>]*aria-hidden="true"/, s);
    assert.ok(h.includes(`aria-label="${m.words}"`), `${s} is named for a screen reader`);
    assert.ok(h.includes(`title="${m.words}"`), `${s} says its words on hover and focus (ui/Tooltip)`);
    assert.match(h, /role="img"/, s);
    assert.doesNotMatch(h.replace(/<[^>]*>/g, ""), /\S/, `${s}: no text is drawn`);
    assert.ok(h.includes(`data-state="${s}"`) && h.includes(`data-tone="${m.tone}"`), s);
  }
});

test("a note is the reason: said after the words, on the tip's second line", () => {
  const h = html("blocked", { note: "Sol needs a key to continue" });
  assert.ok(h.includes('aria-label="Blocked: Sol needs a key to continue"'));
  assert.ok(h.includes('title="Blocked\nSol needs a key to continue"'));
  assert.equal(stateWords("review"), "Needs your review");
  assert.equal(stateWords("failed", "The AI provider did not answer"), "Failed: The AI provider did not answer");
});

test("tip={false} draws no tip of its own (the row already says the state), and the name stays", () => {
  const h = html("allow", { tip: false, testID: "row-state" });
  assert.doesNotMatch(h, /title=/);
  assert.ok(h.includes('aria-label="Needs your approval"'));
  assert.ok(h.includes('data-testid="row-state"'));
});

test("the mark is not a button: it takes no press of its own, so a press on it is a press on its row", () => {
  for (const s of WORK_STATES) assert.doesNotMatch(html(s), /role="button"|tabindex/i, s);
});

test("running is the only mark that moves, and it is still under reduced motion", async () => {
  const { STATE_MARK_CSS } = await import("./StateMark.tsx");
  assert.match(html("running"), /class="vyre-sm-running"/);
  for (const s of WORK_STATES.filter((x) => x !== "running")) assert.doesNotMatch(html(s), /vyre-sm-running/, s);
  assert.match(STATE_MARK_CSS, /prefers-reduced-motion:reduce\)\{\.vyre-sm-running\{animation:none\}/);
});

test("the eye has a filled pupil; every other mark is line only", () => {
  assert.match(html("review"), /fill="var\(--accent\)"/);
  for (const s of WORK_STATES.filter((x) => x !== "review")) assert.doesNotMatch(html(s), /fill="var\(/, s);
});
