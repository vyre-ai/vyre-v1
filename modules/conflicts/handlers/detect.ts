// Detect and route (ARCH 5.5 steps 1 to 4; spec 4.11). sync.push parks a collision with openConflict and the conflict.opened event reaches onConflictOpened, which decides who looks first:
//   same meaning once spacing is ignored   not a conflict: resolved at once, no assistant, no task
//   Restricted field (plainChoice)         an Answer task with a plain two-value choice; no provider call
//   anything else                          the person's assistant compares both sides and proposes
//   protected field after the proposal     an Answer task (Needs you) for confirmation; the value is not applied until confirmed
// conflicts.log_binary keeps two saves of a binary file: the newest stays current, the other is a labelled version with a Conflicts row.
import type { ConflictOpen, HistoryEntry } from "../../../sync/src/server/push/types.ts";
import { actorOf, ensure, findByOp, loadConflict, mintId, portsNow, raise, sameMeaning, toJson } from "../projections.ts";
import type { CfCtx, Conflict, Proposal } from "../projections.ts";
import { applyResolution, authorizeEdit, owned, withPerson } from "./resolve.ts";

/** The error code the Conflicts tab and the assistant both see for a Restricted field headed for a provider. */
const PROVIDER_LABEL = "permission.provider_label" as const;

// ---- parking (called by sync.push through its openConflict dependency)

/** Park a collision. Idempotent per (opId, field): a retried op gets the same id. The person is the one whose edit was parked. */
export function openConflict(ctx: CfCtx, c: ConflictOpen): string {
  ensure(ctx.db);
  const again = findByOp(ctx.db, c.opId, c.field);
  if (again) return again.conflictId;
  const now = ctx.now();
  const id = mintId("cfl", now);
  const person = c.theirsActor;
  const same = sameMeaning(c.ours, c.theirs);
  const state = same ? "resolved" : c.plainChoice ? "needs_you" : "open";
  const protectedField = c.plainChoice ? false : portsNow().isProtected(c.entity, c.field);
  ctx.db.run(
    'INSERT INTO conflicts_conflict (id, entity, recordId, field, ours, theirs, base, state, plainChoice, summary, openedAt, person, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
    id, c.entity, c.id, c.field, toJson(c.ours), toJson(c.theirs), toJson(c.base), state, c.plainChoice ? 1 : 0, same ? "Both edits said the same thing." : null, now, person, now,
  );
  ctx.db.run(
    "INSERT INTO conflicts_detail (conflict_id, op_id, field, kind, protected, ours_actor, theirs_actor, device_id, trace_id, base_seq) VALUES (?, ?, ?, 'field', ?, ?, ?, ?, ?, ?)",
    id, c.opId, c.field, protectedField ? 1 : 0, c.oursActor, c.theirsActor, c.deviceId, c.traceId, c.base,
  );
  if (same) {
    // Nothing to choose: record it so the Conflicts tab shows the edits matched, and move on.
    const res = mintId("res", now);
    ctx.db.run(
      "INSERT INTO conflicts_resolution (resolution_id, conflict_id, choice, summary, by_actor, at, prev_value, new_value, applied, state) VALUES (?, ?, 'ours', ?, 'system', ?, ?, ?, 0, 'active')",
      res, id, "Both edits said the same thing.", now, toJson(c.ours), toJson(c.ours),
    );
    ctx.emit("conflict.resolved", id, { conflictId: id, resolutionId: res, choice: "ours", by: "system", summary: "Both edits said the same thing." });
  }
  return id;
}

/** Keep a value that lost a merge. Idempotent per (entity, record, field, hlc, actor). */
export function recordHistory(ctx: CfCtx, h: HistoryEntry): void {
  ensure(ctx.db);
  ctx.db.run(
    "INSERT OR IGNORE INTO conflicts_history (entity, record_id, field, hlc, actor, value, seq, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    h.entity, h.id, h.field, h.hlc, h.actor, toJson(h.value), h.seq, h.reason, ctx.now(),
  );
}

// ---- tasks

/** The Answer task in Needs you. It carries ids only, never values: the card reads the conflict through conflicts.get, which checks access. */
export async function openAnswerTask(ctx: CfCtx, c: Conflict, plain: boolean): Promise<string> {
  if (c.taskId) return c.taskId;
  const out = (await ctx.call("tasks.create", {
    idempotencyKey: `conflict:${c.conflictId}:answer-task`,
    kind: "answer",
    title: plain ? `Pick the value for ${c.field}` : `Confirm the change to ${c.field}`,
    summary: plain
      ? "Two edits collided on a Restricted field. Pick one; nothing is sent to an AI provider."
      : "Your assistant compared both edits and proposed a choice. Nothing changes until you confirm.",
    blocks: [{ type: "conflict_choice", data: { conflictId: c.conflictId, entity: c.entity, field: c.field, plainChoice: plain } }],
    assigned: { kind: "person", id: c.person },
    // the choices are in the conflict_choice block and are made through conflicts.resolve, which closes the card; an answer task keeps its own actions (answer, dismiss)
    source: { kind: "manual", id: c.conflictId },
  })) as { task?: { id?: string } } | null;
  const taskId = out?.task?.id;
  if (!taskId) raise(ctx, "internal.unexpected", "The task for this conflict was not created.");
  ctx.db.run("UPDATE conflicts_detail SET task_id = ? WHERE conflict_id = ?", taskId, c.conflictId);
  return taskId;
}

function setState(ctx: CfCtx, id: string, state: string): void {
  ctx.db.run('UPDATE conflicts_conflict SET state = ?, updated_at = ?, version = version + 1 WHERE id = ?', state, ctx.now(), id);
}

async function needsYou(ctx: CfCtx, c: Conflict): Promise<void> {
  const taskId = await openAnswerTask(ctx, c, c.plainChoice);
  setState(ctx, c.conflictId, "needs_you");
  ctx.emit("conflict.confirmation_needed", c.conflictId, { conflictId: c.conflictId, taskId, plainChoice: c.plainChoice });
}

// ---- the consumer of conflict.opened

/** Route one parked conflict. A conflict already past `open` is left alone, so a replayed event does nothing twice. */
export async function onConflictOpened(ctx: CfCtx, ev: { conflictId: string }): Promise<{ route: "skipped" | "plain" | "assistant" | "needs_you" }> {
  ensure(ctx.db);
  const c = loadConflict(ctx.db, ev.conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { conflictId: ev.conflictId });
  if (c.state !== "open" && !(c.state === "needs_you" && c.plainChoice && !c.taskId)) return { route: "skipped" };
  if (c.plainChoice) {
    await needsYou(ctx, c);
    return { route: "plain" };
  }
  const as = withPerson(ctx, c.person);
  try {
    await runAssistant(as, c);
    return { route: "assistant" };
  } catch (e) {
    // The assistant could not be asked (no key, provider down): the person decides, so the change is never lost or silently dropped.
    ctx.log.warn("conflict assist failed; asking the person", { conflictId: c.conflictId, error: e instanceof Error ? e.message : String(e) });
    await needsYou(ctx, loadConflict(ctx.db, c.conflictId) ?? c);
    return { route: "needs_you" };
  }
}

// ---- assist and propose

async function runAssistant(ctx: CfCtx, c: Conflict): Promise<{ runId: string }> {
  const started = (await ctx.call("runs.start", { idempotencyKey: `conflict:${c.conflictId}:assist-run`, kind: "other", name: "conflict_assist", owner: c.person })) as { runId?: string } | null;
  const runId = started?.runId;
  if (!runId) raise(ctx, "internal.unexpected", "The assistant run was not started.");
  ctx.db.run("UPDATE conflicts_detail SET run_id = ? WHERE conflict_id = ?", runId, c.conflictId);
  try {
    const proposal = await portsNow().assistant(ctx, {
      conflictId: c.conflictId, entity: c.entity, recordId: c.recordId, field: c.field, ours: c.ours, theirs: c.theirs, base: c.base, person: c.person,
    });
    await storeProposal(ctx, loadConflict(ctx.db, c.conflictId) ?? c, proposal);
    await ctx.call("runs.finish", { runId, status: "succeeded", summary: proposal.summary });
  } catch (e) {
    await ctx.call("runs.finish", { runId, status: "failed", error: { code: "conflict.assist_failed", message: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
    throw e;
  }
  return { runId };
}

/** conflicts.assist: start the assistant for one conflict. Never for a Restricted field. */
export async function assist(ctx: CfCtx, input: { conflictId: string }): Promise<{ runId: string }> {
  ensure(ctx.db);
  const c = loadConflict(ctx.db, input.conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { conflictId: input.conflictId });
  owned(ctx, c);
  if (c.plainChoice) raise(ctx, PROVIDER_LABEL, "This field is Restricted, so it is never sent to an AI provider. Pick one of the two values yourself.", { conflictId: c.conflictId });
  if (c.state !== "open" && c.state !== "proposed") raise(ctx, "validation.precondition_failed", "This conflict is already settled or waiting for you.", { state: c.state });
  authorizeEdit(ctx, c);
  return runAssistant(withPerson(ctx, c.person), c);
}

/** Record the proposal; resolve a plain field at once, hold a protected field for the person. */
async function storeProposal(ctx: CfCtx, c: Conflict, p: Proposal): Promise<{ state: "proposed" | "needs_you" | "resolved" }> {
  if (c.plainChoice) raise(ctx, PROVIDER_LABEL, "A Restricted field gets no proposal.", { conflictId: c.conflictId });
  if (c.state !== "open" && c.state !== "proposed") raise(ctx, "validation.precondition_failed", "This conflict is already settled or waiting for you.", { state: c.state });
  if ((p.choice === "merged" || p.choice === "custom") && p.value === undefined) raise(ctx, "validation.bad_input", "A merged or custom choice needs the value.", { choice: p.choice });
  const value = p.choice === "ours" ? c.ours : p.choice === "theirs" ? c.theirs : p.value;
  ctx.db.run("UPDATE conflicts_detail SET proposal = ? WHERE conflict_id = ?", toJson({ choice: p.choice, value, summary: p.summary }), c.conflictId);
  setState(ctx, c.conflictId, "proposed");
  ctx.emit("conflict.proposed", c.conflictId, { conflictId: c.conflictId, choice: p.choice, protectedField: c.protectedField });
  const fresh = loadConflict(ctx.db, c.conflictId) ?? c;
  if (c.protectedField) {
    await needsYou(ctx, fresh);
    return { state: "needs_you" };
  }
  try {
    const r = await applyResolution(ctx, fresh, { choice: p.choice, value, summary: p.summary, by: ctx.principal.kind === "agent" ? ctx.principal.id : "assistant" });
    return { state: r.state };
  } catch (e) {
    // Assistant resolutions cover only fields the person can edit; if the write is refused the person sees the proposal instead.
    ctx.log.warn("assistant resolution not applied; asking the person", { conflictId: c.conflictId, error: e instanceof Error ? e.message : String(e) });
    await needsYou(ctx, loadConflict(ctx.db, c.conflictId) ?? fresh);
    return { state: "needs_you" };
  }
}

/** conflicts.propose: store the assistant's proposal. */
export async function propose(ctx: CfCtx, input: { conflictId: string; choice: Proposal["choice"]; value?: unknown; summary: string }): Promise<{ state: string }> {
  ensure(ctx.db);
  const c = loadConflict(ctx.db, input.conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { conflictId: input.conflictId });
  owned(ctx, c);
  const p: Proposal = { choice: input.choice, summary: input.summary, ...(input.value !== undefined ? { value: input.value } : {}) };
  return storeProposal(withPerson(ctx, c.person), c, p);
}

// ---- binary files

/** conflicts.log_binary: the newest save stays current, the other is a labelled version, and the Conflicts tab gets a row. Idempotent per pair of versions. */
export function logBinary(ctx: CfCtx, input: { fileId: string; currentVersionId: string; otherVersionId: string; label: string }): { conflictId: string } {
  ensure(ctx.db);
  const opId = `binary:${input.fileId}:${input.currentVersionId}:${input.otherVersionId}`;
  const again = findByOp(ctx.db, opId, "content");
  if (again) return { conflictId: again.conflictId };
  authorizeEdit(ctx, { entity: "file", recordId: input.fileId }, { type: "file", id: input.fileId }, "files.write");
  const now = ctx.now();
  const person = actorOf(ctx);
  const id = mintId("cfl", now);
  const res = mintId("res", now);
  const summary = `Kept the newest save. The other save is kept as "${input.label}".`;
  ctx.db.run(
    'INSERT INTO conflicts_conflict (id, entity, recordId, field, ours, theirs, base, state, plainChoice, summary, openedAt, person, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)',
    id, "file", input.fileId, "content", toJson(input.currentVersionId), toJson(input.otherVersionId), toJson(null), "resolved", summary, now, person, now,
  );
  ctx.db.run(
    "INSERT INTO conflicts_detail (conflict_id, op_id, field, kind, protected, ours_actor, theirs_actor, device_id, trace_id, base_seq) VALUES (?, ?, 'content', 'binary', 0, NULL, ?, NULL, ?, NULL)",
    id, opId, person, ctx.trace.traceId,
  );
  ctx.db.run(
    "INSERT INTO conflicts_resolution (resolution_id, conflict_id, choice, summary, by_actor, at, prev_value, new_value, applied, state) VALUES (?, ?, 'ours', ?, 'system', ?, ?, ?, 0, 'active')",
    res, id, summary, now, toJson(input.otherVersionId), toJson(input.currentVersionId),
  );
  ctx.emit("conflict.binary_logged", id, { conflictId: id, fileId: input.fileId, versionId: input.otherVersionId });
  return { conflictId: id };
}

