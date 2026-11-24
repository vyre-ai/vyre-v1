import { readFileSync } from "node:fs";
import { MCP_HELD, MCP_TOOLS } from "../../../packages/contracts/src/mcp-coverage.ts";
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

test("a permanent erase is recorded as an erase, an export as an export, a pause as a change", () => {
  assert.equal(doneWords("runs.erase", "ok"), "Removed a run");
  assert.equal(doneWords("threads.erase", "held"), "Wants to remove a chat");
  assert.equal(doneWords("records.purge_trashed", "ok"), "Removed records");
  assert.equal(doneWords("backup.export_start", "ok"), "Exported everything in this Space");
  assert.equal(doneWords("hooks.pause", "ok"), "Changed a hook");
});

test("every tool added for the full set, and every held one, reads as a kind of act: none is 'Looked around'", () => {
  const reg = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
    capabilities: Array<{ name: string; effects: string }>;
  };
  const lost = reg.capabilities
    .filter((c) => (c.name in MCP_TOOLS || c.name in MCP_HELD) && doneWords(c.name, "ok") === "Looked around")
    .map((c) => c.name);
  assert.deepEqual(lost, [], "these have no plain words in modules/mcp/words.ts");
});

test("a restore is a restore, not a change", () => {
  assert.equal(doneWords("backup.restore", "ok"), "Restored everything in this Space");
});
