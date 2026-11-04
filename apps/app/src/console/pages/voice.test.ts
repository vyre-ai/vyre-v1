// The Console's one line and Settings' one line: what they say for each state of the Space key.
import test from "node:test";
import assert from "node:assert/strict";
import { agoLine, voiceHeadline } from "./Voice.tsx";
import { coverLine } from "../../places/settings/VoiceRows.tsx";

test("the Console row says how the Space stands", () => {
  assert.equal(voiceHeadline({ set: false, on: false }), "Not set up");
  assert.equal(voiceHeadline({ set: true, on: true, state: "ok" }), "On for everyone");
  assert.equal(voiceHeadline({ set: true, on: false, state: "ok" }), "Off for everyone");
  assert.equal(voiceHeadline({ set: true, on: true, state: "failing" }), "The key stopped working");
  const now = 1_000_000_000;
  assert.equal(agoLine(undefined, now), "not checked yet");
  assert.equal(agoLine(now - 10_000, now), "just now");
  assert.equal(agoLine(now - 60_000, now), "1 minute ago");
  assert.equal(agoLine(now - 4 * 3_600_000, now), "4 hours ago");
  assert.equal(agoLine(now - 72 * 3_600_000, now), "3 days ago");
});

test("Settings says what covers a person in one line", () => {
  assert.equal(coverLine({ source: "space" }, false).label, "Covered by your Space");
  assert.equal(coverLine({ source: "own" }, false).label, "Your own key");
  assert.equal(coverLine({ source: "none" }, true).label, "No key yet");
  assert.equal(coverLine({ source: "none" }, false).sub, "Ask an admin to add one for everyone, or add your own here", "a team Space member is told who can fix it");
});
