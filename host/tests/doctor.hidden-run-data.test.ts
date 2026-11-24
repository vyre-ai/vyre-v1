// The doctor finding for kept Runs that may hold a field their person's access hides (24 Nov 2026): counts and ids, never a value; read-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hiddenRunDataFinding } from "../src/daemon/doctor.ts";

const HIDDEN = "zq7xkv@probe-mail.test";

function world(o: { hides: boolean; stepHolds: boolean; triggerHolds: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-hidden-"));
  const file = path.join(dir, "modules.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE automations_defs (id TEXT PRIMARY KEY, owner_id TEXT, definition TEXT, deleted_at INTEGER);
    CREATE TABLE automations_runs (run_id TEXT PRIMARY KEY, automation_id TEXT, payload TEXT);
    CREATE TABLE runs_steps (run_id TEXT, step TEXT, input_json TEXT, output_json TEXT);
    CREATE TABLE access_grants (id TEXT PRIMARY KEY, subjectId TEXT, conditions TEXT, deleted_at INTEGER);`);
  db.prepare(`INSERT INTO automations_defs VALUES ('aut_1', 'usr_m', ?, NULL)`).run(
    JSON.stringify({ triggers: [{ key: "record_change" }] }),
  );
  db.prepare(`INSERT INTO automations_defs VALUES ('aut_2', 'usr_m', ?, NULL)`).run(JSON.stringify({ triggers: [{ key: "manual" }] }));
  if (o.hides)
    db.prepare(`INSERT INTO access_grants VALUES ('g1', 'usr_m', ?, NULL)`).run(JSON.stringify({ hiddenFields: ["email"] }));
  db.prepare(`INSERT INTO automations_runs VALUES ('run_1', 'aut_1', ?)`).run(
    JSON.stringify({ record: o.triggerHolds ? { name: "Ada", email: HIDDEN } : { name: "Ada" }, recordId: "rec_1" }),
  );
  db.prepare(`INSERT INTO runs_steps VALUES ('run_1', 'note', ?, ?)`).run(
    JSON.stringify({ title: o.stepHolds ? `mail ${HIDDEN}` : "mail" }),
    "{}",
  );
  db.close();
  return file;
}

test("kept Runs holding a hidden field are counted with their ids, and no value is in the finding", () => {
  const f = hiddenRunDataFinding(world({ hides: true, stepHolds: true, triggerHolds: true }));
  assert.equal(f.state, "degraded");
  assert.match(f.detail, /1 kept Runs of 1 Automations/);
  assert.match(f.detail, /1 steps hold such a value/);
  assert.match(f.detail, /shorter than 4 characters are not searched/);
  assert.match(f.detail, /run_1/);
  assert.ok(!f.detail.includes(HIDDEN) && !f.detail.includes("zq7xkv"), "no value is printed");
});

test("a step that does not hold the value is not counted; a run without a hidden field, a person without a hiding grant, and an Automation not on record changes are healthy", () => {
  const stepFree = hiddenRunDataFinding(world({ hides: true, stepHolds: false, triggerHolds: true }));
  assert.equal(stepFree.state, "degraded");
  assert.match(stepFree.detail, /0 steps hold/);
  assert.equal(hiddenRunDataFinding(world({ hides: true, stepHolds: true, triggerHolds: false })).state, "healthy");
  assert.equal(hiddenRunDataFinding(world({ hides: false, stepHolds: true, triggerHolds: true })).state, "healthy");
  assert.equal(hiddenRunDataFinding(path.join(os.tmpdir(), "vyre-no-such-modules.db")).state, "healthy");
});

test("a short hidden value is not searched in the steps, so a hidden `5` does not make every step count", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-doc-hidden-"));
  const file = path.join(dir, "modules.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE automations_defs (id TEXT PRIMARY KEY, owner_id TEXT, definition TEXT, deleted_at INTEGER);
    CREATE TABLE automations_runs (run_id TEXT PRIMARY KEY, automation_id TEXT, payload TEXT);
    CREATE TABLE runs_steps (run_id TEXT, step TEXT, input_json TEXT, output_json TEXT);
    CREATE TABLE access_grants (id TEXT PRIMARY KEY, subjectId TEXT, conditions TEXT, deleted_at INTEGER);`);
  db.prepare(`INSERT INTO automations_defs VALUES ('aut_1', 'usr_m', ?, NULL)`).run(JSON.stringify({ triggers: [{ key: "record_change" }] }));
  db.prepare(`INSERT INTO access_grants VALUES ('g1', 'usr_m', ?, NULL)`).run(JSON.stringify({ hiddenFields: ["age"] }));
  db.prepare(`INSERT INTO automations_runs VALUES ('run_1', 'aut_1', ?)`).run(JSON.stringify({ record: { name: "Ada", age: 5 }, recordId: "rec_1" }));
  for (const step of ["a", "b", "c"]) db.prepare(`INSERT INTO runs_steps VALUES ('run_1', ?, ?, ?)`).run(step, JSON.stringify({ n: 15, m: 5 }), "{}");
  db.close();
  const f = hiddenRunDataFinding(file);
  assert.equal(f.state, "degraded", "the kept trigger does hold the hidden field");
  assert.match(f.detail, /0 steps hold such a value/);
  assert.match(f.detail, /shorter than 4 characters are not searched/);
});
