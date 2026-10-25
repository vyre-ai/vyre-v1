// Migrating in-flight records to a new version of a Journey (spec 2.12): the preview maps every in-flight subject, the migration is a stoppable Run, records stay where they are until it runs.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newJourney, stage, task } from "../fixtures/seed.ts";
import { planMigration } from "../impl.ts";
import { getJourney } from "../projections.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const V1 = [stage("intake", 0), stage("review", 1), stage("done", 2, { final: true })];
const V2 = [stage("intake", 0), stage("review", 1), stage("qualify", 2, { tasks: [task("score_lead")] }), stage("done", 3, { final: true })];
const V3 = [stage("intake", 0), stage("qualify", 1, { tasks: [task("score_lead")] }), stage("done", 2, { final: true })];

/** Version 1 has records A and B in intake and C in review; versions 2 and 3 follow, and version 3 has no review stage. */
async function world(h: Harness) {
  const j = (await h.call("journeys.create", newJourney({ stages: V1 }), alice)).journey;
  const a = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_a" }, alice)).recordId as string;
  h.advance(1);
  const b = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_b" }, alice)).recordId as string;
  h.advance(1);
  h.advance(1);
  const c = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_c", startStage: "review" }, alice)).recordId as string;
  await h.call("journeys.design", { journeyId: j.id, stages: V2 }, alice);
  await h.call("journeys.design", { journeyId: j.id, stages: V3 }, alice);
  return { j, a, b, c };
}
const preview = (h: Harness, journeyId: string, toVersion: number, stageMap?: Record<string, string>): Promise<any> =>   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.call("journeys.preview_migrate", { journeyId, toVersion, ...(stageMap ? { stageMap } : {}) }, alice);

test("the preview maps every in-flight record and says which stages have nowhere to go", async () => {
  const h = harness();
  const { j } = await world(h);
  const p = await preview(h, j.id, 3);
  assert.deepEqual({ ...p, moves: undefined }, { fromVersion: 1, toVersion: 3, recordsAffected: 3, moves: undefined, unmapped: ["review"], blockers: [] });
  assert.deepEqual(p.moves, [{ from: "intake", to: "intake", records: 2 }, { from: "review", to: null, records: 1 }]);
  const mapped = await preview(h, j.id, 3, { review: "qualify" });
  assert.deepEqual(mapped.moves, [{ from: "intake", to: "intake", records: 2 }, { from: "review", to: "qualify", records: 1 }]);
  assert.deepEqual(mapped.unmapped, []);
  assert.deepEqual(mapped.blockers, []);
  const remap = await preview(h, j.id, 3, { intake: "qualify", review: "qualify" });
  assert.deepEqual(remap.moves.map((m: { to: string }) => m.to), ["qualify", "qualify"], "the mapping can override a stage that exists");
});

test("the preview names what stops a migration: a missing target stage, the last stage, a version that is not there", async () => {
  const h = harness();
  const { j } = await world(h);
  assert.deepEqual((await preview(h, j.id, 3, { review: "archive" })).blockers, ["Stage review maps to archive, which version 3 does not have."]);
  assert.deepEqual((await preview(h, j.id, 3, { review: "done" })).blockers, ["Stage review maps to done, the last stage. Finish those records instead."]);
  const missing = await preview(h, j.id, 9);
  assert.deepEqual(missing.blockers, ["Version 9 of this Journey does not exist."]);
  assert.equal(missing.unmapped.length, 2);
});

test("a record already on the target version needs nothing", async () => {
  const h = harness();
  const { j } = await world(h);
  assert.equal((await preview(h, j.id, 1)).recordsAffected, 0);
  await refused(h.call("journeys.migrate", { journeyId: j.id, toVersion: 1, stageMap: {} }, alice), "validation.precondition_failed", "nothing_to_migrate");
});

test("migrate is refused while a stage is unmapped or the mapping is blocked, and changes nothing", async () => {
  const h = harness();
  const { j } = await world(h);
  h.reset();
  await refused(h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: {} }, alice), "validation.precondition_failed", "unmapped");
  await assert.rejects(h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: { review: "archive" } }, alice), (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.deepEqual((e as { error: { details: { blockers: string[] } } }).error.details.blockers, ["Stage review maps to archive, which version 3 does not have."]);
    return true;
  });
  assert.equal(h.only("runs.start").length, 0);
  assert.equal(h.only("records.update").length, 0);
});

test("migrate is a Run that moves each record to its mapped stage on the new version", async () => {
  const h = harness();
  const { j, a, b, c } = await world(h);
  h.reset();
  const r = await h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: { review: "qualify" } }, alice);
  const start = h.only("runs.start")[0]!.input;
  assert.deepEqual([start.kind, start.owner, start.subject, start.definitionVersion], ["journey_migrate", alice.id, { type: "record_type", id: "journey_client_intake" }, 3]);
  assert.match(r.runId, /^run_t\d+$/);
  assert.deepEqual(h.events.map((e) => e.name), ["journey.stage_exited", "journey.stage_entered", "journey.migrated"], "only the record that changes stage leaves and enters one");
  assert.deepEqual(h.events[0]!.payload, { journeyId: j.id, recordId: c, stage: "review", toStage: "qualify" });
  assert.deepEqual(h.events[1]!.payload, { journeyId: j.id, recordId: c, stage: "qualify", previousStage: "review", version: 3, manual: false, reason: "Migrated to version 3" });
  assert.deepEqual(h.events[2]!.payload, { journeyId: j.id, fromVersion: 1, toVersion: 3, records: 3, runId: r.runId });
  assert.deepEqual(h.only("records.update").map((x) => x.input.recordId), [c]);
  assert.equal(h.tasks.at(-1)!.input.title, "Do score_lead", "the new stage's tasks are made");
  const fin = h.only("runs.finish")[0]!.input;
  assert.deepEqual([fin.runId, fin.status, fin.summary], [r.runId, "succeeded", "3 records moved to version 3"]);
  assert.equal((await preview(h, j.id, 3)).recordsAffected, 0, "everything is on version 3 now");
  const counts = await h.call("journeys.stage_counts", { journeyId: j.id }, alice);
  assert.deepEqual(counts.stages, [{ stage: "intake", count: 2, overLimit: 0 }, { stage: "qualify", count: 1, overLimit: 0 }, { stage: "done", count: 0, overLimit: 0 }]);
  assert.ok(a && b);
});

test("migrate can be limited to some records; the others stay on their version", async () => {
  const h = harness();
  const { j, c } = await world(h);
  await h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: { review: "qualify" }, recordIds: [c] }, alice);
  assert.equal((await preview(h, j.id, 3)).recordsAffected, 2, "A and B are still on version 1");
  await refused(h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: {}, recordIds: ["rec_nope"] }, alice), "validation.precondition_failed", "blocked");
});

test("stopping the Run ends the migration cleanly: the records already moved stay moved", async () => {
  const h = harness();
  const { j } = await world(h);
  let looks = 0;
  h.callee("runs.get", () => ({ run: { status: ++looks > 2 ? "stopped" : "running" } }));
  h.reset();
  const r = await h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: { review: "qualify" } }, alice);
  assert.ok(r.runId);
  const migrated = h.events.find((e) => e.name === "journey.migrated")!;
  assert.equal(migrated.payload.records, 2);
  assert.equal((await preview(h, j.id, 3)).recordsAffected, 1);
});

test("a record that cannot be moved fails the Run into the owner's Needs you; the records already moved stay moved and are reported", async () => {
  const h = harness();
  const { j, c } = await world(h);
  h.callee("records.update", (i) => { if (i.recordId === c) throw Object.assign(new Error("locked"), { error: { code: "validation.field_locked", message: "The stage is locked.", retryable: false } }); return { record: {} }; });
  h.reset();
  const r = await h.call("journeys.migrate", { journeyId: j.id, toVersion: 3, stageMap: { review: "qualify" } }, alice);
  assert.ok(r.runId);
  const fin = h.only("runs.finish")[0]!.input;
  assert.deepEqual([fin.status, fin.error], ["failed", { code: "validation.field_locked", message: `${c}: The stage is locked.` }]);
  assert.deepEqual(h.events.map((e) => e.name), ["journey.migrated"], "nothing was said about the record that did not move");
  assert.equal(h.events[0]!.payload.records, 2);
  assert.equal((await preview(h, j.id, 3)).recordsAffected, 1, "A and B moved to version 3; C is where it was");
  assert.equal(h.tasks.length, 0, "and C got no tasks of the stage it did not enter");
});

test("planMigration is the plan the preview and the migration share", async () => {
  const h = harness();
  const { j } = await world(h);
  const ctx = h.ctxFor("journeys.preview_migrate", alice);
  const plan = planMigration(ctx, getJourney(ctx, j.id), 3, { review: "qualify" });
  assert.deepEqual(plan.affected.map((r) => r.subjectRecordId), ["rec_a", "rec_b", "rec_c"]);
  assert.equal(plan.toStages!.length, 3);
  assert.deepEqual(plan.blockers, []);
});
