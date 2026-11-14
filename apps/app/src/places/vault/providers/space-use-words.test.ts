// The Space-use switch says what is true for the account it sits on: a personal sign-in never pays for other people's chats.
import test from "node:test";
import assert from "node:assert/strict";
import { spaceUseWords } from "./model.ts";

test("for a sign-in the note says what it does and does not do, and the way to share; for a key it keeps the old words", () => {
  const sub = spaceUseWords({ connection: "subscription" });
  assert.equal(sub.title, "The Space can use this sign-in");
  assert.match(sub.note, /Your own goals and Automations can run on it/);
  assert.match(sub.note, /does not pay for other people's chats/);
  assert.match(sub.note, /add an API key to share with the Space/);
  const key = spaceUseWords({ connection: "api_key" });
  assert.equal(key.title, "The Space can use this key");
  assert.equal(key.note, "Automations and agents without a key of their own run on it.");
});
