// Settings, AI: the one line about the Space AI key. A member with no working account of their own reads that the Space's key covers them, with the press to add their own; someone with their own reads
// that theirs answers first. And the chat's model panel says why a model is greyed: out of usage, with when it comes back.
import test from "node:test";
import assert from "node:assert/strict";
import { spaceKeyLine } from "./pages-a.tsx";
import { modelReason, outOfUsage } from "../chats/conversation/brain.tsx";

const SPACE = { title: "OpenCode Go", mine: false, status: "ok" as const, spaceKey: true };

test("no account of their own: Using the Space's OpenCode Go key, with Add my own", () => {
  assert.deepEqual(spaceKeyLine([SPACE]), { label: "Using the Space's OpenCode Go key", sub: "Nothing to set up. Add your own to use it first", own: false });
  assert.equal(spaceKeyLine([SPACE, { title: "Anthropic", mine: true, status: "failed" }])?.own, false, "a broken own key does not cover them");
});

test("their own account answers first, and the line says so; no Space key, no line", () => {
  assert.deepEqual(spaceKeyLine([{ title: "Claude Code", mine: true, status: "ok" }, SPACE]), { label: "The Space's OpenCode Go key", sub: "Your own account answers first", own: true });
  assert.equal(spaceKeyLine([{ title: "Claude Code", mine: true, status: "ok" }]), null);
});

test("a model out of usage reads Out of usage until the time it comes back, or for now when nobody said", () => {
  const now = new Date(2026, 10, 2, 14, 0).getTime();
  const later = new Date(2026, 10, 2, 15, 40).getTime();
  assert.equal(outOfUsage(later, now), `Out of usage until ${new Date(later).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  assert.match(outOfUsage(new Date(2026, 10, 4, 9, 0).getTime(), now), /^Out of usage until \S+ /, "another day names the day");
  assert.equal(outOfUsage(undefined, now), "Out of usage for now");
  assert.equal(modelReason({ reason: "usage_limit" }, now), "Out of usage for now");
  assert.equal(modelReason({ reason: "not_connected" }, now), "Not connected");
  assert.equal(modelReason({ reason: "policy_model" }, now), "Not allowed here");
  assert.equal(modelReason({}, now), undefined);
});
