// The doctor finding for search entries that carry text of removed fields (the count the one-time scrub keeps in search_meta): before the job it says not counted, while it runs the count so far, after it N found and 0 left; read-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { searchRemovedTextFinding } from "../src/daemon/doctor.ts";

function modulesDb(row: object | null, table = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-search-"));
  const file = path.join(dir, "modules.db");
  const db = new DatabaseSync(file);
  if (table) db.exec("CREATE TABLE search_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  if (table && row) db.prepare("INSERT INTO search_meta VALUES ('scrub:removed_fields', ?)").run(JSON.stringify(row));
  db.close();
  return file;
}

test("no index yet is healthy; an index whose job has not run is not counted yet", () => {
  assert.equal(searchRemovedTextFinding(path.join(os.tmpdir(), "vyre-no-such-modules.db")).state, "healthy");
  assert.equal(searchRemovedTextFinding(modulesDb(null, false)).state, "healthy");
  const f = searchRemovedTextFinding(modulesDb(null));
  assert.equal(f.state, "degraded");
  assert.match(f.detail, /search entries carrying removed-field text: not counted yet/);
});

test("while the job runs it says how many it found and how far it has read; when it is done it says N found and 0 left", () => {
  const running = searchRemovedTextFinding(
    modulesDb({ state: "running", before: 120, after: 0, scanned: 400, total: 9500 }),
  );
  assert.equal(running.state, "degraded");
  assert.match(running.detail, /search entries carrying removed-field text: 120 found so far.*400 of 9500/);
  const done = searchRemovedTextFinding(
    modulesDb({ state: "done", before: 9500, after: 0, scanned: 9500, total: 9500 }),
  );
  assert.equal(done.state, "healthy");
  assert.match(done.detail, /search entries carrying removed-field text: 0 \(the one-time check found 9500/);
  const left = searchRemovedTextFinding(
    modulesDb({ state: "done", before: 9500, after: 3, scanned: 9500, total: 9500 }),
  );
  assert.equal(left.state, "degraded");
  assert.match(left.detail, /removed-field text: 3 /);
});

test("the missing-records finding counts the entries the job put in", async () => {
  const { searchMissingRecordsFinding } = await import("../src/daemon/doctor.ts");
  const done = searchMissingRecordsFinding(modulesDb({ state: "done", before: 0, after: 0, added: 287 }));
  assert.equal(done.state, "healthy");
  assert.match(done.detail, /records without a search entry: 0 \(the one-time check put in 287/);
  const running = searchMissingRecordsFinding(modulesDb({ state: "running", added: 12 }));
  assert.equal(running.state, "degraded");
  assert.match(running.detail, /12 put in so far/);
});

test("the journal finding counts the times the search journal could not be folded in", async () => {
  const { journalNotFoldedFinding } = await import("../src/daemon/doctor.ts");
  const file = modulesDb(null);
  const none = journalNotFoldedFinding(file);
  assert.equal(none.state, "healthy");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE host_journal_owed (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, file TEXT, tries INTEGER)",
  );
  db.exec("INSERT INTO host_journal_owed (at, file, tries) VALUES (1, 'modules.db-wal', 8), (2, 'modules.db-wal', 8)");
  db.close();
  const f = journalNotFoldedFinding(file);
  assert.equal(f.state, "degraded");
  assert.match(f.detail, /2 times the search index's journal could not be folded/);
});
