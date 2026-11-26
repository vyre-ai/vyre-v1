// The doctor finding for records whose search entry could not be put right after a field was dropped: counts only, read-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { droppedFieldSearchFinding } from "../src/daemon/doctor.ts";

const file = (rows: number | null): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-dropped-"));
  const f = path.join(dir, "modules.db");
  const db = new DatabaseSync(f);
  if (rows !== null) {
    db.exec(
      "CREATE TABLE sc_reindex_failed (type TEXT NOT NULL, id TEXT NOT NULL, change_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (type, id))",
    );
    for (let i = 0; i < rows; i++)
      db.prepare("INSERT INTO sc_reindex_failed VALUES ('t', ?, 'sch_1', 1)").run(`rec_${i}`);
  }
  db.close();
  return f;
};

test("the finding counts the records search could not be put right for, and is healthy when there are none", () => {
  const bad = droppedFieldSearchFinding(file(3));
  assert.equal(bad.state, "degraded");
  assert.match(bad.detail, /3 records could not be updated in search/);
  assert.equal(droppedFieldSearchFinding(file(0)).state, "healthy", "an empty table");
  assert.equal(droppedFieldSearchFinding(file(null)).state, "healthy", "no table at all");
  assert.equal(droppedFieldSearchFinding(path.join(os.tmpdir(), "vyre-no-such-modules.db")).state, "healthy");
});
