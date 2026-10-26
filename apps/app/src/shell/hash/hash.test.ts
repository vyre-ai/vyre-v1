import test from "node:test";
import assert from "node:assert/strict";
import { formatHash, openedId, parseHash, placeForSubject } from "./hash.ts";

test("hash: a target round-trips through the text form", () => {
  const h = formatHash({ screen: "files.viewer", subject: { type: "file", id: "fil:1" }, args: { page: 2, open: true, skip: undefined } });
  const t = parseHash(h);
  assert.equal(t.screen, "files.viewer");
  assert.deepEqual(t.subject, { type: "file", id: "fil:1" });
  assert.deepEqual(t.args, { page: "2", open: "true" });
  assert.deepEqual(parseHash(""), { args: {} });
  assert.deepEqual(parseHash("#screen=a").screen, "a");
});

test("hash: a malformed subject is ignored, never half read", () => {
  assert.equal(parseHash("subject=record").subject, undefined);
  assert.equal(parseHash("subject=record:").subject, undefined);
});

test("hash: the id a place opens is the subject of its type, else the first argument it knows", () => {
  const t = parseHash("subject=record%3Arec_1&threadId=thr_9");
  assert.equal(openedId(t, ["record"], ["recordId"]), "rec_1");
  assert.equal(openedId(t, ["file"], ["threadId"]), "thr_9");
  assert.equal(openedId(t, ["file"], ["fileId"]), null);
});

test("hash: every subject type that a place shows maps to its place, an unknown one to none", () => {
  assert.equal(placeForSubject("record"), "records");
  assert.equal(placeForSubject("file"), "files");
  assert.equal(placeForSubject("thread"), "chats");
  assert.equal(placeForSubject("task"), "home");
  assert.equal(placeForSubject("spaceship"), null);
});
