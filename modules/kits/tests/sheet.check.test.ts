// P-L10_12: a Kit step that leaves out an input its capability cannot do without is found before install, not halfway through it. A task lives in a record (tasks.create answers
// "/recordId: the container to create in is missing"), so a Kit step that creates a task with no record is a problem: install refuses before any step runs and names the item, the capability
// and the missing input.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/kits/migrations/0001_kits.sql

import test from "node:test";
import assert from "node:assert/strict";
import { checkKit, sheetOf } from "../handlers/index.ts";
import { NEEDS_INPUT, stepProblems, typeDifference } from "../handlers/sheet.ts";
import { registry } from "../../../generated/registry.ts";
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

test("install refuses a Kit with such a step before any step runs, names the problem, changes nothing; the sheet lists the same problem", async () => {
  const h = harness({ sheetCheck: true });
  h.callee("tasks.create", () => ({ task: {} }));
  const kitId = await h.shipped(kitWith(task({})));
  const listed = (await h.call("kits.install_sheet", { kitId })).sheet.problems as { item: string; cap: string; input: Obj }[];
  assert.deepEqual(listed.filter((p) => p.item === "task.follow_up" && p.cap === "tasks.create").map((p) => p.input), [{ pointer: "/recordId" }], "the sheet shows it before Install");
  let thrown: unknown;
  await h.call("kits.install", { kitId, accepted: true }).catch((e: unknown) => { thrown = e; });
  assert.equal(codeOf(thrown), "validation.precondition_failed");
  const err = (thrown as { error: { message: string; details?: { problems?: { item: string; cap: string }[] } } }).error;
  assert.match(err.message, /Nothing was changed/);
  assert.ok(err.details?.problems?.some((p) => p.item === "task.follow_up" && p.cap === "tasks.create"));
  assert.equal(h.callsTo("schema.apply").length, 0, "the record type step before it did not run");
  assert.equal(h.callsTo("tasks.create").length, 0);
  assert.equal(h.rows("kits_applied").length, 0, "nothing in the ledger");
  assert.equal(h.rows("kits_kit")[0]!.installed_version, null, "still not installed");
  assert.equal(h.events.length, 0, "no kit.installed event");
  void admin;
});

// ---- record types the Kit declares in its manifest (ruling 56) ----

const NOTE = registry.recordTypes.find((r) => r.module === "default" && r.key === "note_board") as unknown as Obj;
const noteKit = (): Obj => ({
  key: "default", title: "Default Kit", version: "1.0.0", channel: "stable", description: "x",
  items: [{ key: "rt.note_board", content: "structure", type: "record_type", title: "Note board", recordType: "note_board" }],
  tests: [{ name: "t", kind: "space", expect: { events: [{ name: "schema.changed" }] } }],
});

test("typeDifference: the same definition is no difference; a changed title, field kind or missing field is named", () => {
  assert.equal(typeDifference(NOTE, { ...NOTE }), null);
  assert.match(typeDifference(NOTE, { ...NOTE, title: "Notes" })!, /its title is "Notes"/);
  const fields = NOTE["fields"] as Obj[];
  assert.match(typeDifference(NOTE, { ...NOTE, fields: fields.slice(1) })!, /its fields are/);
  assert.match(typeDifference(NOTE, { ...NOTE, fields: fields.map((f, i) => (i === 0 ? { ...f, type: "number" } : f)) })!, /its fields are/);
});

test("a declared record type the Space has with the same definition, or not yet persisted, is no problem and install skips creating it", async () => {
  for (const have of ["absent", "identical"] as const) {
    const h = harness({ sheetCheck: true });
    h.callee("schema.types.get", () => { if (have === "absent") throw { error: { code: "validation.not_found" } }; return { type: NOTE }; });
    h.callee("schema.types.list", () => ({ types: [{ key: "note_board" }] }));
    const kitId = await h.shipped(noteKit());
    assert.deepEqual((await h.call("kits.install_sheet", { kitId })).sheet.problems, [], have);
    const done = await h.call("kits.install", { kitId, accepted: true });
    assert.equal(done.kit.installed, true, have);
    assert.equal(h.callsTo("schema.apply").length, 0, `${have}: the installer did not create the type`);
  }
});

test("a declared record type the Space has with a different definition is a problem on the sheet and install refuses, changing nothing", async () => {
  const h = harness({ sheetCheck: true });
  h.callee("schema.types.get", () => ({ type: { ...NOTE, title: "Notes" } }));
  h.callee("schema.types.list", () => ({ types: [{ key: "note_board" }] }));
  const kitId = await h.shipped(noteKit());
  const { problems } = (await h.call("kits.install_sheet", { kitId })).sheet as { problems: { item: string; message: string; input: Obj }[] };
  assert.deepEqual(problems.map((p) => [p.item, p.input]), [["rt.note_board", { type: "note_board" }]]);
  assert.match(problems[0]!.message, /already has a record type note_board, and its title is "Notes"/);
  let thrown: unknown;
  await h.call("kits.install", { kitId, accepted: true }).catch((e: unknown) => { thrown = e; });
  assert.equal(codeOf(thrown), "validation.precondition_failed");
  assert.equal(h.rows("kits_applied").length, 0);
  assert.equal(h.rows("kits_kit")[0]!.installed_version, null);
  assert.equal(h.callsTo("schema.apply").length, 0);
});

test("opening the sheet changes nothing: it only reads", async () => {
  const h = harness({ sheetCheck: true });
  h.callee("schema.types.get", () => ({ type: NOTE }));
  const kitId = await h.shipped(noteKit());
  const before = h.calls.length;
  await h.call("kits.install_sheet", { kitId });
  const writes = h.calls.slice(before).filter((c) => !["schema.types.get"].includes(c.cap));
  assert.deepEqual(writes, []);
  assert.equal(h.events.length, 0);
});
