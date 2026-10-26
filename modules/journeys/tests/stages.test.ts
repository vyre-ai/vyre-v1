// Journeys: create, design, Start rule, start, move_stage, advance, time limits (spec 2.12). The modules a Journey calls (schema, records, tasks, automations, chat, runs) are scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, HOUR, NOW, newJourney, stage, task, threeStages } from "../fixtures/seed.ts";

const names = (h: Harness): string[] => h.events.map((e) => e.name);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const mk = async (h: Harness, over: Record<string, unknown> = {}): Promise<any> => (await h.call("journeys.create", newJourney(over), alice)).journey;   // eslint-disable-line @typescript-eslint/no-explicit-any
const begin = async (h: Harness, j: { id: string }, subject = "rec_s1", over: Record<string, unknown> = {}): Promise<string> =>
  (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: subject, ...over }, alice)).recordId as string;
const advance = (h: Harness, recordId: string): Promise<any> => h.call("journeys.advance", { recordId }, alice);   // eslint-disable-line @typescript-eslint/no-explicit-any
const taskOf = (h: Harness, title: string): string => h.tasks.find((t) => t.input.title === title)!.id;

// ---- create ----

test("create makes the Journey and its record type through schema, saves version 1 and says so", async () => {
  const h = harness();
  const j = await mk(h);
  assert.equal(j.name, "Client intake");
  assert.equal(j.recordType, "journey_client_intake");
  assert.equal(j.subjectType, "contact");
  assert.equal(j.version, 1);
  assert.equal(j.inFlight, 0);
  assert.deepEqual(j.stages.map((s: { key: string }) => s.key), ["intake", "review", "done"]);
  assert.deepEqual(names(h), ["journey.created", "journey.designed"]);
  assert.deepEqual(h.events[0]!.payload, { journeyId: j.id, name: "Client intake", recordType: "journey_client_intake", subjectType: "contact" });
  assert.deepEqual(h.events[1]!.payload, { journeyId: j.id, version: 1, stages: ["intake", "review", "done"], by: alice.id });
  const apply = h.only("schema.apply")[0]!.input;
  assert.equal(apply.ops[0].op, "type.create");
  assert.equal(apply.ops[0].type, "journey_client_intake");
  const fields = Object.fromEntries(apply.ops[0].def.fields.map((f: { key: string; type: string; options?: unknown }) => [f.key, f]));
  assert.equal(fields.subject.type, "relation");
  assert.deepEqual(fields.subject.options, { target: "contact" }, "the required Subject relation");
  assert.equal(fields.stage.type, "status");
  assert.ok(fields.stage.writeOnlyBy.includes("journeys.move_stage"));
  assert.deepEqual((await h.call("journeys.versions", { journeyId: j.id }, alice)).versions.map((v: { n: number; reason: string }) => [v.n, v.reason]), [[1, "Created"]]);
});

test("a Journey without stages gets Start and Done; names are unique; the record type key does not collide", async () => {
  const h = harness();
  const a = (await h.call("journeys.create", { name: "Onboarding", subjectType: "contact" }, alice)).journey;
  assert.deepEqual(a.stages.map((s: { key: string; final?: boolean }) => [s.key, !!s.final]), [["start", false], ["done", true]]);
  await refused(h.call("journeys.create", { name: "onboarding", subjectType: "contact" }, alice), "validation.duplicate", "journey_name");
  await refused(h.call("journeys.create", { name: "  ", subjectType: "contact" }, alice), "validation.precondition_failed", "name_required");
  const b = (await h.call("journeys.create", { name: "On boarding!", subjectType: "contact" }, alice)).journey;
  assert.equal(b.recordType, "journey_on_boarding");
  const c = (await h.call("journeys.create", { name: "On-boarding", subjectType: "contact" }, alice)).journey;
  assert.match(c.recordType, /^journey_on_boarding_[a-z0-9]{4}$/, "a clash gets a suffix");
});

test("stages must be sound: no repeats of a key, a position or a task key", async () => {
  const h = harness();
  await refused(h.call("journeys.create", newJourney({ stages: [stage("a", 0), stage("a", 1)] }), alice), "validation.precondition_failed", "duplicate_stage");
  await refused(h.call("journeys.create", newJourney({ stages: [stage("a", 0), stage("b", 0)] }), alice), "validation.precondition_failed", "duplicate_order");
  await refused(h.call("journeys.create", newJourney({ stages: [stage("a", 0, { tasks: [task("t"), task("t")] })] }), alice), "validation.precondition_failed", "duplicate_task");
  assert.equal(h.only("schema.apply").length, 0, "nothing was created");
});

// ---- start rule ----

test("the Start rule compiles to an Automation that starts the Journey for each matching record", async () => {
  const h = harness();
  const j = await mk(h, { startRule: { event: "record.created", filter: { status: "new" }, enabled: true } });
  const made = h.only("automations.create")[0]!.input;
  assert.equal(made.name, "Start Client intake");
  assert.deepEqual(made.definition.triggers, [{ key: "record_change", filter: { type: "contact", op: "created", where: { status: "new" } } }]);
  assert.equal(made.definition.nodes.length, 1);
  assert.equal(made.definition.nodes[0].key, "start_journey");
  assert.deepEqual(made.definition.nodes[0].input, { journeyId: j.id, subjectRecordId: "{{ trigger.recordId }}" });
  assert.equal(made.idempotencyKey, `jrn-start:${j.id}:1`);
  assert.deepEqual(h.only("automations.set_enabled")[0]!.input, { automationId: j.startAutomationId, enabled: true });
  assert.match(j.startAutomationId, /^aut_t\d+$/);
});

test("changing the Start rule updates the same Automation; turning it off or removing it switches the Automation off", async () => {
  const h = harness();
  const j = await mk(h, { startRule: { event: "record.created", enabled: true } });
  h.reset();
  const r = await h.call("journeys.design", { journeyId: j.id, stages: threeStages(), startRule: { event: "record.updated", filter: { stage: "lead" }, enabled: false } }, alice);
  assert.equal(r.journey.version, 2);
  assert.equal(r.startAutomationId, j.startAutomationId);
  assert.equal(h.only("automations.create").length, 0);
  const upd = h.only("automations.update")[0]!.input;
  assert.equal(upd.automationId, j.startAutomationId);
  assert.deepEqual(upd.definition.triggers[0].filter, { type: "contact", op: "updated", where: { stage: "lead" } });
  assert.equal(h.only("automations.set_enabled")[0]!.input.enabled, false);
  h.reset();
  const gone = await h.call("journeys.design", { journeyId: j.id, stages: threeStages(), startRule: null }, alice);
  assert.equal(gone.journey.startRule, undefined);
  assert.deepEqual(h.only("automations.set_enabled")[0]!.input, { automationId: j.startAutomationId, enabled: false });
});

test("an event that is not a record event goes to the trigger that owns it; one that nothing triggers on is refused", async () => {
  const h = harness();
  const j = await mk(h, { startRule: { event: "form.submitted", filter: { formId: "frm_intake1" }, enabled: true } });
  assert.deepEqual(h.only("automations.create")[0]!.input.definition.triggers, [{ key: "form_submit", filter: { formId: "frm_intake1" } }]);
  assert.ok(j.startAutomationId);
  await refused(h.call("journeys.create", newJourney({ name: "Other", startRule: { event: "weather.changed", enabled: true } }), alice), "validation.precondition_failed", "bad_start_event");
  await refused(h.call("journeys.design", { journeyId: j.id, stages: threeStages(), startRule: { event: "record.exploded", enabled: true } }, alice), "validation.precondition_failed", "bad_start_event");
});

// ---- start ----

test("start makes the Journey record with its channel, enters the first stage, makes its tasks and runs its Automations", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ intake: { automations: ["aut_welcome1"] } }) });
  h.reset();
  const r = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice);
  assert.equal(r.stage, "intake");
  assert.match(r.recordId, /^rec_t\d+$/);
  assert.deepEqual(names(h), ["journey.started", "journey.stage_entered"]);
  assert.deepEqual(h.events[0]!.payload, { journeyId: j.id, recordId: r.recordId, subjectRecordId: "rec_s1", stage: "intake", version: 1 });
  assert.deepEqual(h.events[1]!.payload, { journeyId: j.id, recordId: r.recordId, stage: "intake", version: 1, manual: false });
  const rec = h.only("records.create")[0]!.input;
  assert.equal(rec.type, "journey_client_intake");
  assert.deepEqual({ ...rec.fields, name: undefined }, { name: undefined, stage: "intake", subject: [{ urn: `vyre://spc_test/contact/rec_s1` }], owner: alice.id, entered_at: new Date(NOW).toISOString() });
  assert.equal(h.only("channels.create")[0]!.input.recordId, r.recordId);
  assert.equal(h.tasks.length, 2);
  const t = h.tasks[0]!.input;
  assert.deepEqual([t.kind, t.title, t.recordId, t.source], ["work", "Do collect_documents", r.recordId, { kind: "journey", id: r.recordId }]);
  assert.equal(t.idempotencyKey, `jrn:${r.recordId}:intake:collect_documents:${NOW}`);
  const fire = h.only("automations.fire")[0]!.input;
  assert.deepEqual([fire.automationId, fire.trigger, fire.eventId, fire.depth, fire.origin], ["aut_welcome1", "journey_stage_entered", h.events[1]!.id, 0, `journey:${j.id}`]);
  assert.deepEqual(fire.payload, { journeyId: j.id, recordId: r.recordId, stage: "intake", manual: false });
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.inFlight, 1);
});

test("the Start rule enrols once: a subject is in a Journey one time; the same key is the same record", async () => {
  const h = harness();
  const j = await mk(h);
  const first = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1", idempotencyKey: "k-1" }, alice);
  const again = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1", idempotencyKey: "k-1" }, alice);
  assert.deepEqual(again, first);
  assert.deepEqual(h.events, [], "the repeat did nothing");
  assert.equal(h.only("records.create").length, 1);
  await refused(h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1", idempotencyKey: "k-2" }, alice), "validation.duplicate", "already_enrolled");
  const other = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s2", idempotencyKey: "k-3" }, alice);
  assert.notEqual(other.recordId, first.recordId);
  assert.equal(h.only("records.create").length, 2);
});

test("start can begin at a later stage, but not at one that does not exist or at the last", async () => {
  const h = harness();
  const j = await mk(h);
  const r = await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1", startStage: "review" }, alice);
  assert.equal(r.stage, "review");
  await refused(h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s2", startStage: "nope" }, alice), "validation.precondition_failed", "no_such_stage");
  await refused(h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s3", startStage: "done" }, alice), "validation.precondition_failed", "final_stage");
});

test("a task for an agent keeps its key and backup key; a task that fails to start does not stop the Journey", async () => {
  const h = harness();
  const j = await mk(h);
  const rec = await begin(h, j, "rec_s1", { startStage: "review" });
  const notes = h.only("tasks.working_notes.set").map((c) => [c.input.key, c.input.value]);
  assert.deepEqual(notes, [["key_id", "vit_key1"], ["backup_key_id", "vit_key2"]]);
  const h2 = harness({ calls: { "tasks.create": () => { throw new Error("tasks is down"); } } });
  const j2 = await mk(h2);
  const r2 = await h2.call("journeys.start", { journeyId: j2.id, subjectRecordId: "rec_s1" }, alice);
  assert.equal(r2.stage, "intake");
  assert.ok(rec);
});

test("a stage that makes a project gives the record a Project once; a stage that does not makes none", async () => {
  const made: Record<string, unknown>[] = [];
  const h = harness({ calls: { "projects.create": (i) => { made.push(i); return { projectId: "prj_t1", recordId: "rec_p1", channelId: "chn_p1", folderId: "fld_p1" }; } } });
  const plain = await mk(h, { name: "Plain" });
  await begin(h, plain, "rec_s1");
  assert.equal(made.length, 0, "no flag, no project");
  const j = await mk(h, { name: "Client onboarding", stages: threeStages({ intake: { makesProject: true, tasks: [] } }) });
  const rec = await begin(h, j, "rec_s2");
  assert.equal(made.length, 1);
  assert.equal(made[0]!.type, "project");
  assert.match(String(made[0]!.title), /^Client onboarding /);
  assert.equal(made[0]!.idempotencyKey, `jrn-project:${rec}`, "one project per record");
  const h2 = harness({ calls: { "projects.create": () => { throw Object.assign(new Error("x"), { error: { code: "validation.bad_input", message: "projects is down", details: { errors: ["/title: too short"] } } }); } } });
  const j2 = await mk(h2, { stages: threeStages({ intake: { makesProject: true, tasks: [] } }) });
  const recId = await begin(h2, j2, "rec_s3");
  assert.match(recId, /^rec_/, "a project that cannot be made does not stop the Journey");
  const failed = h2.tasks.filter((t) => String(t.input.title).startsWith("Project for rec_s3 could not be made: "));
  assert.equal(failed.length, 1, "the owner is told, once");
  assert.match(String(failed[0]!.input.title), /projects is down \(validation\.bad_input: \{"errors":\["\/title: too short"\]\}\)$/, "the refusal's details name the field");
  assert.deepEqual(failed[0]!.input.assigned, { kind: "person", id: alice.id });
  assert.equal(failed[0]!.input.recordId, recId);
  assert.match(String(failed[0]!.input.summary), /Trace [0-9a-f]+\./, "the task names the trace");
});

// ---- move_stage ----

test("move_stage needs a reason, leaves the old stage, enters the new, runs the new stage's Automations and posts the handoff", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ review: { automations: ["aut_review1"] } }) });
  const rec = await begin(h, j);
  const oldTasks = h.tasks.map((t) => t.id);
  h.reset();
  const r = await h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "review", reason: "Papers came by post" }, alice);
  assert.deepEqual(r, { recordId: rec, stage: "review" });
  assert.deepEqual(names(h), ["journey.stage_exited", "journey.stage_entered", "journey.moved"]);
  assert.deepEqual(h.events[0]!.payload, { journeyId: j.id, recordId: rec, stage: "intake", toStage: "review" });
  assert.deepEqual(h.events[1]!.payload, { journeyId: j.id, recordId: rec, stage: "review", previousStage: "intake", version: 1, manual: true, reason: "Papers came by post" });
  assert.deepEqual(h.events[2]!.payload, { journeyId: j.id, recordId: rec, fromStage: "intake", toStage: "review", reason: "Papers came by post", by: alice.id });
  assert.deepEqual(h.only("records.update")[0]!.input, { type: "journey_client_intake", recordId: rec, patch: { stage: "review", entered_at: new Date(NOW).toISOString() } });
  const fire = h.only("automations.fire")[0]!.input;
  assert.deepEqual([fire.automationId, fire.payload.manual, fire.payload.previousStage, fire.payload.stage], ["aut_review1", true, "intake", "review"]);
  assert.deepEqual(h.only("tasks.withdraw").map((c) => c.input.taskId).sort(), oldTasks.sort(), "the old stage's open tasks went with it");
  assert.equal(h.tasks.filter((t) => t.state === "canceled").length, 2);
  assert.equal(h.only("chat.post")[0]!.input.body, "Moved from intake to review: Papers came by post");
  assert.match(h.only("chat.post")[0]!.input.threadId, /^thr_t\d+$/);
  assert.equal(h.tasks.at(-1)!.input.title, "Do check_file", "the new stage's task");
});

test("move_stage refuses a blank reason, the stage the record is in, and a stage that does not exist", async () => {
  const h = harness();
  const j = await mk(h);
  const rec = await begin(h, j);
  await refused(h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "review", reason: "  " }, alice), "validation.precondition_failed", "reason_required");
  await refused(h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "intake", reason: "x" }, alice), "validation.precondition_failed", "already_there");
  await refused(h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "nope", reason: "x" }, alice), "validation.precondition_failed", "no_such_stage");
  await refused(h.call("journeys.move_stage", { journeyId: j.id, recordId: "rec_unknown", toStage: "review", reason: "x" }, alice), "permission.not_found");
  assert.equal(h.only("records.update").length, 0);
});

test("moving into the last stage completes the record; moving back out reopens it", async () => {
  const h = harness();
  const j = await mk(h);
  const rec = await begin(h, j);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "done", reason: "Settled" }, alice);
  assert.deepEqual(names(h), ["journey.stage_exited", "journey.stage_entered", "journey.moved", "journey.completed"]);
  assert.deepEqual(h.events[3]!.payload, { journeyId: j.id, recordId: rec, stage: "done" });
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.inFlight, 0);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "review", reason: "Client came back" }, alice);
  assert.equal(names(h).includes("journey.completed"), false);
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.inFlight, 1);
});

// ---- advance ----

test("a stage advances when its required tasks are done; optional tasks never hold it", async () => {
  const h = harness();
  const j = await mk(h);
  const rec = await begin(h, j);
  assert.deepEqual(await advance(h, rec), { advanced: false, stage: "intake" });
  assert.deepEqual(h.events, []);
  h.complete(taskOf(h, "Do collect_documents"));
  const r = await advance(h, rec);
  assert.deepEqual(r, { advanced: true, stage: "review" });
  assert.deepEqual(names(h), ["journey.stage_exited", "journey.stage_entered"]);
  assert.equal(h.events[1]!.payload.manual, false);
  assert.equal(h.tasks.find((t) => t.input.title === "Do welcome_call")!.state, "canceled", "the optional task was left behind");
  assert.deepEqual(await advance(h, rec), { advanced: false, stage: "review" }, "asking again changes nothing");
  h.complete(taskOf(h, "Do check_file"));
  assert.deepEqual(await advance(h, rec), { advanced: true, stage: "done" });
  assert.deepEqual(names(h), ["journey.stage_exited", "journey.stage_entered", "journey.completed"]);
  assert.deepEqual(await advance(h, rec), { advanced: false, stage: "done" });
});

test("a stage with no exit requirement advances at once, and one that is manual only never does", async () => {
  const h = harness();
  const j = await mk(h, { stages: [stage("a", 0, { exit: { requireTasks: false } }), stage("b", 1, { exit: { requireTasks: true, manualOnly: true }, tasks: [task("t")] }), stage("c", 2, { final: true })] });
  const rec = await begin(h, j);
  assert.equal((await advance(h, rec)).advanced, true);
  h.complete(taskOf(h, "Do t"));
  assert.deepEqual(await advance(h, rec), { advanced: false, stage: "b" });
});

test("advance on a record the Journey does not know is not found", async () => {
  const h = harness();
  await refused(advance(h, "rec_unknown"), "permission.not_found");
});

// ---- design ----

test("design saves a new version, keeps records on theirs, and reads their stages from it", async () => {
  const h = harness();
  const j = await mk(h);
  const rec = await begin(h, j);
  const v2 = threeStages({ review: { tasks: [task("v2_task")] } });
  v2.push(stage("archive", 3, { final: true }));
  v2[2] = stage("done", 2, { exit: { requireTasks: false } });
  const r = await h.call("journeys.design", { journeyId: j.id, stages: v2, note: "Added archive" }, alice);
  assert.equal(r.journey.version, 2);
  assert.deepEqual(names(h), ["journey.designed"]);
  assert.deepEqual(h.events[0]!.payload.stages, ["intake", "review", "done", "archive"]);
  assert.deepEqual((await h.call("journeys.versions", { journeyId: j.id }, alice)).versions.map((v: { n: number; reason?: string }) => [v.n, v.reason]), [[2, "Added archive"], [1, "Created"]]);
  h.complete(taskOf(h, "Do collect_documents"));
  await advance(h, rec);
  assert.equal(h.tasks.at(-1)!.input.title, "Do check_file", "the record is on version 1: its review stage, not version 2's");
  const next = await begin(h, j, "rec_s2");
  assert.ok(next);
  assert.equal(h.events.at(-1)!.payload.version, 2, "a new record starts on the new version");
});

test("a stage that records are in cannot be removed; an old version, an unchanged design and a repeated key are handled", async () => {
  const h = harness();
  const j = await mk(h);
  await begin(h, j);
  const without = threeStages().filter((s) => s.key !== "intake");
  await assert.rejects(h.call("journeys.design", { journeyId: j.id, stages: without }, alice), (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.deepEqual((e as { error: { details: unknown } }).error.details, { reason: "stage_in_use", stages: ["intake"] });
    return true;
  });
  const none = await h.call("journeys.design", { journeyId: j.id, stages: threeStages() }, alice);
  assert.equal(none.journey.version, 1, "the same design is not a new version");
  assert.deepEqual(h.events, []);
  await assert.rejects(h.call("journeys.design", { journeyId: j.id, stages: threeStages({ review: { tasks: [] } }), expectedVersion: 5 }, alice), (e) => {
    assert.equal(codeOf(e), "validation.version_conflict");
    assert.deepEqual((e as { error: { details: unknown } }).error.details, { current: 1, expected: 5 });
    return true;
  });
});

test("rules.set changes one stage's exit rule and time limit as a new version", async () => {
  const h = harness();
  const j = await mk(h);
  const r = await h.call("journeys.rules.set", { journeyId: j.id, stageKey: "intake", exit: { requireTasks: false, manualOnly: true }, timeLimit: { hours: 48, escalateTo: { kind: "role", id: "rol_lead" } } }, alice);
  assert.equal(r.journey.version, 2);
  const intake = r.journey.stages.find((s: { key: string }) => s.key === "intake");
  assert.deepEqual(intake.exit, { requireTasks: false, manualOnly: true });
  assert.deepEqual(intake.timeLimit, { hours: 48, escalateTo: { kind: "role", id: "rol_lead" } });
  const cleared = await h.call("journeys.rules.set", { journeyId: j.id, stageKey: "intake", timeLimit: null }, alice);
  assert.equal(cleared.journey.stages.find((s: { key: string }) => s.key === "intake").timeLimit, undefined);
  await refused(h.call("journeys.rules.set", { journeyId: j.id, stageKey: "nope", exit: { requireTasks: true } }, alice), "validation.not_found", "no_such_stage");
});

test("rename and delete: names stay unique; a Journey with records in flight is not deleted; deleting switches the start Automation off", async () => {
  const h = harness();
  const a = await mk(h, { startRule: { event: "record.created", enabled: true } });
  const b = await mk(h, { name: "Billing" });
  await refused(h.call("journeys.rename", { journeyId: b.id, name: "client INTAKE" }, alice), "validation.duplicate", "journey_name");
  const r = await h.call("journeys.rename", { journeyId: b.id, name: "Invoicing" }, alice);
  assert.equal(r.journey.name, "Invoicing");
  assert.deepEqual(names(h), ["journey.designed"]);
  const rec = await begin(h, a);
  await refused(h.call("journeys.delete", { journeyId: a.id }, alice), "validation.precondition_failed", "in_flight");
  await h.call("journeys.move_stage", { journeyId: a.id, recordId: rec, toStage: "done", reason: "Closed" }, alice);
  h.reset();
  assert.deepEqual(await h.call("journeys.delete", { journeyId: a.id }, alice), { deleted: true });
  assert.deepEqual(names(h), ["journey.deleted"]);
  assert.deepEqual(h.events[0]!.payload, { journeyId: a.id, recordType: "journey_client_intake" });
  assert.deepEqual(h.only("automations.set_enabled")[0]!.input, { automationId: a.startAutomationId, enabled: false });
  await refused(h.call("journeys.get", { journeyId: a.id }, alice), "permission.not_found");
  assert.deepEqual((await h.call("journeys.list", {}, alice)).journeys.map((x: { id: string }) => x.id), [b.id]);
});

test("list shows stage counts and records in flight", async () => {
  const h = harness();
  const j = await mk(h);
  await begin(h, j, "rec_s1");
  await begin(h, j, "rec_s2");
  const l = await h.call("journeys.list", {}, alice);
  assert.equal(l.total, 1);
  assert.deepEqual({ ...l.journeys[0], id: undefined, updatedAt: undefined }, { id: undefined, name: "Client intake", subjectType: "contact", recordType: "journey_client_intake", version: 1, stages: 3, inFlight: 2, updatedAt: undefined });
});

// ---- counts and time limits ----

test("stage counts show how many records are in each stage and how many are over the limit", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ intake: { timeLimit: { hours: 24 } } }) });
  await begin(h, j, "rec_s1");
  h.advance(30 * HOUR);
  await begin(h, j, "rec_s2");
  const rec3 = await begin(h, j, "rec_s3", { startStage: "review" });
  assert.ok(rec3);
  const c = await h.call("journeys.stage_counts", { journeyId: j.id }, alice);
  assert.deepEqual(c.stages, [{ stage: "intake", count: 2, overLimit: 1 }, { stage: "review", count: 1, overLimit: 0 }, { stage: "done", count: 0, overLimit: 0 }]);
});

test("a time limit reaches the owner's Needs you once, then the escalation role once, then stays quiet", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ intake: { timeLimit: { hours: 24, escalateTo: { kind: "role", id: "rol_lead" } } } }) });
  const rec = await begin(h, j);
  h.reset();
  h.advance(23 * HOUR);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 0 });
  h.advance(HOUR);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 1 });
  assert.deepEqual(h.events[0]!.payload, { journeyId: j.id, recordId: rec, stage: "intake", limitHours: 24, escalated: false });
  const owner = h.only("tasks.create").at(-1)!.input;
  assert.deepEqual([owner.kind, owner.assigned, owner.recordId], ["unblock", { kind: "person", id: alice.id }, rec]);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 0 }, "reported once");
  h.advance(23 * HOUR);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 0 }, "not yet twice the limit");
  h.advance(HOUR);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 1 });
  assert.equal(h.events[0]!.payload.escalated, true);
  const esc = h.only("tasks.create").at(-1)!.input;
  assert.deepEqual(esc.assigned, { kind: "role", id: "rol_lead" });
  assert.match(esc.title, /^Escalated: /);
  assert.deepEqual(await h.call("journeys.check_limits", {}, alice), { breached: 0 }, "escalated once");
});

test("a stage without a limit never breaches, and a record that moved on starts a fresh clock", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ intake: { timeLimit: { hours: 1 } } }) });
  const rec = await begin(h, j);
  h.advance(2 * HOUR);
  assert.equal((await h.call("journeys.check_limits", {}, alice)).breached, 1);
  await h.call("journeys.move_stage", { journeyId: j.id, recordId: rec, toStage: "review", reason: "x" }, alice);
  h.advance(100 * HOUR);
  assert.equal((await h.call("journeys.check_limits", {}, alice)).breached, 0, "review has no limit");
});

// ---- on leaving, and task state (P-CC_26) ----

test("a stage's on-leaving Automations run when a record leaves it, in the order: leave, then enter", async () => {
  const h = harness();
  const j = await mk(h, { stages: threeStages({ intake: { onLeaving: ["aut_bye1"] }, review: { automations: ["aut_review1"] } }) });
  const recordId = await begin(h, j);
  h.reset();
  await h.call("journeys.move_stage", { journeyId: j.id, recordId, toStage: "review", reason: "Skip the call" }, alice);
  const fired = h.only("automations.fire");
  assert.deepEqual(fired.map((f) => [f.input.automationId, f.input.trigger]), [["aut_bye1", "journey_stage_left"], ["aut_review1", "journey_stage_entered"]]);
  assert.deepEqual(fired[0]!.input.payload, { journeyId: j.id, recordId, stage: "intake", toStage: "review" });
  // a stage with no on-leaving list, and an Automation that cannot start, never stop the move
  h.callee("automations.fire", () => { throw new Error("down"); });
  await h.call("journeys.move_stage", { journeyId: j.id, recordId, toStage: "done", reason: "Finish" }, alice);
  assert.equal((await h.call("journeys.get", { journeyId: j.id }, alice)).journey.stages[0].onLeaving[0], "aut_bye1");
});

test("journeys.tasks lists a record's tasks with todo, in review, blocked and done states, and leaves out withdrawn ones", async () => {
  const h = harness();
  const j = await mk(h);
  const recordId = await begin(h, j);
  const [a, b] = h.tasks;
  a!.state = "done";
  const blocked = new Set<string>();
  h.callee("tasks.get", (i) => {
    const t = h.tasks.find((x) => x.id === i.taskId);
    return { task: { id: i.taskId, title: t!.input.title, state: t!.state, blocked: blocked.has(String(i.taskId)), assigned: t!.input.assigned } };
  });
  const state = async (stage?: string) => (await h.call("journeys.tasks", { recordId, ...(stage ? { stage } : {}) }, alice)).tasks.map((x: { taskKey: string; state: string }) => [x.taskKey, x.state]);
  assert.deepEqual(await state(), [["collect_documents", "done"], ["welcome_call", "todo"]]);
  b!.state = "awaiting_approval";
  assert.deepEqual(await state("intake"), [["collect_documents", "done"], ["welcome_call", "in_review"]]);
  b!.state = "doing"; blocked.add(b!.id);
  assert.deepEqual((await state()).at(-1), ["welcome_call", "blocked"]);
  b!.state = "canceled";
  assert.deepEqual(await state(), [["collect_documents", "done"]]);
  await refused(h.call("journeys.tasks", { recordId: "rec_nothere" }, alice), "validation.not_found", "not_in_journey");
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
