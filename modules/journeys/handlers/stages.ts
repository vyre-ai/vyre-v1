// Journeys: design, start and stages (spec 2.12, 3.7; ARCH 7.7). A Journey is a record type with stages; a Journey record follows one subject record through them.
// DECISION (spec Appendix B, b3, Provisional): a stage advances when its required tasks are done; a designer moves a record by hand with a reason; a time limit breach reaches the owner's
// Needs you, then, when the same time has passed again, the escalation role.
// DECISION: the Start rule compiles to an Automation (record_change or the trigger that owns the event) whose one step is `start_journey`; Start enrols once because a subject can be in a
// Journey only once (a second start with another key is validation.duplicate; the same key returns the same record).
// DECISION: records stay on the version they started on; their stages are read from that version. Deleting a stage that records are in is refused until they move or migrate.
// DECISION: the Journey record's folder comes with the record type's Projects template; start makes the record and its channel.
import { registry } from "../../../generated/registry.ts";
import {
  HOUR, allJourneys, breachOf, byOrder, clean, countInFlight, emitJ, findBySubject, findByKey, findJourney, getJourney, getRecord, inFlight, listVersions, markDeleted, me, newId, out, page,
  allTaskLinks, findRecord, raise, saveBreach, saveJourney, saveRecord, saveTaskLink, saveVersion, stagesOf, taskLinks,
} from "../projections.ts";
import type { Journey, JourneysCtx, JRecord, Stage, StartRule } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const TRIGGERS = registry.triggers;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---- design checks ----

function checkStages(ctx: JourneysCtx, stages: readonly Stage[]): void {
  if (stages.length === 0) raise(ctx, "validation.precondition_failed", "A Journey needs at least one stage.", { reason: "no_stages" });
  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const s of stages) {
    if (keys.has(s.key)) raise(ctx, "validation.precondition_failed", `Two stages share the key ${s.key}.`, { reason: "duplicate_stage", stage: s.key });
    if (orders.has(s.order)) raise(ctx, "validation.precondition_failed", `Two stages share the position ${s.order}.`, { reason: "duplicate_order", order: s.order });
    keys.add(s.key); orders.add(s.order);
    const tk = new Set<string>();
    for (const t of s.tasks) {
      if (tk.has(t.key)) raise(ctx, "validation.precondition_failed", `The stage ${s.key} has two tasks with the key ${t.key}.`, { reason: "duplicate_task", stage: s.key, task: t.key });
      tk.add(t.key);
    }
  }
}
const defaultStages = (): Stage[] => [
  { key: "start", title: "Start", order: 0, exit: { requireTasks: false }, tasks: [], automations: [] },
  { key: "done", title: "Done", order: 1, exit: { requireTasks: false }, tasks: [], automations: [], final: true },
];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "journey";

// ---- the start rule as an Automation ----

/** The trigger that owns a start event, and the filter it takes. A record event becomes a record change on the subject type. */
export function compileStartRule(j: Pick<Journey, "id" | "subjectType">, rule: StartRule): { trigger: string; filter?: unknown } | undefined {
  if (rule.event.startsWith("record.")) {
    const op = rule.event.slice("record.".length);
    if (op !== "created" && op !== "updated" && op !== "deleted") return undefined;
    return { trigger: "record_change", filter: clean({ type: j.subjectType, op, where: rule.filter }) };
  }
  const t = TRIGGERS.find((x) => { const s = x.source as { event?: string; events?: string[] }; return s.event === rule.event || (s.events ?? []).includes(rule.event); });
  return t ? { trigger: t.key, ...(rule.filter !== undefined && rule.filter !== null ? { filter: rule.filter } : {}) } : undefined;
}

/** Keep the Automation behind the Start rule in step with the rule: make it, change it, turn it off. Returns its id. */
async function syncStartRule(ctx: JourneysCtx, j: Journey): Promise<string | undefined> {
  const rule = j.startRule;
  if (!rule) {
    if (j.startAutomationId && ctx.call) await ctx.call("automations.set_enabled", { automationId: j.startAutomationId, enabled: false });
    return j.startAutomationId;
  }
  const compiled = compileStartRule(j, rule);
  if (!compiled) raise(ctx, "validation.precondition_failed", `Nothing triggers on ${rule.event}.`, { reason: "bad_start_event", event: rule.event });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Automations are not available right now.");
  const definition = {
    triggers: [clean({ key: compiled.trigger, filter: compiled.filter })],
    nodes: [{ id: "start", key: "start_journey", title: `Start ${j.name}`, input: { journeyId: j.id, subjectRecordId: "{{ trigger.recordId }}" } }],
  };
  let id = j.startAutomationId;
  if (id) await ctx.call("automations.update", { automationId: id, definition });
  else {
    const made = (await ctx.call("automations.create", { name: `Start ${j.name}`, definition, idempotencyKey: `jrn-start:${j.id}:${j.version}` })) as { automation?: { id?: string } };
    id = made?.automation?.id;
  }
  if (id) await ctx.call("automations.set_enabled", { automationId: id, enabled: rule.enabled });
  return id;
}

// ---- reads ----

export async function list(ctx: JourneysCtx, input: In): Promise<unknown> {
  const rows = allJourneys(ctx.db);
  const p = page(rows, input.cursor, input.limit);
  const journeys = p.rows.map((j) => ({
    id: j.id, name: j.name, subjectType: j.subjectType, recordType: j.recordType, version: j.version, stages: j.stages.length, inFlight: countInFlight(ctx.db, j.id), updatedAt: j.updatedAt,
  }));
  return clean({ journeys, next: p.next, total: p.total });
}
export async function get(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  return { journey: out(j, countInFlight(ctx.db, j.id)) };
}
export async function versions(ctx: JourneysCtx, input: In): Promise<unknown> {
  return { versions: listVersions(ctx.db, getJourney(ctx, input.journeyId).id) };
}

// ---- create and design ----

/** The record type a Journey follows its subject with. The status field names the Journey's stages, which the schema requires (options.stages). */
function typeDef(key: string, name: string, subjectType: string, stages: readonly Stage[]): Record<string, unknown> {
  return {
    key, title: name, plural: name, icon: "route", label: "internal", titleField: "name", statusField: "stage", ownerField: "owner", group: "Journeys",
    fields: [
      { key: "name", type: "text", title: "Name", required: true },
      { key: "stage", type: "status", title: "Stage", options: { stages: stages.map((s) => ({ key: s.key, title: s.title })) }, writeOnlyBy: ["journeys.move_stage", "journeys.advance", "journeys.migrate", "journeys.start"] },
      { key: "subject", type: "relation", title: "Subject", required: true, options: { target: subjectType } },
      { key: "owner", type: "person", title: "Owner" },
      { key: "entered_at", type: "datetime", title: "In this stage since" },
    ],
  };
}

export async function create(ctx: JourneysCtx, input: In): Promise<unknown> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) raise(ctx, "validation.precondition_failed", "A Journey needs a name.", { reason: "name_required" });
  if (allJourneys(ctx.db).some((j) => j.name.toLowerCase() === name.toLowerCase())) raise(ctx, "validation.duplicate", "A Journey with that name exists.", { reason: "journey_name" });
  const stages: Stage[] = input.stages ?? defaultStages();
  checkStages(ctx, stages);
  const rule = input.startRule as StartRule | undefined;
  // a Start rule nothing can trigger on is refused before anything is created
  if (rule && !compileStartRule({ id: "jrn_check", subjectType: input.subjectType }, rule)) raise(ctx, "validation.precondition_failed", `Nothing triggers on ${rule.event}.`, { reason: "bad_start_event", event: rule.event });
  const now = ctx.now();
  const id = newId("jrn", now);
  let recordType = `journey_${slug(name)}`;
  if (allJourneys(ctx.db).some((j) => j.recordType === recordType)) recordType = `${recordType}_${id.slice(-4)}`;
  if (!ctx.call) raise(ctx, "internal.unavailable", "Records are not available right now.");
  // the record type is made through a controlled path: only journeys.manage is needed, not schema rights
  await ctx.call("schema.apply", { ops: [{ op: "type.create", type: recordType, def: typeDef(recordType, name, input.subjectType, stages) }], reason: `Journey ${name}`, idempotencyKey: `jrn-type:${id}` });
  const j: Journey = clean({
    id, name, subjectType: input.subjectType, recordType, version: 1, stages, startRule: input.startRule as StartRule | undefined, createdAt: now, updatedAt: now,
  }) as Journey;
  if (j.startRule) j.startAutomationId = await syncStartRule(ctx, j);
  saveJourney(ctx.db, j);
  saveVersion(ctx, j, "Created");
  emitJ(ctx, "journey.created", `entity/${id}`, { journeyId: id, name, recordType, subjectType: j.subjectType });
  emitJ(ctx, "journey.designed", `entity/${id}`, { journeyId: id, version: 1, stages: stages.map((s) => s.key), by: me(ctx) });
  return { journey: out(j, 0) };
}

/** Save a new design. Stages that records are in cannot be dropped; the rest is a new version. */
async function redesign(ctx: JourneysCtx, j: Journey, stages: Stage[], startRule: StartRule | null | undefined, note: string | undefined): Promise<{ j: Journey; changed: boolean }> {
  checkStages(ctx, stages);
  const keep = new Set(stages.map((s) => s.key));
  const blocking = [...new Set(inFlight(ctx.db, j.id).filter((r) => r.version === j.version && !keep.has(r.stage)).map((r) => r.stage))].sort();
  if (blocking.length) raise(ctx, "validation.precondition_failed", `Records are in ${blocking.join(", ")}. Move them before removing the stage.`, { reason: "stage_in_use", stages: blocking });
  const nextRule = startRule === undefined ? j.startRule : startRule ?? undefined;
  if (same(stages, j.stages) && same(nextRule, j.startRule)) return { j, changed: false };
  j.stages = stages;
  if (nextRule) j.startRule = nextRule; else delete j.startRule;
  j.version += 1;
  j.updatedAt = ctx.now();
  const aid = await syncStartRule(ctx, j);
  if (aid) j.startAutomationId = aid;
  saveJourney(ctx.db, j);
  saveVersion(ctx, j, note);
  emitJ(ctx, "journey.designed", `entity/${j.id}`, { journeyId: j.id, version: j.version, stages: stages.map((s) => s.key), by: me(ctx) });
  return { j, changed: true };
}

export async function design(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== j.version) {
    raise(ctx, "validation.version_conflict", `This Journey is at version ${j.version} now.`, { current: j.version, expected: input.expectedVersion });
  }
  const r = await redesign(ctx, j, input.stages as Stage[], input.startRule as StartRule | null | undefined, input.note);
  return { journey: out(r.j, countInFlight(ctx.db, j.id)), ...(r.j.startAutomationId ? { startAutomationId: r.j.startAutomationId } : {}) };
}

export async function rulesSet(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  if (!j.stages.some((s) => s.key === input.stageKey)) raise(ctx, "validation.not_found", "That stage does not exist.", { reason: "no_such_stage", stage: input.stageKey });
  const stages = j.stages.map((s) => {
    if (s.key !== input.stageKey) return s;
    const n: Stage = { ...s };
    if (input.exit !== undefined) n.exit = input.exit;
    if (input.timeLimit === null) delete n.timeLimit; else if (input.timeLimit !== undefined) n.timeLimit = input.timeLimit;
    return n;
  });
  const r = await redesign(ctx, j, stages, undefined, `Rules of ${input.stageKey}`);
  return { journey: out(r.j, countInFlight(ctx.db, j.id)) };
}

export async function rename(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const name = String(input.name).trim();
  if (!name) raise(ctx, "validation.precondition_failed", "A Journey needs a name.", { reason: "name_required" });
  if (allJourneys(ctx.db).some((x) => x.id !== j.id && x.name.toLowerCase() === name.toLowerCase())) raise(ctx, "validation.duplicate", "A Journey with that name exists.", { reason: "journey_name" });
  if (name !== j.name) {
    j.name = name;
    j.updatedAt = ctx.now();
    saveJourney(ctx.db, j);
    emitJ(ctx, "journey.designed", `entity/${j.id}`, { journeyId: j.id, version: j.version, stages: j.stages.map((s) => s.key), by: me(ctx) });
  }
  return { journey: out(j, countInFlight(ctx.db, j.id)) };
}

export async function remove(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const n = countInFlight(ctx.db, j.id);
  if (n > 0) raise(ctx, "validation.precondition_failed", `${n} record${n === 1 ? " is" : "s are"} still in this Journey. Finish or move them first.`, { reason: "in_flight", records: n });
  if (j.startAutomationId && ctx.call) await ctx.call("automations.set_enabled", { automationId: j.startAutomationId, enabled: false });
  markDeleted(ctx, j.id);
  emitJ(ctx, "journey.deleted", `entity/${j.id}`, { journeyId: j.id, recordType: j.recordType });
  return { deleted: true };
}

// ---- entering and leaving stages ----

type Moved = { record: JRecord; completed: boolean };

/** Make the stage's tasks for a record and run the stage's Automations. Neither blocks the move: a task or Automation that fails to start is reported by its own module. */
async function onEnter(ctx: JourneysCtx, j: Journey, rec: JRecord, stage: Stage, previous: string | undefined, manual: boolean, eventId: string): Promise<void> {
  if (!ctx.call) return;
  for (const t of stage.tasks) {
    try {
      const made = (await ctx.call("tasks.create", clean({
        kind: t.kind ?? "work", title: t.title, summary: t.description, assigned: t.assigned, reviewer: t.reviewer, approver: t.approver, recordId: rec.recordId,
        due: t.dueAfterHours ? ctx.now() + t.dueAfterHours * HOUR : undefined, source: { kind: "journey", id: rec.recordId },
        idempotencyKey: `jrn:${rec.recordId}:${stage.key}:${t.key}:${rec.enteredAt}`,
      }))) as { task?: { id?: string } };
      const taskId = made?.task?.id;
      if (!taskId) continue;
      saveTaskLink(ctx.db, rec.recordId, { stage: stage.key, taskKey: t.key, enteredAt: rec.enteredAt, taskId, required: t.required });
      // a task for an agent keeps the key and the backup key it should use
      if (t.assigned.kind === "agent") {
        if (t.keyId) await ctx.call("tasks.working_notes.set", { taskId, key: "key_id", value: t.keyId });
        if (t.backupKeyId) await ctx.call("tasks.working_notes.set", { taskId, key: "backup_key_id", value: t.backupKeyId });
      }
    } catch { /* the Journey record is in the stage; the missing task shows in the module that failed */ }
  }
  // a stage that makes a project gives the record its own Project (record, channel, folder, plan); once per record, however often it comes back to the stage
  if (stage.makesProject) {
    try {
      await ctx.call("projects.create", { type: "project", title: `${j.name} ${rec.recordId.slice(-6)}`, idempotencyKey: `jrn-project:${rec.recordId}` });
    } catch (e) {
      // the Journey carries on, but never silently: the reason goes to the log with the trace id and to the Journey owner as a task
      const err = (e as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
      const said = err?.message ?? (e instanceof Error ? e.message : "it failed");
      // the refusal's own details name the field or step, so they go with the reason into the log and the task
      const where = err?.details !== undefined ? ` (${err.code ?? "error"}: ${JSON.stringify(err.details).slice(0, 400)})` : "";
      const reason = `${said}${where}`;
      ctx.log?.warn("journeys: the stage's project could not be made", { journeyId: j.id, recordId: rec.recordId, stage: stage.key, reason, traceId: ctx.trace.traceId });
      try {
        await ctx.call("tasks.create", {
          kind: "unblock", title: `Project for ${rec.subjectRecordId} could not be made: ${reason}`, summary: `The ${j.name} Journey moved on without it. Trace ${ctx.trace.traceId}.`,
          assigned: { kind: "person", id: rec.ownerId }, recordId: rec.recordId, source: { kind: "journey", id: rec.recordId }, idempotencyKey: `jrn-project-failed:${rec.recordId}:${stage.key}`,
        });
      } catch { /* the log line above is the record of it */ }
    }
  }
  for (const aid of stage.automations) {
    try {
      await ctx.call("automations.fire", clean({
        automationId: aid, trigger: "journey_stage_entered", eventId, depth: 0, origin: `journey:${j.id}`,
        payload: clean({ journeyId: j.id, recordId: rec.recordId, stage: stage.key, previousStage: previous, manual }), idempotencyKey: `jrn-auto:${rec.recordId}:${stage.key}:${aid}:${rec.enteredAt}`,
      }));
    } catch { /* an Automation that cannot start does not stop the Journey */ }
  }
}

/** Open tasks of the stage being left go away with it. */
async function closeStageTasks(ctx: JourneysCtx, rec: JRecord): Promise<void> {
  if (!ctx.call) return;
  for (const l of taskLinks(ctx.db, rec.recordId, rec.stage, rec.enteredAt)) {
    try {
      const t = (await ctx.call("tasks.get", { taskId: l.taskId })) as { task?: { state?: string } };
      if (t?.task?.state && t.task.state !== "done" && t.task.state !== "canceled") await ctx.call("tasks.withdraw", { taskId: l.taskId, note: "The record moved on." });
    } catch { /* already gone */ }
  }
}

/** Run the Automations the stage lists for leaving it. Like entering, a failure to start one does not stop the move. */
async function onLeave(ctx: JourneysCtx, j: Journey, rec: JRecord, stage: Stage | undefined, to: Stage, manual: boolean, eventId: string): Promise<void> {
  if (!ctx.call || !stage?.onLeaving?.length) return;
  for (const aid of stage.onLeaving) {
    try {
      await ctx.call("automations.fire", clean({
        automationId: aid, trigger: "journey_stage_left", eventId, depth: 0, origin: `journey:${j.id}`,
        payload: clean({ journeyId: j.id, recordId: rec.recordId, stage: stage.key, toStage: to.key }), idempotencyKey: `jrn-leave:${rec.recordId}:${stage.key}:${aid}:${rec.enteredAt}`,
      }));
    } catch { /* an Automation that cannot start does not stop the Journey */ }
  }
}

/** Move a record from its stage to another: leave, write the record, enter, run the stage's tasks and Automations. */
export async function moveTo(ctx: JourneysCtx, j: Journey, rec: JRecord, to: Stage, o: { manual: boolean; reason?: string; stages: readonly Stage[] }): Promise<Moved> {
  const from = rec.stage;
  const now = ctx.now();
  const next: JRecord = { ...rec, stage: to.key, enteredAt: now };
  if (to.final) next.completedAt = now; else delete next.completedAt;
  // the record is written first: if that fails nothing has changed and nothing has been said
  if (ctx.call) await ctx.call("records.update", { type: j.recordType, recordId: rec.recordId, patch: { stage: to.key, entered_at: new Date(now).toISOString() } });
  await closeStageTasks(ctx, rec);
  saveRecord(ctx.db, next);
  const leftId = emitJ(ctx, "journey.stage_exited", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: from, toStage: to.key });
  await onLeave(ctx, j, rec, o.stages.find((s) => s.key === from), to, o.manual, leftId);
  const evId = emitJ(ctx, "journey.stage_entered", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: to.key, previousStage: from, version: next.version, manual: o.manual, reason: o.reason });
  await onEnter(ctx, j, next, to, from, o.manual, evId);
  return { record: next, completed: !!to.final };
}

// ---- start ----

export async function start(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const key = String(input.idempotencyKey);
  const again = findByKey(ctx.db, key);
  if (again) return { recordId: again.recordId, stage: again.startStage };
  if (findBySubject(ctx.db, j.id, input.subjectRecordId)) raise(ctx, "validation.duplicate", "That record is already in this Journey.", { reason: "already_enrolled" });
  const stages = byOrder(j.stages);
  const first = input.startStage ? stages.find((s) => s.key === input.startStage) : stages[0];
  if (!first) raise(ctx, "validation.precondition_failed", `This Journey has no stage called ${input.startStage}.`, { reason: "no_such_stage", stage: input.startStage });
  if (first.final) raise(ctx, "validation.precondition_failed", "A Journey cannot start in its last stage.", { reason: "final_stage" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Records are not available right now.");
  const now = ctx.now();
  const owner = me(ctx);
  const made = (await ctx.call("records.create", {
    type: j.recordType, fields: { name: `${j.name}: ${input.subjectRecordId}`, stage: first.key, subject: [{ urn: `vyre://${ctx.space}/${j.subjectType}/${input.subjectRecordId}` }], owner, entered_at: new Date(now).toISOString() }, idempotencyKey: `jrn-rec:${key}`,
  })) as { record?: { id?: string } };
  const recordId = made?.record?.id;
  if (!recordId) raise(ctx, "internal.unexpected", "The Journey record was not created.");
  let channelId: string | undefined, threadId: string | undefined;
  try {
    const ch = (await ctx.call("channels.create", { name: `${j.name} ${recordId.slice(-6)}`, visibility: "invite", recordId, idempotencyKey: `jrn-ch:${key}` })) as { channel?: { channelId?: string; mainThreadId?: string } };
    channelId = ch?.channel?.channelId; threadId = ch?.channel?.mainThreadId;
  } catch { /* the record works without a channel; handoffs are then not posted */ }
  const rec: JRecord = clean({ recordId, journeyId: j.id, subjectRecordId: input.subjectRecordId, version: j.version, stage: first.key, startStage: first.key, enteredAt: now, ownerId: owner, startKey: key, channelId, threadId, startedAt: now }) as JRecord;
  saveRecord(ctx.db, rec);
  emitJ(ctx, "journey.started", `record/${recordId}`, { journeyId: j.id, recordId, subjectRecordId: input.subjectRecordId, stage: first.key, version: j.version });
  const evId = emitJ(ctx, "journey.stage_entered", `record/${recordId}`, { journeyId: j.id, recordId, stage: first.key, version: j.version, manual: false });
  await onEnter(ctx, j, rec, first, undefined, false, evId);
  return { recordId, stage: first.key };
}

// ---- moving and advancing ----

async function handoff(ctx: JourneysCtx, rec: JRecord, text: string): Promise<void> {
  if (!ctx.call || !rec.threadId) return;
  try { await ctx.call("chat.post", { threadId: rec.threadId, body: text, idempotencyKey: `jrn-post:${rec.recordId}:${ctx.now()}:${text.length}` }); } catch { /* the channel is a convenience */ }
}

export async function moveStage(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const rec = getRecord(ctx, j.id, input.recordId);
  const reason = String(input.reason).trim();
  if (!reason) raise(ctx, "validation.precondition_failed", "Say why the record is moving.", { reason: "reason_required" });
  const stages = stagesOf(ctx.db, j, rec.version) ?? j.stages;
  const to = stages.find((s) => s.key === input.toStage);
  if (!to) raise(ctx, "validation.precondition_failed", `This record's version of the Journey has no stage called ${input.toStage}.`, { reason: "no_such_stage", stage: input.toStage });
  if (to.key === rec.stage) raise(ctx, "validation.precondition_failed", "The record is already in that stage.", { reason: "already_there" });
  const from = rec.stage;
  const moved = await moveTo(ctx, j, rec, to, { manual: true, reason, stages });
  emitJ(ctx, "journey.moved", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, fromStage: from, toStage: to.key, reason, by: me(ctx) });
  if (moved.completed) emitJ(ctx, "journey.completed", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: to.key });
  await handoff(ctx, moved.record, `Moved from ${from} to ${to.key}: ${reason}`);
  return { recordId: rec.recordId, stage: to.key };
}

async function tasksDone(ctx: JourneysCtx, rec: JRecord): Promise<boolean> {
  const required = taskLinks(ctx.db, rec.recordId, rec.stage, rec.enteredAt).filter((l) => l.required);
  if (required.length === 0) return true;
  if (!ctx.call) return false;
  for (const l of required) {
    const t = (await ctx.call("tasks.get", { taskId: l.taskId })) as { task?: { state?: string } };
    if (t?.task?.state !== "done") return false;
  }
  return true;
}

/** Called when a task completes: if the stage's exit rule is met, the record moves to the next stage. Asking again changes nothing. */
export async function advance(ctx: JourneysCtx, input: In): Promise<unknown> {
  const rec = findRecordOrFail(ctx, input.recordId);
  const j = getJourney(ctx, rec.journeyId);
  if (rec.completedAt !== undefined) return { advanced: false, stage: rec.stage };
  const stages = byOrder(stagesOf(ctx.db, j, rec.version) ?? j.stages);
  const here = stages.find((s) => s.key === rec.stage);
  if (!here || here.final || here.exit.manualOnly) return { advanced: false, stage: rec.stage };
  if (here.exit.requireTasks && !(await tasksDone(ctx, rec))) return { advanced: false, stage: rec.stage };
  const to = stages.find((s) => s.order > here.order);
  if (!to) return { advanced: false, stage: rec.stage };
  const moved = await moveTo(ctx, j, rec, to, { manual: false, stages });
  if (moved.completed) emitJ(ctx, "journey.completed", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: to.key });
  return { advanced: true, stage: to.key };
}
function findRecordOrFail(ctx: JourneysCtx, recordId: string): JRecord {
  const r = (ctx.db.all("SELECT journey_id FROM journeys_records WHERE record_id = ?", recordId) as { journey_id: string }[])[0];
  if (!r) raise(ctx, "permission.not_found", "That Journey record is not available.");
  return getRecord(ctx, r.journey_id, recordId);
}

// ---- counts and limits ----

export async function stageCounts(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const now = ctx.now();
  const rows = inFlight(ctx.db, j.id);
  const counts = new Map<string, { count: number; overLimit: number }>();
  const touch = (k: string): { count: number; overLimit: number } => { let c = counts.get(k); if (!c) { c = { count: 0, overLimit: 0 }; counts.set(k, c); } return c; };
  for (const s of byOrder(j.stages)) touch(s.key);
  for (const r of rows) {
    const c = touch(r.stage);
    c.count += 1;
    const lim = (stagesOf(ctx.db, j, r.version) ?? j.stages).find((s) => s.key === r.stage)?.timeLimit;
    if (lim && now - r.enteredAt >= lim.hours * HOUR) c.overLimit += 1;
  }
  return { stages: [...counts.entries()].map(([stage, c]) => ({ stage, count: c.count, overLimit: c.overLimit })) };
}

async function raiseLimitTask(ctx: JourneysCtx, rec: JRecord, stage: string, who: { kind: string; id: string }, hours: number, escalation: boolean): Promise<void> {
  if (!ctx.call) return;
  try {
    await ctx.call("tasks.create", {
      kind: "unblock", title: `${escalation ? "Escalated: " : ""}${rec.recordId} has been in ${stage} for over ${hours} hours`, assigned: who, recordId: rec.recordId,
      source: { kind: "journey", id: rec.recordId }, idempotencyKey: `jrn-limit:${rec.recordId}:${stage}:${rec.enteredAt}:${escalation ? "esc" : "owner"}`,
    });
  } catch { /* the breach event is the record of it */ }
}

/** The scheduler calls this: a stay that went over its stage's limit reaches the owner's Needs you; when the same time has passed again, the escalation role. Each only once. */
export async function checkLimits(ctx: JourneysCtx): Promise<unknown> {
  const now = ctx.now();
  let breached = 0;
  for (const rec of inFlight(ctx.db)) {
    const j = findJourney(ctx.db, rec.journeyId);
    if (!j) continue;
    const stage = (stagesOf(ctx.db, j, rec.version) ?? j.stages).find((s) => s.key === rec.stage);
    const lim = stage?.timeLimit;
    if (!lim) continue;
    const over = now - rec.enteredAt;
    if (over < lim.hours * HOUR) continue;
    const seen = breachOf(ctx.db, rec.recordId, rec.stage, rec.enteredAt);
    if (!seen) {
      saveBreach(ctx.db, rec.recordId, rec.stage, rec.enteredAt, false);
      emitJ(ctx, "journey.time_limit_breached", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: rec.stage, limitHours: lim.hours, escalated: false });
      await raiseLimitTask(ctx, rec, rec.stage, { kind: "person", id: rec.ownerId }, lim.hours, false);
      breached += 1;
    } else if (!seen.escalated && lim.escalateTo && over >= 2 * lim.hours * HOUR) {
      saveBreach(ctx.db, rec.recordId, rec.stage, rec.enteredAt, true);
      emitJ(ctx, "journey.time_limit_breached", `record/${rec.recordId}`, { journeyId: j.id, recordId: rec.recordId, stage: rec.stage, limitHours: lim.hours, escalated: true });
      await raiseLimitTask(ctx, rec, rec.stage, lim.escalateTo, lim.hours, true);
      breached += 1;
    }
  }
  return { breached };
}

// ---- the tasks of one record, with their state

/** The state the designer shows for a task: todo (todo, doing), in review (in review, awaiting approval), blocked, done. A withdrawn (canceled) task is not listed. */
function journeyTaskState(t: { state?: string; blocked?: boolean }): "todo" | "in_review" | "blocked" | "done" | undefined {
  if (t.state === "canceled") return undefined;
  if (t.state === "done") return "done";
  if (t.blocked === true) return "blocked";
  return t.state === "in_review" || t.state === "awaiting_approval" ? "in_review" : "todo";
}

export async function tasksOf(ctx: JourneysCtx, input: In): Promise<unknown> {
  const recordId = String(input.recordId);
  const rec = findRecord(ctx.db, recordId);
  if (!rec) raise(ctx, "validation.not_found", "That record is not in a Journey.", { reason: "not_in_journey" });
  const stage = input.stage === undefined ? undefined : String(input.stage);
  const out: Record<string, unknown>[] = [];
  for (const l of allTaskLinks(ctx.db, recordId, stage)) {
    if (!ctx.call) break;
    try {
      const t = ((await ctx.call("tasks.get", { taskId: l.taskId })) as { task?: { title?: string; state?: string; blocked?: boolean; assigned?: unknown } }).task;
      const state = t ? journeyTaskState(t) : undefined;
      if (!t || !state) continue;
      out.push(clean({ stage: l.stage, taskKey: l.taskKey, taskId: l.taskId, title: t.title ?? l.taskKey, state, required: l.required, assigned: t.assigned }));
    } catch { /* a task that cannot be read is not listed */ }
  }
  return { tasks: out };
}
