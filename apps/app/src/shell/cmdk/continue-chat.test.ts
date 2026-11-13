// Continue in a chat from the command bar acknowledges the press at once: the chat opens on his own words (the question and the answer) and is made behind them. Nothing waits for chat.start.
import test from "node:test";
import assert from "node:assert/strict";
import { createGateSearch } from "./gate.ts";

function world() {
  const opened: { screen?: string; args?: Record<string, unknown>; subject?: unknown }[] = [];
  const calls: string[] = [];
  const rt = {
    space: { name: "Northwind", kind: "team" }, connection: { get: () => "online" }, assistant: { id: "agt_a", name: "Assistant" },
    open: (t: { screen?: string; args?: Record<string, unknown> }) => void opened.push(t),
    call: (cap: string) => { calls.push(cap); return new Promise(() => undefined); },
  };
  const nav = { go: () => undefined, newTab: () => undefined, flash: () => undefined };
  const data = createGateSearch({ runtime: rt as never, nav: nav as never, state: { away: false, offline: false }, recent: () => [] });
  return { data, opened, calls };
}

test("the press opens the chat on his words in the same call, before any server answer", () => {
  const w = world();
  w.data.continueInChat!({ question: "What is open for Lisbon?", answer: "Two tasks." });
  assert.equal(w.opened.length, 1);
  assert.equal(w.opened[0]!.screen, "chats.ask");
  assert.equal(w.opened[0]!.args!["with"], "assistant");
  assert.equal(w.opened[0]!.args!["first"], "What is open for Lisbon?\n\nWhat the Space says:\nTwo tasks.");
  assert.equal(w.opened[0]!.args!["heading"], "What is open for Lisbon?");
  assert.deepEqual(w.calls, [], "the chat is made by the opening view, not before it");
});

test("an answer too long for a link still waits for its chat, as before", () => {
  const w = world();
  w.data.continueInChat!({ question: "Long?", answer: "x".repeat(4000) });
  assert.equal(w.opened.length, 0);
  assert.deepEqual(w.calls, ["chat.start"]);
});
