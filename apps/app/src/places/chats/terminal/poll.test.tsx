// The tab's poll source on ui/Terminal's own screen (12 Nov round, audit item 14): terminal.read sends the line the cursor is on again until it is finished, and every answer redraws the line the
// screen ends on, so a prompt, a line being typed and output that follows show once each, as they are now.
import test from "node:test";
import assert from "node:assert/strict";
import { TerminalBuffer } from "../../../../../../ui/src/Terminal/index.tsx";
import { REDRAW_LINE, pollSource } from "./model.ts";

test("answers that repeat the unfinished line draw it as it is now, never twice; an answer that is the same as the last is not a frame", async () => {
  // the session's lines, counted from its first; the cursor is on the last
  const lines = ["welcome", "$ "];
  const read = async (since: number) => ({ text: lines.slice(since).join("\n"), next: lines.length - 1 });
  const screen = new TerminalBuffer();
  screen.write("welcome\r\n$ ");
  const frames: string[] = [];
  const src = pollSource(read, 1, 1);
  const stop = src.subscribe((f) => { frames.push(f.data); screen.write(f.data); });
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 15));
  await settle();
  lines[1] = "$ ls -";
  await settle();
  lines[1] = "$ ls -la";
  await settle();
  assert.equal(screen.text(), "welcome\n$ ls -la", "the line as it is now, once");
  lines.push("a.txt", "$ ");
  await settle();
  stop();
  assert.equal(screen.text(), "welcome\n$ ls -la\na.txt\n$", "each line once");
  assert.ok(frames.every((f) => f.startsWith(REDRAW_LINE)));
  assert.ok(frames.length <= 5 && frames.every((f, i) => i === 0 || f !== frames[i - 1]), `an unchanged answer makes no frame (${frames.length} frames over many reads)`);
});
