import assert from "node:assert/strict";
import { test } from "node:test";
import { frameOf, sgrOnly } from "./xterm-frame.ts";

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
