import test from "node:test";
import assert from "node:assert/strict";
import { DWELL_MS, lineWait, waitFor } from "./dwell.ts";
import { thinkingExcerpt } from "./activity.ts";

test("a label on screen stays 4 s: a change 0.5 s in waits 3.5 s, one past the window shows now, so changes inside the window collapse to one swap to the newest", () => {
  assert.equal(DWELL_MS, 4000);
  assert.equal(waitFor(0, 500), 3500);
  assert.equal(waitFor(0, 3999), 1);
  assert.equal(waitFor(0, 4200), 0);
});

test("a step that does appear is on screen at least a second: the dwell is the floor, far above it", () => {
  assert.ok(DWELL_MS >= 1000);
});

test("a turn that thinks: the first of its thinking shows at once, the excerpt is up by 0.7 s, and it stays up for the whole think", () => {
  // the hook's rule on a clock: one tick per 60 ms word, as the fake engine thinks; the shown words follow lineWait
  const words = "I should look at the notes first and then compare them with the plan.".split(" ");
  let shown = { label: "Thinking", detail: "" };
  let shownAt = 0;
  let due: number | null = null;
  const seen: Array<{ at: number; detail: string }> = [];
  const total = 4000;
  let said = "";
  for (let now = 0; now <= total; now += 20) {
    const k = Math.floor(now / 60);
    if (k >= 1 && k <= words.length) said = words.slice(0, k).join(" ");
    const target = { label: "Thinking", detail: thinkingExcerpt(said) };
    if (shown.detail !== target.detail) {
      const at = now + lineWait(shown, target, false, shownAt, now);
      if (due === null || at < due) due = at;
    }
    if (due !== null && now >= due) { shown = { label: shown.label, detail: thinkingExcerpt(said) }; due = null; }
    seen.push({ at: now, detail: shown.detail });
  }
  const firstShown = seen.find((x) => x.detail !== "");
  assert.ok(firstShown && firstShown.at <= 100, `the first words show at once, not after the 1.5 s beat (shown at ${firstShown?.at} ms)`);
  assert.ok(seen.filter((x) => x.at >= 700).every((x) => x.detail !== ""), "from 0.7 s the excerpt is never gone");
  assert.ok(seen.filter((x) => x.at >= 1900).every((x) => x.detail.includes("look at the notes")), "once the thinking is said, the excerpt carries it to the end");
  assert.equal(lineWait({ label: "Thinking", detail: "I" }, { label: "Thinking", detail: "I should" }, false, 0, 100), 1400, "an excerpt already up moves on its own 1.5 s beat");
  assert.equal(lineWait({ label: "Thinking", detail: "" }, { label: "Thinking", detail: "I" }, false, 0, 100), 0, "the first words, now");
  assert.equal(lineWait({ label: "Thinking", detail: "I" }, { label: "Reading model.ts", detail: "" }, false, 0, 1000), 3000, "a new label waits out the label's dwell");
  assert.equal(lineWait({ label: "Thinking", detail: "I" }, { label: "Reading model.ts", detail: "" }, true, 0, 1000), 0, "a finished turn shows its end now");
});
