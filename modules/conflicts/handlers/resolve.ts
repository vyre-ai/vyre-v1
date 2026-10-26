// Resolve, confirm, Undo and Redo (ARCH 5.5 steps 1, 2 and 5; spec 4.11). A resolution writes the chosen value as the person through the normal write path, keeps what it replaced,
// and says so in one line. Undo puts the replaced value back as a normal op, and Redo restores the choice. Both refuse when the field moved on since, so nobody's later edit is overwritten.
import { actorOf, canonical, ensure, latestResolution, loadConflict, mintId, portsNow, raise, resolutionById, toJson } from "../projections.ts";
import type { CfCtx, Choice, Conflict, Resolution, Target } from "../projections.ts";

/** The same ctx, acting for one person: an assistant or a consumer resolves as the person whose edit was parked. */
export function withPerson(ctx: CfCtx, person: string): CfCtx {
  return { ...ctx, actingFor: person };
}

/** A conflict is its person's. Anyone else gets "not found" so the Conflicts tab never leaks that it exists. */
export function owned(ctx: CfCtx, c: Pick<Conflict, "person" | "conflictId">): void {
  if (c.person !== actorOf(ctx)) raise(ctx, "permission.not_found", "That conflict does not exist.", { conflictId: c.conflictId });
}

/** The caller must be able to edit what the choice writes (the assistant covers only fields the person can edit). */
export function authorizeEdit(ctx: CfCtx, t: Pick<Target, "entity" | "recordId">, resource?: { type: string; id: string }, perm?: string | null): void {
  const res = resource ?? portsNow().resource(t.entity, t.recordId);
  const d = ctx.authorize({ perm: perm !== undefined ? perm : res.type === "record" ? "records.edit" : null, level: "edit" }, res);
  if (d.effect === "deny") raise(ctx, "permission.no_grant", "You cannot edit this, so it cannot be resolved here.", { entity: t.entity });
  if (d.effect === "hold") raise(ctx, "permission.on_hold", "A hold blocks this change.", { entity: t.entity });
}

/** An undone conflict can be resolved again with a different choice; only a resolved one is settled. */
const SETTLED: ReadonlySet<string> = new Set(["resolved"]);

function valueOf(ctx: CfCtx, c: Conflict, choice: Choice, value: unknown): unknown {
  if (choice === "ours") return c.ours;
  if (choice === "theirs") return c.theirs;
  if (value === undefined) raise(ctx, "validation.bad_input", "A merged or custom choice needs the value to keep.", { choice });
  return value;
}

export interface ResolveArgs { choice: Choice; value?: unknown; summary: string; by: string }

/** Apply a choice. The one place a resolution is written, so resolve, confirm and the assistant all behave the same. */
export async function applyResolution(ctx: CfCtx, c: Conflict, a: ResolveArgs): Promise<{ resolutionId: string; state: "resolved" }> {
  if (SETTLED.has(c.state)) raise(ctx, "validation.precondition_failed", "This conflict is already resolved.", { state: c.state });
  if (c.plainChoice && a.choice !== "ours" && a.choice !== "theirs") {
    raise(ctx, "validation.bad_input", "A Restricted field takes one of the two values as they are.", { choice: a.choice });
  }
  const value = valueOf(ctx, c, a.choice, a.value);
  const person = c.person;
  const t: Target = { entity: c.entity, recordId: c.recordId, field: c.field };
  authorizeEdit(ctx, t);
  const prev = await portsNow().current(ctx, t);
  let applied = 0;
  if (canonical(prev) !== canonical(value)) {
    await portsNow().apply(ctx, { ...t, value, person });
    applied = 1;
  }
  const now = ctx.now();
  const resolutionId = mintId("res", now);
  ctx.db.run(
    "INSERT INTO conflicts_resolution (resolution_id, conflict_id, choice, summary, by_actor, at, prev_value, new_value, applied, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
    resolutionId, c.conflictId, a.choice, a.summary, a.by, now, toJson(prev), toJson(value), applied,
  );
  // The value that did not win stays in the field's history, whichever side it came from.
  const loser = canonical(value) === canonical(c.theirs) ? c.ours : c.theirs;
  if (canonical(loser) !== canonical(value)) {
    ctx.db.run(
      "INSERT OR IGNORE INTO conflicts_history (entity, record_id, field, hlc, actor, value, seq, reason, at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'superseded', ?)",
      c.entity, c.recordId, c.field, `${resolutionId}:loser`, canonical(loser) === canonical(c.theirs) ? c.theirsActor : c.oursActor, toJson(loser), now,
    );
  }
  if (applied === 1) {
    ctx.db.run(
      "INSERT OR IGNORE INTO conflicts_history (entity, record_id, field, hlc, actor, value, seq, reason, at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'resolved', ?)",
      c.entity, c.recordId, c.field, `${resolutionId}:prev`, a.by, toJson(prev), now,
    );
  }
  ctx.db.run('UPDATE conflicts_conflict SET state = ?, summary = ?, updated_at = ?, version = version + 1 WHERE id = ?', "resolved", a.summary, now, c.conflictId);
  ctx.emit("conflict.resolved", c.conflictId, { conflictId: c.conflictId, resolutionId, choice: a.choice, by: a.by, summary: a.summary });
  await closeTask(ctx, c, a.summary);
  return { resolutionId, state: "resolved" };
}

async function closeTask(ctx: CfCtx, c: Conflict, note: string): Promise<void> {
  if (!c.taskId) return;
  try {
    await ctx.call("tasks.transition", { taskId: c.taskId, to: "done", note });
  } catch (e) {
    // The conflict is resolved either way; a task that cannot be closed (already done, or closed by the person's own action) must not undo that.
    ctx.log.warn("conflict task not closed", { conflictId: c.conflictId, taskId: c.taskId, error: e instanceof Error ? e.message : String(e) });
  }
}

function must(ctx: CfCtx, conflictId: string): Conflict {
  ensure(ctx.db);
  const c = loadConflict(ctx.db, conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { conflictId });
  owned(ctx, c);
  return c;
}

/** Who gets the credit: an agent acting for the person signs as itself, a person as themselves. */
const byOf = (ctx: CfCtx): string => (ctx.principal.kind === "agent" ? ctx.principal.id : actorOf(ctx));

/** conflicts.resolve */
export async function resolve(ctx: CfCtx, input: { conflictId: string; choice: Choice; value?: unknown; summary: string }): Promise<{ resolutionId: string; state: string }> {
  const c = must(ctx, input.conflictId);
  return applyResolution(ctx, c, { choice: input.choice, summary: input.summary, by: byOf(ctx), ...(input.value !== undefined ? { value: input.value } : {}) });
}

/** conflicts.confirm: the person agrees with what the assistant proposed on a protected field. */
export async function confirm(ctx: CfCtx, input: { conflictId: string }): Promise<{ resolutionId: string; state: string }> {
  const c = must(ctx, input.conflictId);
  if (c.state !== "needs_you" || !c.proposal) raise(ctx, "validation.precondition_failed", "There is no proposal waiting for you to confirm.", { state: c.state });
  return applyResolution(ctx, c, { choice: c.proposal.choice, value: c.proposal.value, summary: c.proposal.summary, by: actorOf(ctx) });
}

async function guarded(ctx: CfCtx, c: Conflict, r: Resolution, expect: unknown, want: "undo" | "redo"): Promise<Target> {
  if (c.kind !== "field") raise(ctx, "validation.precondition_failed", "A binary file conflict keeps both saves; restore the one you want from the file's history.", { conflictId: c.conflictId });
  const latest = latestResolution(ctx.db, c.conflictId);
  if (!latest || latest.resolutionId !== r.resolutionId) raise(ctx, "validation.precondition_failed", "A newer choice replaced this one.", { resolutionId: r.resolutionId });
  if (want === "undo" ? r.state !== "active" : r.state !== "undone") {
    raise(ctx, "validation.precondition_failed", want === "undo" ? "This choice was already undone." : "This choice has not been undone.", { resolutionId: r.resolutionId });
  }
  const t: Target = { entity: c.entity, recordId: c.recordId, field: c.field };
  authorizeEdit(ctx, t);
  const now = await portsNow().current(ctx, t);
  if (canonical(now) !== canonical(expect)) {
    raise(ctx, "validation.precondition_failed", `${c.field} changed after this was resolved. Edit it directly instead.`, { conflictId: c.conflictId });
  }
  return t;
}

function mustRes(ctx: CfCtx, resolutionId: string): { c: Conflict; r: Resolution } {
  ensure(ctx.db);
  const r = resolutionById(ctx.db, resolutionId);
  if (!r) raise(ctx, "validation.not_found", "That resolution does not exist.", { resolutionId });
  const c = loadConflict(ctx.db, r.conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { resolutionId });
  owned(ctx, c);
  return { c, r };
}

/** conflicts.undo: put the replaced value back as a normal op. */
export async function undo(ctx: CfCtx, input: { resolutionId: string }): Promise<{ state: string }> {
  const { c, r } = mustRes(ctx, input.resolutionId);
  const t = await guarded(ctx, c, r, r.value, "undo");
  if (canonical(r.prev) !== canonical(r.value)) await portsNow().apply(ctx, { ...t, value: r.prev, person: c.person });
  const now = ctx.now();
  ctx.db.run("UPDATE conflicts_resolution SET state = 'undone' WHERE resolution_id = ?", r.resolutionId);
  ctx.db.run('UPDATE conflicts_conflict SET state = ?, updated_at = ?, version = version + 1 WHERE id = ?', "undone", now, c.conflictId);
  ctx.emit("conflict.undone", c.conflictId, { conflictId: c.conflictId, resolutionId: r.resolutionId });
  return { state: "undone" };
}

/** conflicts.redo: restore the undone choice. */
export async function redo(ctx: CfCtx, input: { resolutionId: string }): Promise<{ state: string }> {
  const { c, r } = mustRes(ctx, input.resolutionId);
  const t = await guarded(ctx, c, r, r.prev, "redo");
  if (canonical(r.prev) !== canonical(r.value)) await portsNow().apply(ctx, { ...t, value: r.value, person: c.person });
  const now = ctx.now();
  ctx.db.run("UPDATE conflicts_resolution SET state = 'active' WHERE resolution_id = ?", r.resolutionId);
  ctx.db.run('UPDATE conflicts_conflict SET state = ?, updated_at = ?, version = version + 1 WHERE id = ?', "resolved", now, c.conflictId);
  ctx.emit("conflict.redone", c.conflictId, { conflictId: c.conflictId, resolutionId: r.resolutionId });
  return { state: "resolved" };
}

