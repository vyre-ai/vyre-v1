// Autosave: a pause after the last edit saves a new version, one at a time; a refusal is a line, not a loss; Undo has the version before.
import test from "node:test";
import assert from "node:assert/strict";
import { Autosaver } from "./autosave.ts";
import type { SaveResult } from "./autosave.ts";

function rig(initial = "a\n", version = 3, results: SaveResult[] = []) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const sent: string[] = [];
  const queue = [...results];
  const a = new Autosaver({
    delay: 800,
    saved: { text: initial, version },
    save: async (t) => { sent.push(t); return queue.shift() ?? { ok: true, version: version + sent.length }; },
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { live: boolean }).live = false; },
  });
  const fire = async (): Promise<void> => { const t = timers.filter((x) => x.live).pop(); if (t) { t.live = false; t.fn(); } await new Promise((r) => setImmediate(r)); };
  return { a, sent, timers, fire };
}

test("an edit waits for a pause, then saves as a new version and the header says Saved with its number", async () => {
  const { a, sent, timers, fire } = rig();
  a.edit("ab\n");
  assert.equal(a.state.status, "dirty");
  assert.equal(timers.at(-1)?.ms, 800);
  assert.deepEqual(sent, []);
  await fire();
  assert.deepEqual(sent, ["ab\n"]);
  assert.equal(a.state.status, "saved");
  assert.equal(a.state.version, 4);
  assert.equal(a.state.undoTo, 3, "Undo goes back to the version before");
});

test("typing again restarts the pause: only the last text is sent", async () => {
  const { a, sent, timers, fire } = rig();
  a.edit("ab\n"); a.edit("abc\n"); a.edit("abcd\n");
  assert.equal(timers.filter((t) => t.live).length, 1);
  await fire();
  assert.deepEqual(sent, ["abcd\n"]);
});

test("text typed while a save runs is saved next, one save at a time", async () => {
  const { a, sent } = rig();
  a.edit("one\n");
  const first = a.flush();
  a.edit("one two\n");
  assert.equal(a.state.status, "saving");
  await first;
  await a.flush();
  assert.deepEqual(sent, ["one\n", "one two\n"]);
  assert.equal(a.state.status, "saved");
  assert.equal(a.state.version, 5);
});

test("an edit back to the saved text saves nothing", async () => {
  const { a, sent, fire } = rig();
  a.edit("changed\n"); a.edit("a\n");
  await fire();
  assert.deepEqual(sent, []);
  assert.equal(a.state.status, "idle");
});

test("a refusal shows its words, keeps the text, and the next edit tries again", async () => {
  const { a, sent, fire } = rig("a\n", 3, [{ ok: false, error: "Someone saved version 4 first." }, { ok: true, version: 5 }]);
  a.edit("mine\n");
  await fire();
  assert.equal(a.state.status, "error");
  assert.equal(a.state.error, "Someone saved version 4 first.");
  assert.equal(a.state.version, 3);
  a.edit("mine again\n");
  await fire();
  assert.equal(a.state.status, "saved");
  assert.deepEqual(sent, ["mine\n", "mine again\n"]);
});

test("flush saves now (Cmd+S), and undone and reset put the file back without saving", async () => {
  const { a, sent } = rig();
  a.edit("x\n");
  await a.flush();
  assert.deepEqual(sent, ["x\n"]);
  a.undone("a\n", 3);
  assert.equal(a.state.version, 3);
  assert.equal(a.state.undoTo, null);
  a.reset({ text: "from outside\n", version: 9 });
  a.edit("from outside\n");
  await a.flush();
  assert.deepEqual(sent, ["x\n"], "the text that came in is not saved again");
  assert.equal(a.state.version, 9);
});
