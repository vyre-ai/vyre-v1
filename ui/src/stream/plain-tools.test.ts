// A tool's own name (mcp__server__tool) never reaches a person, not even for a frame while the reply is written, whatever way the deltas cut it.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolFilter, plainTools } from "./plain-tools.ts";
import { createStreamStore } from "./store.ts";

const drawn = (deltas: string[]): string => {
  const f = createToolFilter();
  return [...deltas.map((d) => f.push(d)), f.flush()].join("");
};

test("a name is put into plain words, wherever the deltas cut it", () => {
  const whole = "I used the Vyre terminal tool (mcp__vyre__terminal_run), not Bash.";
  for (let at = 1; at < whole.length; at++)
    assert.equal(
      drawn([whole.slice(0, at), whole.slice(at)]),
      "I used the Vyre terminal tool (terminal run), not Bash.",
      `cut at ${at}`,
    );
  assert.equal(drawn([...whole]), "I used the Vyre terminal tool (terminal run), not Bash.", "one character at a time");
});

test("what is not a name is untouched, and a held tail is given back at the end", () => {
  assert.equal(drawn(["The rom", "ance of a mc", "p"]), "The romance of a mcp");
  assert.equal(drawn(["Use snake_case and mcp__x"]), "Use snake_case and mcp__x");
  assert.equal(plainTools("no names here"), "no names here");
});

test("no frame of the stream shows the raw name", () => {
  const frames: string[] = [];
  const store = createStreamStore({ request: (cb) => (cb(0), 1), cancel: () => undefined });
  store.subscribe(() => frames.push(JSON.stringify(store.getSnapshot().blocks)));
  for (const d of ["the tool (mc", "p__vyre__term", "inal_run) ran"]) store.push(d);
  store.end();
  assert.ok(frames.length > 0);
  assert.ok(
    frames.every((f) => !f.includes("mcp__")),
    frames.join("\n"),
  );
  assert.ok(frames[frames.length - 1]!.includes("terminal run"));
});
