import assert from "node:assert/strict";
import { test } from "node:test";
import { boxTakesWheel, frameOf, rowsThatFit, rowsToDraw, sgrOnly } from "./xterm-frame.ts";

test("sgrOnly keeps colours and drops every other escape and control character", () => {
  assert.equal(sgrOnly("\x1b[31mred\x1b[0m"), "\x1b[31mred\x1b[0m");
  assert.equal(sgrOnly("a\x1b[2Jb\x1b[?1049hc\x1b[10;10Hd"), "abcd");
  assert.equal(sgrOnly("x\x1b]0;title\x07y\x1b]8;;http://e\x1b\\z"), "xyz");
  assert.equal(sgrOnly("a\rb\x07c\x00d"), "abcd");
  assert.equal(sgrOnly("\x1b[38:5:196mhot"), "\x1b[38;5;196mhot");
  assert.equal(sgrOnly("tab\there"), "tab\there");
  assert.equal(sgrOnly("lone\x1bX"), "lone");
});

test("frameOf clears the grid, draws every line, and places the cursor where tmux says", () => {
  const f = frameOf({ text: "hist\nl1\nl2", cols: 20, rows: 2, cursor: { x: 3, y: 1 } });
  assert.ok(f.startsWith("\x1b[0m\x1b[H\x1b[2J"));
  assert.ok(f.includes("hist\x1b[0m\r\nl1\x1b[0m\r\nl2\x1b[0m"));
  // the last 2 lines are the visible rows: cursor row 1 of them is line 3 of the text
  assert.ok(f.endsWith("\x1b[3;4H\x1b[?25h"));
});

test("frameOf hides the cursor when tmux gives none, and a hostile line cannot move it", () => {
  const f = frameOf({ text: "a\x1b[H\x1b[2Jb", cols: 20, rows: 1, cursor: null });
  assert.ok(f.endsWith("\x1b[?25l"));
  assert.equal(f.split("\x1b[2J").length, 2);
});

test("sgrOnly strips the C1 controls too: xterm takes U+009B as CSI and U+009D as OSC", () => {
  assert.equal(sgrOnly("a\u009b2Jb\u009d0;titlec\u0090d\u0085e"), "a2Jb0;titlecde");
  assert.equal(sgrOnly("\u009b31mred"), "31mred");
  assert.equal(sgrOnly("é ñ ü"), "é ñ ü", "ordinary accented letters stay");
});

test("the rows that fit: a pane's height over a row's; with no known row height the capture's own line count stands", () => {
  assert.equal(rowsThatFit(600, 20), 30);
  assert.equal(rowsThatFit(619, 20), 30);
  assert.equal(rowsThatFit(600, 0), 0, "no row drawn yet, or no DOM rows: nothing is guessed");
  assert.equal(rowsThatFit(600, Number.NaN), 0);
  assert.equal(rowsThatFit(-5, 20), 0);
  assert.equal(rowsToDraw(12, rowsThatFit(600, 0)), 12, "a zero fit falls back to the capture");
  assert.equal(rowsToDraw(12, 30), 30, "a roomy pane is filled");
  assert.equal(rowsToDraw(50, 30), 50, "a long capture is all drawn");
  assert.equal(rowsToDraw(0, 0), 1);
});

test("the screen's box takes the wheel only with no mouse mode and the normal buffer; a program with the mouse or the alternate screen keeps it", () => {
  const v = (mouse: string, buf: string) => ({
    modes: { mouseTrackingMode: mouse },
    buffer: { active: { type: buf } },
  });
  assert.equal(boxTakesWheel(v("none", "normal")), true);
  assert.equal(boxTakesWheel(v("vt200", "normal")), false, "mouse tracking on");
  assert.equal(boxTakesWheel(v("drag", "normal")), false);
  assert.equal(boxTakesWheel(v("none", "alternate")), false, "vim, less, htop");
});
