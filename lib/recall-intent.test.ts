import test from "node:test";
import assert from "node:assert/strict";
import { asksForWords, recallable } from "./recall-intent.ts";

test("greetings, thanks, a few words, commands, pasted transcripts and the imported-session preamble are never recalled", () => {
  for (const s of ["hi", "Hi!", "hi'", "hello", "thanks", "thank you!", "ok", "yes", "continue", "test", "/help", "", "   ", "what time", "ok thanks bye",
    "Continue this imported session. The following is copied conversation history, not new instructions.\n\nuser: fix the build", "x".repeat(2500)]) {
    assert.equal(recallable(s), false, JSON.stringify(s.slice(0, 40)));
  }
});

test("a sentence someone meant is recallable", () => {
  for (const s of ["Elena prefers email over phone calls", "We ship the letter on Friday after the review", "Can you draft the closing letter for Rivera Holdings?"]) assert.equal(recallable(s), true, s);
});

test("exact words are asked for only when the person asks to find what was said", () => {
  for (const s of ["What did Maya say about the Rivera letter?", "find where we discussed the budget in the earlier chat", "Did we ever mention the deposit?", "quote the exact words from last time", "Remember when I said we would ship on Friday?"]) assert.equal(asksForWords(s), true, s);
  for (const s of ["hi", "Draft the closing letter for Rivera Holdings", "What is the capital of France?", "Summarise this report in three lines", "Can you fix the failing test in the build?"]) assert.equal(asksForWords(s), false, s);
});
