// P-L10_12: a Kit step that leaves out an input its capability cannot do without is found before install, not halfway through it. A task lives in a record (tasks.create answers
// "/recordId: the container to create in is missing"), so a Kit step that creates a task with no record is a problem: install refuses before any step runs and names the item, the capability
// and the missing input.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/kits/migrations/0001_kits.sql

import test from "node:test";
import assert from "node:assert/strict";
import { checkKit, sheetOf } from "../handlers/index.ts";
import { NEEDS_INPUT, stepProblems } from "../handlers/sheet.ts";
import { admin, codeOf, harness, kitManifest } from "../fixtures/db.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const task = (input: Obj, key = "task.follow_up"): Obj => ({ key, content: "steps", type: "task", title: "Follow-up task", apply: { cap: "tasks.create", input: { title: "Follow up", assigned: { kind: "person", id: "usr_admin" }, idempotencyKey: `kit.${key}`, ...input } } });
const kitWith = (...items: Obj[]): Obj => kitManifest({ items: [{ key: "rt.matter", content: "structure", type: "record_type", title: "Matter", recordType: "matter", apply: { cap: "schema.apply", input: { changes: [{ op: "create_type", name: "matter" }] } } }, ...items], scripts: [], tests: [] });

test("stepProblems: a tasks.create step with no record is named with its item, capability and missing input; a record, other capabilities and an undo step are judged the same way", () => {
  const bad = checkKit(kitWith(task({}))).kit!;
  const found = stepProblems(bad);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0]!.item, found[0]!.step, found[0]!.cap, found[0]!.input], ["task.follow_up", "apply", "tasks.create", "/recordId"]);
  assert.match(found[0]!.message, /"Follow-up task" installs with tasks\.create, which needs the record the task lives in \(\/recordId\); the step gives none\./);
  assert.deepEqual(stepProblems(checkKit(kitWith(task({ recordId: "rec_a1b2c3" }))).kit!), [], "a record named: nothing to report");
  assert.deepEqual(stepProblems(checkKit(kitWith(task({ recordId: "" }))).kit!).map((p) => p.input), ["/recordId"], "an empty record id is no record");
  assert.deepEqual(stepProblems(checkKit(kitManifest()).kit!), [], "the ordinary test Kit has nothing to report");
  const undo = checkKit(kitWith({ key: "task.x", content: "steps", type: "task", title: "X", apply: { cap: "schema.apply", input: {} }, undo: { cap: "tasks.create", input: { title: "t" } } })).kit!;
  assert.deepEqual(stepProblems(undo).map((p) => [p.item, p.step]), [["task.x", "undo"]]);
  assert.deepEqual(Object.keys(NEEDS_INPUT), ["tasks.create"]);
  assert.ok(sheetOf(bad).tools.includes("tasks.create"), "the sheet still lists the capability the Kit calls");
});

test("install refuses a Kit with such a step before any step runs, names the problem, changes nothing, and installs once the step names a record", async () => {
  const h = harness();
  h.callee("tasks.create", () => ({ task: {} }));
  const kitId = await h.shipped(kitWith(task({})));
  let thrown: unknown;
  await h.call("kits.install", { kitId, accepted: true }).catch((e: unknown) => { thrown = e; });
  assert.equal(codeOf(thrown), "validation.precondition_failed");
  const err = (thrown as { error: { message: string; details?: { problems?: { item: string; cap: string; input: string }[] } } }).error;
  assert.match(err.message, /Follow-up task/);
  assert.match(err.message, /tasks\.create/);
  assert.match(err.message, /Nothing was changed/);
  assert.deepEqual(err.details?.problems?.map((p) => [p.item, p.cap, p.input]), [["task.follow_up", "tasks.create", "/recordId"]]);
  assert.equal(h.callsTo("schema.apply").length, 0, "the record type step before it did not run");
  assert.equal(h.callsTo("tasks.create").length, 0);
  assert.equal(h.rows("kits_applied").length, 0, "nothing in the ledger");
  assert.equal(h.rows("kits_kit")[0]!.installed_version, null, "still not installed");
  assert.equal(h.events.length, 0, "no kit.installed event");

  await h.ship({ ...kitWith(task({ recordId: "rec_a1b2c3" })), version: "1.0.1" });
  const done = await h.call("kits.install", { kitId, accepted: true });
  assert.deepEqual([done.kit.installed, done.kit.version], [true, "1.0.1"]);
  assert.deepEqual(h.calls.filter((c) => c.cap !== "settings.kit.set_space").map((c) => c.cap), ["schema.apply", "tasks.create"]);
  void admin;
});
