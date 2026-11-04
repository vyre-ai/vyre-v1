// Codex has two ways in, and each says so in plain words: the ChatGPT sign-in and an OpenAI API key.
import test from "node:test";
import assert from "node:assert/strict";
import { kindNote, kindTitle } from "./model.ts";

test("Codex shows 'Codex, with an API key' next to the ChatGPT sign-in; other providers keep their usual words", () => {
  assert.equal(kindTitle("codex", "api_key"), "Codex, with an API key");
  assert.equal(kindTitle("codex", "subscription"), "Codex, with your ChatGPT sign-in");
  assert.match(kindNote("codex", "api_key"), /OpenAI API key/);
  assert.notEqual(kindTitle("openai", "api_key"), "Codex, with an API key");
  assert.ok(!/[—–]/.test(kindNote("codex", "api_key") + kindNote("codex", "subscription")));
});
