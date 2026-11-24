// The doctor finding for records that have no record.created event in the Space log (the record store and the Space log are two files, so a stop between the two writes leaves one).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { recordEventsFinding } from "../src/daemon/doctor.ts";

const enc = new TextEncoder();
function world(records: Record<string, string[]>, announced: (string | null)[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-"));
  const space = new DatabaseSync(path.join(dir, "space.db"));
  for (const [type, ids] of Object.entries(records)) {
    space.exec(`CREATE TABLE rt_${type} (id TEXT PRIMARY KEY, version INTEGER, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, data TEXT)`);
    space.exec(`CREATE TABLE rt_${type}__fm (id TEXT, field TEXT)`);
    for (const id of ids) {
      space.prepare(`INSERT INTO rt_${type} VALUES (?, 1, 1, 1, NULL, '{}')`).run(id);
      space.prepare(`INSERT INTO rt_${type}__fm VALUES (?, 'name')`).run(id);
    }
  }
  space.close();
  const log = new DatabaseSync(path.join(dir, "events.db"));
  log.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, event TEXT NOT NULL, payload BLOB NOT NULL)");
  announced.forEach((id, i) =>
    log
      .prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, ?)")
      .run(i + 1, JSON.stringify({ type: "record.created", seq: i + 1 }), id === null ? new Uint8Array() : enc.encode(JSON.stringify({ recordId: id, type: "party" }))),
  );
  log.exec("INSERT INTO events (seq, event, payload) VALUES (1000, '{\"type\":\"record.updated\"}', x'7b7d')");
  log.close();
  return { dir, space: path.join(dir, "space.db"), log: path.join(dir, "events.db") };
}

test("every record announced: healthy; the field-clock tables are not counted", () => {
  const w = world({ party: ["rec_a", "rec_b"], deal: ["rec_c"] }, ["rec_a", "rec_b", "rec_c"]);
  try {
    const f = recordEventsFinding(w.space, w.log);
    assert.equal(f.state, "healthy");
    assert.match(f.detail, /All 3 records/);
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("records with no created event are counted and named, an erased event names nothing, an update is not an announcement", () => {
  const w = world({ party: ["rec_a", "rec_b", "rec_c", "rec_d"] }, ["rec_a", null]);
  try {
    const f = recordEventsFinding(w.space, w.log);
    assert.equal(f.state, "degraded");
    assert.match(f.detail, /^3 of 4 records have no record\.created event \(for example rec_b, rec_c, rec_d\)/);
    assert.match(f.next, /support/);
  } finally {
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
});

test("no Space yet or no records: healthy and no error", () => {
  assert.equal(recordEventsFinding("/nonexistent/space.db", "/nonexistent/events.db").state, "healthy");
});
