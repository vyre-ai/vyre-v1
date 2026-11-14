// The full-screen terminal's screen: tmux's colours drawn, the cursor placed, a key press turned into the key tmux knows, and keys pressed together sent as one call in order.
import test from "node:test";
import assert from "node:assert/strict";
import { keyBatcher, keyToPress, parseLine, withCursor } from "./TmuxScreen.tsx";

test("keys: text, named keys, Ctrl and Alt chords, F keys; browser shortcuts and lone modifiers are not the terminal's", () => {
  assert.deepEqual(keyToPress({ key: "a" }), { text: "a" });
  assert.deepEqual(keyToPress({ key: "A", shiftKey: true }), { text: "A" });
  assert.deepEqual(keyToPress({ key: "é" }), { text: "é" });
  assert.deepEqual(keyToPress({ key: " " }), { text: " " });
  for (const [k, want] of [
    ["Enter", "Enter"],
    ["Tab", "Tab"],
    ["Backspace", "BSpace"],
    ["Escape", "Escape"],
    ["ArrowUp", "Up"],
    ["ArrowLeft", "Left"],
    ["Delete", "DC"],
    ["PageDown", "PageDown"],
    ["F5", "F5"],
  ] as const)
    assert.deepEqual(keyToPress({ key: k }), { key: want }, k);
  assert.deepEqual(keyToPress({ key: "Tab", shiftKey: true }), { key: "BTab" });
  assert.deepEqual(keyToPress({ key: "c", ctrlKey: true }), { key: "C-c" });
  assert.deepEqual(keyToPress({ key: "D", ctrlKey: true, shiftKey: true }), { key: "C-d" });
  assert.deepEqual(keyToPress({ key: "b", altKey: true }), { key: "M-b" });
  assert.equal(keyToPress({ key: "c", metaKey: true }), null, "Cmd+C is the browser's copy");
  for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified"])
    assert.equal(keyToPress({ key: k }), null, k);
});

test("keys go one request at a time, in order; what is pressed while one is in flight goes together when it lands, letters joined", async () => {
  const calls: unknown[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const b = keyBatcher(async (ks) => {
    calls.push(ks);
    if (calls.length === 1) await gate;
  });
  b.push({ text: "g" });
  b.push({ text: "h" });
  b.push({ key: "Enter" });
  b.push({ paste: "4F2A-91CD" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [[{ text: "gh" }, { key: "Enter" }, { paste: "4F2A-91CD" }]], "same tick: one call");
  b.push({ key: "Up" });
  b.push({ text: "l" });
  b.push({ text: "s" });
  b.push({ key: "Enter" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1, "nothing new is sent while the first is in flight");
  release();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(calls[1], [{ key: "Up" }, { text: "ls" }, { key: "Enter" }], "the rest went together, in order");
  assert.equal(calls.length, 2);
});

test("colours: basic, bright, 256 and true colour, bold, inverse; reset ends them; other escapes are dropped", () => {
  const e = "\x1b";
  const l = parseLine(
    `${e}[31mred${e}[0m plain ${e}[1;38;5;196mbright${e}[0m ${e}[38;2;1;2;3mtrue${e}[0m${e}[?25l${e}[7mrev${e}[27m`,
  );
  assert.deepEqual(
    l.map((s) => [s.text, s.color, s.bold, s.inverse]),
    [
      ["red", "#e06c75", undefined, undefined],
      [" plain ", undefined, undefined, undefined],
      ["bright", "rgb(255,0,0)", true, undefined],
      [" ", undefined, undefined, undefined],
      ["true", "rgb(1,2,3)", undefined, undefined],
      ["rev", undefined, undefined, true],
    ],
  );
  assert.equal(
    parseLine("plain text")
      .map((s) => s.text)
      .join(""),
    "plain text",
  );
});

test("the cursor marks the character under it, splitting a run, and stands on a space past the end of the line", () => {
  const sp = parseLine("$ ls");
  assert.deepEqual(
    withCursor(sp, 2).map((s) => [s.text, s.cursor === true]),
    [
      ["$ ", false],
      ["l", true],
      ["s", false],
    ],
  );
  assert.deepEqual(
    withCursor(sp, 6).map((s) => [s.text, s.cursor === true]),
    [
      ["$ ls", false],
      ["  ", false],
      [" ", true],
    ],
  );
  assert.deepEqual(
    withCursor([], 0).map((s) => [s.text, s.cursor === true]),
    [[" ", true]],
  );
});
