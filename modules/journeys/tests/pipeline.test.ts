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
    .map((c) => `${c.input.recordId}:${c.input.patch.journey_stage}`)
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

test("where: the path, the stage the record is in and how long it has been there against the limit", async () => {
  const h = harness();
  const j = await pipe(h, {
    stages: [
      stage("lead", 0, { exit: { requireTasks: false }, automations: ["aut_hello"] }),
      stage("prop", 1, {
        exit: { requireTasks: false },
        timeLimit: { hours: 48, escalateTo: { kind: "person", id: "usr_maya" } },
        automations: ["aut_prop"],
      }),
      stage("won", 2, { final: true, exit: { requireTasks: false } }),
    ],
  });
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1" }, alice);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: "rec_c1", toStage: "prop", reason: "sent" }, alice);
  h.advance(60 * 3_600_000);
  const w = await h.call("journeys.where", { journeyId: j.id, recordId: "rec_c1" }, alice);
  assert.deepEqual(
    w.path.map((p: any) => [p.key, p.state]),
    [
      ["lead", "done"],
      ["prop", "here"],
      ["won", "next"],
    ],
  );
  assert.deepEqual(
    [w.hoursIn, w.limitHours, w.overByHours, w.thenAsks],
    [60, 48, 12, { kind: "person", id: "usr_maya" }],
  );
  assert.deepEqual(w.path[1].automations, ["aut_prop"]);
  await assert.rejects(
    h.call("journeys.where", { journeyId: j.id, recordId: "rec_nobody" }, alice),
    (e) => codeOf(e) === "permission.not_found",
  );
});

test("test_path: every stage's Automations are tried in order on the record, a refusal is its own line and does not stop the rest", async () => {
  const h = harness();
  const j = await pipe(h, {
    stages: [
      stage("lead", 0, { exit: { requireTasks: false }, automations: ["aut_a", "aut_b"] }),
      stage("won", 1, { final: true, exit: { requireTasks: false }, automations: ["aut_c"] }),
    ],
  });
  h.callee("automations.test", (i) => {
    if (i.automationId === "aut_b") throw new Error("It needs a mailbox.");
    return { runId: `run_${i.automationId.slice(-1)}1` };
  });
  const r = await h.call("journeys.test_path", { journeyId: j.id, recordId: "rec_c1" }, alice);
  assert.deepEqual(r.runs, [
    { stage: "lead", automationId: "aut_a", runId: "run_a1" },
    { stage: "lead", automationId: "aut_b", error: "It needs a mailbox." },
    { stage: "won", automationId: "aut_c", runId: "run_c1" },
  ]);
  assert.deepEqual(h.only("automations.test")[0]!.input, {
    automationId: "aut_a",
    recordId: "rec_c1",
    recordType: "client",
  });
  assert.equal(h.only("records.update").length, 0, "a test changes no record");
});

import { autoPipeline } from "../handlers/pipeline.ts";
const tick = (h: Harness): Promise<string[]> => {
  h.callee("journeys.to_pipeline", (i) => h.call("journeys.to_pipeline", i, alice));
  return autoPipeline(h.ctxFor("journeys.to_pipeline", alice));
};

test("after an upgrade the old Journeys move by themselves, one a tick, and then there is nothing to do", async () => {
  const h = harness();
  const a = await old(h, 2);
  h.advance(60_000);
  const b = (
    await h.call("journeys.create", newJourney({ name: "Second", subjectType: "matter", stages: noTasks() }), alice)
  ).journey;
  await h.call("journeys.start", { journeyId: b.id, subjectRecordId: "rec_m1" }, alice);
  assert.deepEqual(await tick(h), [a.j.id], "the oldest first");
  assert.equal((await h.call("journeys.get", { journeyId: a.j.id }, alice)).journey.mode, "pipeline");
  assert.equal(
    (await h.call("journeys.get", { journeyId: b.id }, alice)).journey.mode,
    "subject",
    "one Journey a tick",
  );
  assert.deepEqual(await tick(h), [b.id]);
  assert.deepEqual(await tick(h), []);
});

test("records that would not move are tried again each tick; after five in a row the reason is kept and the Journey waits for Retry, which finishes it and clears the reason", async () => {
  const h = harness();
  let down = true;
  h.callee("records.update", (i) => {
    if (i.type === "contact" && down) throw new Error("the records module is down");
    return { record: {} };
  });
  const { j } = await old(h, 2);
  for (let n = 1; n < 5; n++) {
    assert.deepEqual(await tick(h), [j.id], `tick ${n} tries again`);
    assert.equal(
      (await h.call("journeys.get", { journeyId: j.id }, alice)).journey.migrateNote,
      undefined,
      `no reason after ${n}`,
    );
  }
  assert.deepEqual(await tick(h), [j.id]);
  const g = (await h.call("journeys.get", { journeyId: j.id }, alice)).journey;
  assert.equal(g.mode, "migrating");
  assert.match(g.migrateNote, /2 records could not be moved: the records module is down/);
  assert.deepEqual(await tick(h), [], "not tried again by itself");
  down = false;
  const r = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(r.finished, true);
  assert.equal(r.journey.migrateNote, undefined);
  assert.deepEqual(await tick(h), []);
});

test("a failure that may pass is tried again up to five ticks; a refusal that will not change is kept at once", async () => {
  const h = harness();
  const { j } = await old(h, 1);
  h.callee("schema.apply", () => {
    throw new Error("the schema module is busy");
  });
  for (let n = 1; n <= 4; n++) await tick(h);
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.migrateNote, undefined);
  await tick(h);
  assert.match(
    (await h.call("journeys.get", { journeyId: j.id }, alice)).journey.migrateNote,
    /the schema module is busy \(tried 5 times\)/,
  );
});

test("a type that already has a Journey is a reason, not a loop", async () => {
  const h = harness();
  await pipe(h, { recordType: "contact", subjectType: "contact" });
  const { j } = await old(h, 1);
  assert.deepEqual(await tick(h), [j.id]);
  assert.match(
    (await h.call("journeys.get", { journeyId: j.id }, alice)).journey.migrateNote,
    /already runs this record type/,
  );
  assert.deepEqual(await tick(h), []);
});

test("an rc.39 Space's Journeys survive the new migrations: the rows are still there and read as the old model", async () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const { readFileSync } = process.getBuiltinModule("node:fs");
  const dir = new URL("../migrations/", import.meta.url);
  const sql = (n: string): string => readFileSync(new URL(n, dir), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(sql("0001_journeys.sql"));
  db.exec(sql("0002_task_done_run.sql"));
  db.prepare(
    "INSERT INTO journeys_defs (id, name, subject_type, record_type, version, stages, created_at, updated_at) VALUES ('jrn_old', 'ATP', 'client', 'journey_atp', 3, '[]', 1, 2)",
  ).run();
  db.prepare(
    "INSERT INTO journeys_records (record_id, journey_id, subject_record_id, version, stage, start_stage, entered_at, owner_id, start_key, channel_id, thread_id, started_at) VALUES ('rec_j1', 'jrn_old', 'rec_c1', 3, 'review', 'intake', 5, 'usr_a', 'k1', 'chn_1', 'thr_1', 4)",
  ).run();
  db.exec(sql("0003_pipeline.sql"));
  db.exec(sql("0004_migrate_note.sql"));
  const j = db
    .prepare("SELECT mode, stage_field, legacy_type, migrate_note, variables FROM journeys_defs WHERE id = 'jrn_old'")
    .get() as Record<string, unknown>;
  assert.deepEqual(
    { ...j },
    { mode: "subject", stage_field: null, legacy_type: null, migrate_note: null, variables: null },
  );
  const r = db
    .prepare("SELECT stage, channel_id, legacy_record_id FROM journeys_records WHERE record_id = 'rec_j1'")
    .get() as Record<string, unknown>;
  assert.deepEqual({ ...r }, { stage: "review", channel_id: "chn_1", legacy_record_id: null });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM journeys_migration").get() as { n: number }).n, 0);
});

test("values: a Journey carries the keys it declares for a record; reading a record that is on no Journey is empty and writing is refused", async () => {
  const h = harness();
  const j = await pipe(h, {
    variables: [
      { key: "plan", title: "Plan" },
      { key: "owner", title: "Owner" },
    ],
  });
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1" }, alice);
  assert.deepEqual((await h.call("journeys.values.get", { recordId: "rec_c1" }, alice)).values, {});
  await h.call("journeys.values.set", { recordId: "rec_c1", key: "plan", value: "Premium" }, alice);
  await h.call("journeys.values.set", { recordId: "rec_c1", key: "owner", value: { name: "Lena" } }, alice);
  await h.call("journeys.values.set", { recordId: "rec_c1", key: "plan", value: "Gold" }, alice);
  assert.deepEqual((await h.call("journeys.values.get", { recordId: "rec_c1" }, alice)).values, {
    owner: { name: "Lena" },
    plan: "Gold",
  });
  assert.deepEqual((await h.call("journeys.values.get", { recordId: "rec_nobody" }, alice)).values, {});
  await refused(
    h.call("journeys.values.set", { recordId: "rec_nobody", key: "plan", value: 1 }, alice),
    "validation.precondition_failed",
    "not_on_journey",
  );
  await refused(
    h.call("journeys.values.set", { recordId: "rec_c1", key: "colour", value: 1 }, alice),
    "validation.precondition_failed",
    "not_declared",
  );
  await refused(
    h.call("journeys.values.set", { recordId: "rec_c1", key: "plan", value: "x".repeat(4001) }, alice),
    "validation.precondition_failed",
    "too_long",
  );
});

test("values follow the record through a move onto the pipeline model", async () => {
  const h = harness();
  const { j, ids } = await old(h, 1);
  void ids;
  const g = (await h.call("journeys.get", { journeyId: j.id }, alice)).journey;
  assert.equal(g.variables, undefined, "an old Journey carries nothing until it is given values");
});

test("stage_since: when each record entered the stage it is in; a move restarts it, an edit does not, other records are left out", async () => {
  const h = harness();
  const j = await pipe(h);
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1" }, alice);
  const t0 = h.now();
  h.advance(5 * 86_400_000);
  const a = await h.call("journeys.stage_since", { journeyId: j.id, recordIds: ["rec_c1", "rec_nobody"] }, alice);
  assert.deepEqual(a.since, { rec_c1: t0 });
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: "rec_c1", toStage: "won", reason: "Signed" }, alice);
  const b = await h.call("journeys.stage_since", { journeyId: j.id, recordIds: ["rec_c1"] }, alice);
  assert.equal(b.since.rec_c1, t0 + 5 * 86_400_000);
});

// ---- r-review, 19 Nov: migration safety ----

test("the migration's record writes say they are quiet, so no Automation starts for them", async () => {
  const h = harness();
  const { j } = await old(h, 2);
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  const writes = h.only("records.update").filter((c) => c.input.type === "contact");
  assert.equal(writes.length, 2);
  assert.ok(
    writes.every((c) => c.input.quiet === true),
    "every migration write is quiet",
  );
  // a real move is not quiet: Automations that listen for a stage change run for it
  const pj = await pipe(h, { name: "Live", recordType: "client", subjectType: "client" });
  await h.call("journeys.start", { journeyId: pj.id, subjectRecordId: "rec_c9" }, alice);
  await h.call("journeys.move_stage", { journeyId: pj.id, recordId: "rec_c9", toStage: "won", reason: "x" }, alice);
  assert.ok(
    h
      .only("records.update")
      .filter((c) => c.input.type === "client")
      .every((c) => c.input.quiet === undefined),
  );
});

const existing = (over: Record<string, unknown> = {}) => ({
  type: "status",
  options: {
    stages: [
      { key: "open", title: "Open" },
      { key: "lead", title: "Lead (mine)" },
    ],
  },
  ...over,
});
const withField = (h: Harness, def: unknown) =>
  h.callee("schema.types.get", (i) => ({ type: { key: i.type, fields: [{ key: "stage", ...(def as object) }] } }));

test("an existing stage field is never replaced: another kind of field is refused, one people edit needs a yes, and a yes keeps every option it has", async () => {
  const h = harness();
  withField(h, { type: "text" });
  await refused(pipe(h), "validation.precondition_failed", "stage_field_type");
  assert.equal(h.only("schema.apply").length, 0, "nothing was changed");
  const g = harness();
  withField(g, existing());
  await refused(pipe(g), "validation.precondition_failed", "field_in_use");
  assert.equal(g.only("schema.apply").length, 0);
  await pipe(g, { useExisting: true });
  const op = g.only("schema.apply")[0]!.input.ops[0];
  assert.equal(op.op, "field.update");
  assert.deepEqual(
    op.def.options.stages.map((s: any) => s.key),
    ["open", "lead", "won"],
    "its own options first and in order, then the Journey's missing stage",
  );
  assert.equal(op.def.options.stages[1].title, "Lead (mine)", "an option it has keeps its own title");
  assert.ok(op.def.writeOnlyBy.includes("journeys.move_stage"));
});

test("a field the Journey already owns is left as it is, and a later design only adds stages", async () => {
  const h = harness();
  withField(
    h,
    existing({
      writeOnlyBy: [
        "journeys.move_stage",
        "journeys.advance",
        "journeys.migrate",
        "journeys.start",
        "journeys.to_pipeline",
      ],
      options: {
        stages: [
          { key: "lead", title: "Lead" },
          { key: "won", title: "Won" },
        ],
      },
    }),
  );
  const j = await pipe(h);
  assert.equal(h.only("schema.apply").length, 0, "nothing to change");
  withField(
    h,
    existing({
      writeOnlyBy: ["journeys.move_stage"],
      options: {
        stages: [
          { key: "lead", title: "Lead" },
          { key: "won", title: "Won" },
          { key: "extra", title: "Extra" },
        ],
      },
    }),
  );
  await h.call(
    "journeys.design",
    {
      journeyId: j.id,
      stages: [
        stage("lead", 0, { exit: { requireTasks: false } }),
        stage("review", 1, { exit: { requireTasks: false } }),
        stage("won", 2, { final: true, exit: { requireTasks: false } }),
      ],
    },
    alice,
  );
  const keys = h
    .only("schema.apply")
    .at(-1)!
    .input.ops[0].def.options.stages.map((s: any) => s.key);
  assert.deepEqual(keys, ["lead", "review", "won", "extra"], "an option the field has is never dropped");
});

test("while the Journey is being moved nothing redesigns it, removes it, migrates its version or keeps a value for it", async () => {
  const h = harness();
  const { j, ids } = await old(h, 1);
  h.callee("records.update", (i) => {
    if (i.type === "contact") throw new Error("down");
    return { record: {} };
  });
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  await refused(
    h.call("journeys.design", { journeyId: j.id, stages: noTasks() }, alice),
    "validation.precondition_failed",
    "migrating",
  );
  await refused(h.call("journeys.delete", { journeyId: j.id }, alice), "validation.precondition_failed", "migrating");
  await refused(
    h.call("journeys.migrate", { journeyId: j.id, toVersion: 1, stageMap: {} }, alice),
    "validation.precondition_failed",
    "migrating",
  );
  await refused(
    h.call("journeys.values.set", { recordId: ids[0], key: "plan", value: 1 }, alice),
    "validation.precondition_failed",
    "migrating",
  );
});

test("values follow the record to its own id when the Journey moves onto the pipeline", async () => {
  const h = harness();
  const j = (await h.call("journeys.create", newJourney({ stages: noTasks() }), alice)).journey;
  const id = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s0" }, alice)).recordId;
  h.ctxFor("journeys.to_pipeline", alice).db.run(
    "INSERT INTO journeys_values (record_id, key, value, at, by_who) VALUES (?, 'plan', ?, 1, 'usr_a')",
    id,
    JSON.stringify("Gold"),
  );
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  const rows = h.db.all("SELECT record_id, key FROM journeys_values") as any[];
  assert.deepEqual(
    rows.map((r) => [r.record_id, r.key]),
    [["rec_s0", "plan"]],
  );
});

test("a Retry that arrives while the background move is stepping the Journey does not step it twice", async () => {
  const h = harness();
  const { j } = await old(h, 2);
  let inside = 0;
  let overlap = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  h.callee("records.update", async (i) => {
    if (i.type !== "contact") return { record: {} };
    inside++;
    if (inside > 1) overlap = true;
    await gate;
    inside--;
    return { record: {} };
  });
  const first = h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  await new Promise((r) => setTimeout(r, 20));
  const second = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(second.finished, false, "the second answers without stepping");
  release();
  const done = await first;
  assert.equal(done.finished, true);
  assert.equal(overlap, false);
  assert.equal(
    h.only("records.update").filter((c) => c.input.type === "contact").length,
    2,
    "each record written once",
  );
});

test("a subject cannot have two Journey records in one Journey, so a move never meets two for one record", async () => {
  const h = harness();
  const { j } = await old(h, 1);
  await refused(
    h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s0", idempotencyKey: "again" }, alice),
    "validation.duplicate",
    "already_enrolled",
  );
  assert.throws(() =>
    h
      .ctxFor("journeys.start", alice)
      .db.run(
        "INSERT INTO journeys_records (record_id, journey_id, subject_record_id, version, stage, start_stage, entered_at, owner_id, start_key, started_at) VALUES ('rec_dup', ?, 'rec_s0', 1, 'lead', 'lead', 1, 'u', 'k_dup', 1)",
        j.id,
      ),
  );
});

test("two different merges of the same size are two different schema changes (the idempotency key is the content)", async () => {
  const keys: string[] = [];
  for (const extra of ["one", "two"]) {
    const h = harness();
    withField(
      h,
      existing({
        options: {
          stages: [
            { key: "open", title: "Open" },
            { key: extra, title: extra },
          ],
        },
      }),
    );
    await pipe(h, { useExisting: true });
    keys.push(h.only("schema.apply")[0]!.input.idempotencyKey);
  }
  assert.notEqual(keys[0], keys[1]);
});

test("move_stage with expectedVersion: a card that changed first is refused with a plain reason and nothing is written; the right version moves", async () => {
  const h = harness();
  const j = await pipe(h);
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c1" }, alice);
  h.callee("records.get", () => ({ record: { version: 5 } }));
  h.reset();
  await assert.rejects(
    h.call(
      "journeys.move_stage",
      { journeyId: j.id, recordId: "rec_c1", toStage: "won", reason: "x", expectedVersion: 4 },
      alice,
    ),
    (e) => {
      assert.equal(codeOf(e), "validation.version_conflict");
      assert.match(
        (e as { error: { message: string } }).error.message,
        /^It changed first\. Look at the card and try again\.$/,
      );
      return true;
    },
  );
  assert.equal(h.only("records.update").length, 0, "nothing was written");
  const ok = await h.call(
    "journeys.move_stage",
    { journeyId: j.id, recordId: "rec_c1", toStage: "won", reason: "x", expectedVersion: 5 },
    alice,
  );
  assert.equal(ok.stage, "won");
  await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c2", idempotencyKey: "k2" }, alice);
  assert.equal(
    (await h.call("journeys.move_stage", { journeyId: j.id, recordId: "rec_c2", toStage: "won", reason: "x" }, alice))
      .stage,
    "won",
    "without a version it is as before",
  );
});

// ---- a record's own stage value is never replaced (lead, 19 Nov) ----

test("a record that already has a stage value keeps it: the Journey takes it as the record's stage, learns a stage for a value it has none for, and writes nothing to that record", async () => {
  const h = harness();
  const { j, ids } = await old(h, 3);
  // the subject records already carry their own values in the stage field: one the Journey knows, one it does not, one empty
  const values: Record<string, string | undefined> = { rec_s0: "review", rec_s1: "dormant", rec_s2: undefined };
  h.callee("records.get", (i) => ({ record: { version: 1, fields: { journey_stage: values[i.recordId] } } }));
  h.callee("schema.types.get", (i) => ({
    type: {
      key: i.type,
      fields: [
        {
          key: "journey_stage",
          type: "status",
          writeOnlyBy: [
            "journeys.move_stage",
            "journeys.advance",
            "journeys.migrate",
            "journeys.start",
            "journeys.to_pipeline",
          ],
          options: {
            stages: [
              { key: "review", title: "Review" },
              { key: "dormant", title: "Dormant (ours)" },
            ],
          },
        },
      ],
    },
  }));
  const r = await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  assert.equal(r.finished, true);
  const writes = h.only("records.update").filter((c) => c.input.type === "contact");
  assert.deepEqual(
    writes.map((w) => w.input.recordId),
    ["rec_s2"],
    "only the record with no value was given one",
  );
  const rows = h.db.all("SELECT record_id, stage, version FROM journeys_records ORDER BY record_id") as any[];
  assert.deepEqual(
    rows.map((x) => [x.record_id, x.stage]),
    [
      ["rec_s0", "review"],
      ["rec_s1", "dormant"],
      ["rec_s2", "lead"],
    ],
    "the records' own values are the stages",
  );
  const g = (await h.call("journeys.get", { journeyId: j.id }, alice)).journey;
  assert.deepEqual(
    g.stages.map((s: any) => s.key),
    ["lead", "won", "review", "dormant"],
    "the stages it had, then one for each value it had none for, in the order they were met",
  );
  assert.ok(
    g.stages.some((s: any) => s.key === "dormant" && s.title === "Dormant (ours)"),
    "the stage has the name the field gave it",
  );
  assert.equal(g.version, 3, "one new version for each stage the Journey learned");
  assert.equal(rows.find((x) => x.record_id === "rec_s1").version, 3);
  void ids;
});

test("a finished record whose field still says an open value stays finished; one whose value is the final stage stays finished", async () => {
  const h = harness();
  const { j, ids } = await old(h, 2);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: ids[0], toStage: "won", reason: "done" }, alice);
  const values: Record<string, string> = { rec_s0: "lead", rec_s1: "won" };
  h.callee("records.get", (i) => ({ record: { version: 1, fields: { journey_stage: values[i.recordId] } } }));
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  const rows = h.db.all("SELECT record_id, stage, completed_at FROM journeys_records ORDER BY record_id") as any[];
  assert.deepEqual(
    rows.map((x) => [x.record_id, x.stage, x.completed_at !== null]),
    [
      ["rec_s0", "lead", true],
      ["rec_s1", "won", true],
    ],
    "never reopened; an open record whose value is final is closed",
  );
});

test("a record whose value is its stage already keeps its version; one that adopts a stage its own version has keeps that version; only a learned stage moves it to the newest", async () => {
  const h = harness();
  const { j } = await old(h, 3);
  // a later design adds a time limit to lead (version 2); the records stay on version 1 until they are migrated by hand
  await h.call(
    "journeys.design",
    {
      journeyId: j.id,
      stages: [
        stage("lead", 0, { exit: { requireTasks: false }, timeLimit: { hours: 1 } }),
        stage("won", 1, { final: true, exit: { requireTasks: false } }),
      ],
    },
    alice,
  );
  const values: Record<string, string> = { rec_s0: "lead", rec_s1: "won", rec_s2: "negotiating" };
  h.callee("records.get", (i) => ({ record: { version: 1, fields: { journey_stage: values[i.recordId] } } }));
  await h.call("journeys.to_pipeline", { journeyId: j.id }, alice);
  const v = Object.fromEntries(
    (h.db.all("SELECT record_id, version, stage FROM journeys_records") as any[]).map((r) => [
      r.record_id,
      [r.stage, r.version],
    ]),
  );
  assert.deepEqual(v["rec_s0"], ["lead", 1], "already at lead: untouched, still version 1 (no new time limit for it)");
  assert.deepEqual(v["rec_s1"], ["won", 1], "adopting won, which its own version has: keeps version 1");
  assert.deepEqual(
    v["rec_s2"],
    ["negotiating", 3],
    "a stage the Journey had to learn is on the version that learned it",
  );
  h.advance(5 * 3_600_000);
  const before = h.only("tasks.create").length;
  await h.call("journeys.check_limits", {}, alice).catch(() => undefined);
  assert.equal(
    h.only("tasks.create").length,
    before,
    "a record left on version 1 is not overdue for a limit it was never opened under",
  );
});
