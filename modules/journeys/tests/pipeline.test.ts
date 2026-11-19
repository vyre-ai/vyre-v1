// A Journey as a pipeline on a record type, and the move of a per-subject Journey onto it (rc.41). The state machine: subject -> migrating -> pipeline; a record: planned -> wrote_stage -> moved_links -> done | failed.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newJourney, stage, threeStages } from "../fixtures/seed.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const noTasks = () => [
  stage("lead", 0, { exit: { requireTasks: false } }),
  stage("won", 1, { final: true, exit: { requireTasks: false } }),
];
const pipe = async (h: Harness, over: Record<string, unknown> = {}): Promise<any> =>
  (
    await h.call(
      "journeys.create",
      { name: "Onboarding", mode: "pipeline", recordType: "client", subjectType: "client", stages: noTasks(), ...over },
      alice,
    )
  ).journey;
const old = async (h: Harness, n = 3): Promise<{ j: any; ids: string[] }> => {
  const j = (await h.call("journeys.create", newJourney({ stages: noTasks() }), alice)).journey;
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push((await h.call("journeys.start", { journeyId: j.id, subjectRecordId: `rec_s${i}` }, alice)).recordId);
  return { j, ids };
};
const refused = async (p: Promise<unknown>, code: string, reason?: string): Promise<void> =>
  assert.rejects(p, (e) => {
    assert.equal(codeOf(e), code);
    if (reason) assert.equal(reasonOf(e), reason);
    return true;
  });

test("a pipeline Journey is made on an existing type: no new type, the stage field bound and writable only through the Journey", async () => {
  const h = harness();
  const j = await pipe(h);
  assert.equal(j.mode, "pipeline");
  assert.equal(j.recordType, "client");
  assert.equal(j.stageField, "stage");
  const ops = h.only("schema.apply").flatMap((c) => c.input.ops);
  assert.ok(
    ops.every((o: any) => o.type === "client"),
    "nothing but the client type is touched",
  );
  assert.ok(!ops.some((o: any) => o.op === "type.create"));
  assert.ok(ops[0].def.writeOnlyBy.includes("journeys.move_stage"));
});

test("a record type has one pipeline", async () => {
  const h = harness();
  await pipe(h);
  await refused(pipe(h, { name: "Another" }), "validation.duplicate", "type_has_journey");
});

test("a field that is there already is updated when it cannot be added", async () => {
  const h = harness();
  let n = 0;
  h.callee("schema.apply", (i) => {
    if (i.ops[0].op === "field.add" && ++n) throw new Error("field exists");
    return { changeId: "x", applied: 1, items: [] };
  });
  await pipe(h, { stageField: "status" });
  assert.deepEqual(
    h.only("schema.apply").map((c) => c.input.ops[0].op),
    ["field.add", "field.update"],
  );
});

test("a record enters the pipeline without a Journey record or a channel and moves by writing its own stage field", async () => {
  const h = harness();
  const j = await pipe(h);
  const r = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1" }, alice);
  assert.equal(r.recordId, "rec_c1");
  assert.equal(h.only("records.create").length, 0);
  assert.equal(h.only("channels.create").length, 0);
  assert.deepEqual(h.only("records.update")[0]!.input, {
    type: "client",
    recordId: "rec_c1",
    patch: { stage: "lead" },
  });
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: "rec_c1", toStage: "won", reason: "Signed" }, alice);
  assert.deepEqual(h.only("records.update").at(-1)!.input.patch, { stage: "won" }, "only the stage field is written");
  await refused(
    h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1", idempotencyKey: "other" }, alice),
    "validation.duplicate",
    "already_enrolled",
  );
});

test("moving the old Journey onto its subject type: every record keeps its stage, its place and its old record", async () => {
  const h = harness();
  const { j, ids } = await old(h);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: ids[1], toStage: "won", reason: "done" }, alice);
  const r = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(r.finished, true);
  assert.equal(r.journey.mode, "pipeline");
  assert.equal(r.journey.recordType, "contact");
  assert.equal(r.total, 3);
  assert.equal(r.done, 3);
  const writes = h
    .only("records.update")
    .filter((c) => c.input.type === "contact")
    .map((c) => `${c.input.recordId}:${c.input.patch.stage}`)
    .sort();
  assert.deepEqual(writes, ["rec_s0:lead", "rec_s1:won", "rec_s2:lead"]);
  const row = h.db.all("SELECT record_id, legacy_record_id, stage FROM journeys_records ORDER BY record_id") as any[];
  assert.deepEqual(
    row.map((x) => [x.record_id, x.legacy_record_id === ids[Number(x.record_id.slice(-1))], x.stage]),
    [
      ["rec_s0", true, "lead"],
      ["rec_s1", true, "won"],
      ["rec_s2", true, "lead"],
    ],
  );
  assert.equal(
    r.journey.legacyType,
    "journey_client_intake",
    "the old type is remembered, its records, channels and folders are untouched",
  );
  assert.equal(h.only("channels.create").length, 3);
});

test("a move that stops halfway resumes: nothing is moved twice or lost", async () => {
  const h = harness();
  const { j } = await old(h);
  let n = 0;
  h.callee("records.update", (i) => {
    if (i.type === "contact" && ++n === 2) throw new Error("the records module is down");
    return { record: {} };
  });
  const a = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(a.finished, false);
  assert.equal(a.done, 2);
  assert.deepEqual(
    a.failed.map((f: any) => f.error),
    ["the records module is down"],
  );
  assert.equal((await h.call("journeys.migration_state", { journeyId: j.id }, alice)).mode, "migrating");
  const b = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(b.finished, true);
  assert.equal(b.done, 3);
  assert.equal(
    h.only("records.update").filter((c) => c.input.type === "contact").length,
    4,
    "the two that were done are not written again; only the one that failed is",
  );
  assert.equal(
    (h.db.all("SELECT COUNT(*) AS n FROM journeys_records WHERE legacy_record_id IS NOT NULL") as any[])[0].n,
    3,
  );
});

test("while the move runs nothing moves, starts or advances the Journey", async () => {
  const h = harness();
  const { j, ids } = await old(h);
  h.callee("records.update", (i) => {
    if (i.type === "contact") throw new Error("down");
    return { record: {} };
  });
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  await refused(
    h.call("journeys.move_stage", { journeyId: j.id, recordId: ids[0], toStage: "won", reason: "x" }, alice),
    "validation.precondition_failed",
    "migrating",
  );
  await refused(
    h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_new" }, alice),
    "validation.precondition_failed",
    "migrating",
  );
  assert.deepEqual(await h.call("journeys.advance", { recordId: ids[0] }, alice), { advanced: false, stage: "lead" });
});

test("a stop after the stage was written and before the row changed resumes without writing again", async () => {
  const h = harness();
  const { j, ids } = await old(h, 1);
  // the run stopped after the row changed its id but before its migration row said so
  h.ctxFor("journeys.to_pipeline", alice).db.run(
    "UPDATE journeys_records SET record_id = 'rec_s0', legacy_record_id = ? WHERE record_id = ?",
    ids[0],
    ids[0],
  );
  const r = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(r.finished, true);
  assert.equal(
    h.only("records.update").filter((c) => c.input.type === "contact").length,
    0,
    "it was already folded in",
  );
});

test("tasks and time limits follow the record to its new id", async () => {
  const h = harness();
  const j = (await h.call("journeys.create", newJourney({ stages: threeStages() }), alice)).journey;
  const id = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s0" }, alice)).recordId;
  const before = (h.db.all("SELECT COUNT(*) AS n FROM journeys_tasks WHERE record_id = ?", id) as any[])[0].n;
  assert.ok(before > 0);
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal((h.db.all("SELECT COUNT(*) AS n FROM journeys_tasks WHERE record_id = ?", id) as any[])[0].n, 0);
  assert.equal((h.db.all("SELECT COUNT(*) AS n FROM journeys_tasks WHERE record_id = 'rec_s0'") as any[])[0].n, before);
});

test("a type that already runs another pipeline refuses the move before anything changes", async () => {
  const h = harness();
  await pipe(h, { recordType: "contact", subjectType: "contact" });
  const { j } = await old(h, 1);
  await refused(h.call("journeys.to_pipeline", { journeyId: j.id }, alice), "validation.duplicate", "type_has_journey");
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.mode, "subject");
});

test("finished again is a no-op", async () => {
  const h = harness();
  const { j } = await old(h, 1);
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  h.reset();
  const r = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(r.finished, true);
  assert.equal(h.only("records.update").length, 0);
});

test("records a type already had are adopted where their stage field says, a page at a time, and nothing runs for them", async () => {
  const h = harness();
  const j = await pipe(h);
  const rows = [
    { id: "rec_a", fields: { stage: "lead" } },
    { id: "rec_b", fields: { stage: "won" } },
    { id: "rec_c", fields: { stage: "gone" } },
    { id: "rec_d", fields: {} },
  ];
  h.callee("records.query", (i) => (i.cursor ? { rows: [rows[2], rows[3]] } : { rows: rows.slice(0, 2), next: "2" }));
  const a = await h.call("journeys.adopt", { journeyId: j.id }, alice);
  assert.deepEqual([a.adopted, a.skipped, a.next], [2, 0, "2"]);
  const b = await h.call("journeys.adopt", { journeyId: j.id, cursor: "2" }, alice);
  assert.deepEqual([b.adopted, b.skipped], [0, 2], "a value that is not a stage, and no value, are left alone");
  const again = await h.call("journeys.adopt", { journeyId: j.id }, alice);
  assert.deepEqual([again.adopted, again.skipped], [0, 2], "running a page again adopts nothing twice");
  assert.equal(h.events.length, 0);
  assert.equal(h.only("tasks.create").length + h.only("automations.fire").length, 0);
  const done = h.db.all("SELECT record_id, stage, completed_at FROM journeys_records ORDER BY record_id") as any[];
  assert.deepEqual(
    done.map((r) => [r.record_id, r.stage, r.completed_at !== null]),
    [
      ["rec_a", "lead", false],
      ["rec_b", "won", true],
    ],
  );
});

test("a Journey that is not a pipeline adopts nothing", async () => {
  const h = harness();
  const { j } = await old(h, 1);
  await refused(
    h.call("journeys.adopt", { journeyId: j.id }, alice),
    "validation.precondition_failed",
    "not_a_pipeline",
  );
});
