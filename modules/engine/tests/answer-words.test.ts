// What an answered question says to the agent (rc.8): the option's label, the words given, or what a card handed back.
import test from "node:test";
import assert from "node:assert/strict";
import { answerWords } from "../runtime.ts";

const options = [{ key: "run", label: "Run in my terminal" }, { key: "decline", label: "Decline" }];

test("an option is its label, words are words, a card's output comes back as written, a list is joined", () => {
  assert.equal(answerWords({ options, answer: "decline" }), "Decline");
  assert.equal(answerWords({ options, answer: "something else" }), "something else");
  assert.equal(answerWords({ options, answer: { other: "Ran in my terminal.\n$ ls\nfile" } }), "Ran in my terminal.\n$ ls\nfile");
  assert.equal(answerWords({ options, answer: ["run", "decline"] }), "Run in my terminal, Decline");
  assert.equal(answerWords({ answer: "x".repeat(9000) }).length, 8000, "a long output is cut");
});
