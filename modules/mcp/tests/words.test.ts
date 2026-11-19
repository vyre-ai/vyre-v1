// Plain words for what an app did: from the capability name only, so no title or value can leak (lane r42-mcp).
import test from "node:test";
import assert from "node:assert/strict";
import { doneWords, groupKey } from "../words.ts";

test("an add, a read, a change, a removal and a send each read as one plain line", () => {
  assert.equal(doneWords("tasks.create", "ok"), "Added a task");
  assert.equal(doneWords("records.query", "ok"), "Read records");
  assert.equal(doneWords("files.read", "ok", 3), "Read 3 files");
  assert.equal(doneWords("records.update", "ok"), "Changed a record");
  assert.equal(doneWords("notes.delete", "ok"), "Removed a note");
  assert.equal(doneWords("mail.send_as", "ok"), "Sent an email");
});

test("a call that waits for a person says so, and a refused one says it could not", () => {
  assert.equal(doneWords("mail.send_as", "held"), "Wants to send an email");
  assert.equal(doneWords("tasks.create", "error"), "Could not add a task");
});

test("an unknown capability or none at all never throws and never shows an id", () => {
  assert.equal(doneWords(undefined, "ok"), "Looked around");
  assert.equal(doneWords("zzz.frobnicate", "ok"), "Looked around");
  assert.equal(doneWords("zzz.create", "ok"), "Added something");
  assert.equal(doneWords("tasks.create", "ok", 0), "Added a task");
  assert.equal(doneWords("tasks.create", "ok", 2.9), "Added 2 tasks");
});

test("calls of the same kind on the same thing group; a different kind does not", () => {
  assert.equal(groupKey("files.read"), groupKey("files.list"));
  assert.notEqual(groupKey("files.read"), groupKey("files.delete"));
  assert.notEqual(groupKey("files.read"), groupKey("tasks.get"));
  assert.equal(groupKey(undefined), "other");
});
