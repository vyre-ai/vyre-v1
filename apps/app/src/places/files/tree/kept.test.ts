// The Files sidebar's kept look: per session, by name, and nothing shared between two sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { recall, remember } from "./kept.ts";

test("what a session's sidebar showed is given back to it by name, and another session sees none of it", () => {
  const a = {},
    b = {};
  assert.equal(recall(a, "folders"), undefined);
  remember(a, "folders", { f1: true });
  remember(a, "sections", { starred: true });
  assert.deepEqual(recall(a, "folders"), { f1: true });
  assert.deepEqual(recall(a, "sections"), { starred: true });
  assert.equal(recall(b, "folders"), undefined, "another Space's session starts clean");
  remember(a, "folders", { f1: false, f2: true });
  assert.deepEqual(recall(a, "folders"), { f1: false, f2: true }, "the newest look replaces the old one");
});

test("with no session there is nothing to keep and nothing breaks", () => {
  remember(null, "folders", { f1: true });
  assert.equal(recall(null, "folders"), undefined);
  assert.equal(recall(undefined, "folders"), undefined);
});
