// What happens to a hold after it is parked (ARCH 4.6): release (approve), deny, expire (timeout escalation or drop), and the sweep that applies due timeouts.
// Approving goes through tasks.act, which mints a sealed approval token bound to this task, this hold, its decision id and payload hash, the approver and the device, valid 10 minutes.
// gate.release opens that token with ctx.seal, checks every claim against the hold, then re-invokes the parked call as its original caller with the token (the host lets exactly this payload through).
// Held -> sending is one guarded UPDATE, so two taps send once. A failed send goes back to held with its error: the person approved it and may try again.
import { actOf, cut, getHold, holdsWhere, raise, saveHold, sha } from "../projections.ts";
import type { Assignee, GateCtx, Hold } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the approval token (format owned by module tasks, handlers/act.ts) ----

interface Claims { v: 1; task: string; hold: string | null; decision: string | null; hash: string | null; by: string; forPerson: string | null; device: string | null; exp: number }
const unb64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

function readToken(ctx: GateCtx, token: string): Claims | null {
  if (!ctx.seal || !token.startsWith("apv_")) return null;
  try {
    const sealed = JSON.parse(unb64url(token.slice(4))) as { keyId: string; nonce: string; bytes: string };
    const c = JSON.parse(new TextDecoder().decode(ctx.seal.unseal(sealed))) as Claims;
    return c && c.v === 1 && typeof c.task === "string" && typeof c.exp === "number" && typeof c.by === "string" ? c : null;
  } catch { return null; }
}

// ---- shared steps ----

/** Cancel the timers of a hold (best effort: a timer that fires late finds the hold decided and does nothing). */
async function cancelSchedules(ctx: GateCtx, h: Hold): Promise<void> {
  if (!ctx.call) return;
  for (const id of [h.expireSchedule, h.backstopSchedule]) {
    if (!id) continue;
    try { await ctx.call("scheduler.cancel", { scheduleId: id }); } catch { /* already fired or gone */ }
  }
  delete h.expireSchedule; delete h.backstopSchedule;
}

/** Tell the waiting Run the hold is settled (best effort: the Run reads the Gate event either way). */
async function resumeRun(ctx: GateCtx, h: Hold): Promise<void> {
  if (!h.runId || !ctx.call) return;
  try { await ctx.call("runs.resume", { runId: h.runId, reason: "approval" }); } catch { /* the Run may have been stopped */ }
}

function settle(ctx: GateCtx, h: Hold, state: "approved" | "denied" | "expired", by: string): void {
  h.state = state;
  h.decidedAt = ctx.now();
  h.decidedBy = by;
  delete h.sendingAt;
  saveHold(ctx.db, h);
}

const payloadOf = (h: Hold, extra: Record<string, unknown>): Record<string, unknown> => ({ holdId: h.id, act: h.act, taskId: h.taskId, ...extra });
const emitGate = (ctx: GateCtx, name: string, h: Hold, extra: Record<string, unknown>): void => {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payloadOf(h, extra))) if (v !== undefined) clean[k] = v;
  ctx.emit(name, `task/${h.taskId}`, clean, { vis: "participants" });
};

// ---- gate.release ----

export async function release(ctx: GateCtx, input: In): Promise<unknown> {
  const h = getHold(ctx, input.holdId);
  if (h.taskId !== input.taskId) raise(ctx, "validation.precondition_failed", "That hold belongs to another task.", { reason: "task_mismatch" });
  if (h.state !== "held") raise(ctx, "validation.precondition_failed", `This hold is ${h.state} already.`, { reason: "not_held", state: h.state });
  if (h.sendingAt !== undefined) raise(ctx, "validation.precondition_failed", "This is being sent right now.", { reason: "sending" });
  const token = String(input.approvalToken ?? "");
  const claims = readToken(ctx, token);
  if (!claims) raise(ctx, "validation.precondition_failed", "That approval is not valid.", { reason: "bad_token" });
  if (claims.exp < ctx.now()) raise(ctx, "permission.expired", "The approval expired. Approve again.", { expiredAt: claims.exp });
  if (claims.task !== h.taskId || claims.hold !== h.id || claims.decision !== h.decisionId || claims.hash !== h.payloadHash) {
    raise(ctx, "validation.precondition_failed", "That approval is for something else.", { reason: "token_mismatch" });
  }
  if (claims.by !== ctx.principal.id) raise(ctx, "validation.precondition_failed", "That approval was given by someone else.", { reason: "token_mismatch" });
  if (claims.device !== null && claims.device !== ctx.device) raise(ctx, "validation.precondition_failed", "Approve from the device you started on.", { reason: "device_mismatch" });
  if (ctx.principal.kind !== "person" && h.rule.peopleOnly) raise(ctx, "validation.precondition_failed", "Only a person can approve this.", { reason: "people_only" });
  if (h.principal.kind === "person" && h.principal.id === claims.by && h.rule.approvers !== "asker") {
    raise(ctx, "validation.precondition_failed", "Someone else has to approve what you asked for.", { reason: "self_approval" });
  }
  if ((await sha(h.input)) !== h.inputHash) raise(ctx, "internal.unexpected", "The held act changed after it was parked.", { reason: "tampered" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Approvals are not available right now.", { service: "call" });

  // held -> sending, once
  const at = ctx.now();
  const won = ctx.db.run("UPDATE gate_holds SET sending_at = ?, error = NULL WHERE id = ? AND state = 'held' AND sending_at IS NULL", at, h.id).changes === 1;
  if (!won) raise(ctx, "validation.precondition_failed", "This is being sent right now.", { reason: "sending" });
  let result: unknown;
  try {
    result = await ctx.call(h.capName, h.input, {
      approvalToken: token, idempotencyKey: h.id, onBehalfOf: h.principal.id,
    });
  } catch (e) {
    const msg = cut(String((e as { error?: { message?: string }; message?: string })?.error?.message ?? (e as Error)?.message ?? "The send failed."), 200);
    ctx.db.run("UPDATE gate_holds SET sending_at = NULL, error = ? WHERE id = ?", msg, h.id);
    throw e;
  }
  delete h.error;
  settle(ctx, h, "approved", claims.by);
  await cancelSchedules(ctx, h);
  saveHold(ctx.db, h);
  emitGate(ctx, "gate.approved", h, { by: claims.by, forPerson: claims.forPerson ?? undefined });
  await resumeRun(ctx, h);
  return { result: result ?? null };
}

// ---- gate.deny ----

export async function deny(ctx: GateCtx, input: In): Promise<unknown> {
  const h = getHold(ctx, input.holdId);
  if (h.taskId !== input.taskId) raise(ctx, "validation.precondition_failed", "That hold belongs to another task.", { reason: "task_mismatch" });
  if (h.state !== "held") raise(ctx, "validation.precondition_failed", `This hold is ${h.state} already.`, { reason: "not_held", state: h.state });
  if (h.sendingAt !== undefined) raise(ctx, "validation.precondition_failed", "This is being sent right now.", { reason: "sending" });
  const mode = input.mode === "drop" ? "drop" : "send_back";
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined;
  settle(ctx, h, "denied", ctx.principal.id);
  await cancelSchedules(ctx, h);
  saveHold(ctx.db, h);
  // a send-back keeps the task for the requester's thread (tasks.act moves it); a drop closes it
  if (mode === "drop" && ctx.call) await ctx.call("tasks.withdraw", { taskId: h.taskId, note: note ?? "Dropped." });
  emitGate(ctx, "gate.denied", h, { by: ctx.principal.id, mode, note });
  await resumeRun(ctx, h);
  return { ok: true };
}

/** A hold closed by the system, for example when its requester left: the call is dropped and never sent. Used by rejectAllOf. */
export async function dropHold(ctx: GateCtx, h: Hold, note: string): Promise<void> {
  settle(ctx, h, "denied", ctx.principal.id);
  await cancelSchedules(ctx, h);
  saveHold(ctx.db, h);
  if (ctx.call) { try { await ctx.call("tasks.withdraw", { taskId: h.taskId, note }); } catch { /* the task may be gone already */ } }
  emitGate(ctx, "gate.denied", h, { by: ctx.principal.id, mode: "drop", note });
  await resumeRun(ctx, h);
}

// ---- gate.expire ----

const HOUR = 3_600_000;

/** Who the hold goes to when the first approver did not answer, for escalateTo 'role': the admins, and the owner when the admins already had it. */
function roleAbove(h: Hold): Assignee | null {
  if (h.approver.kind === "role" && h.approver.id === "rol_owner") return null;
  if (h.approver.kind === "role" && h.approver.id === "rol_admin") return { kind: "role", id: "rol_owner" };
  return { kind: "role", id: "rol_admin" };
}

export async function expire(ctx: GateCtx, input: In): Promise<unknown> {
  const h = getHold(ctx, input.holdId);
  if (h.state !== "held") raise(ctx, "validation.precondition_failed", `This hold is ${h.state} already.`, { reason: "not_held", state: h.state });
  if (h.sendingAt !== undefined) raise(ctx, "validation.precondition_failed", "This is being sent right now.", { reason: "sending" });
  const now = ctx.now();
  if (h.expiresAt > now) raise(ctx, "validation.precondition_failed", "It is not due yet.", { reason: "not_due", expiresAt: h.expiresAt });
  const a = actOf(h.act);

  // 'escalate': once, to the delegate or the role above; nobody to pass it to means the act is dropped, never sent
  if (h.rule.onTimeout === "escalate" && h.escalatedAt === undefined && ctx.call) {
    let to: Assignee | undefined;
    try {
      if (h.rule.escalateTo === "role") {
        const role = roleAbove(h);
        if (role) {
          const r = (await ctx.call("tasks.assign", { taskId: h.taskId, slot: "approver", to: role })) as { task?: { approver?: Assignee } } | null;
          to = r?.task?.approver ?? role;
        }
      } else {
        const r = (await ctx.call("tasks.escalate", { taskId: h.taskId, reason: "timeout" })) as { task?: { approver?: Assignee } } | null;
        to = r?.task?.approver;
      }
    } catch { to = undefined; }
    if (to) {
      h.approver = to;
      h.escalatedAt = now;
      h.expiresAt = now + h.rule.afterHours * HOUR;
      if (ctx.schedule) {
        try { h.expireSchedule = await ctx.schedule(h.expiresAt, "gate.expire", { holdId: h.id }); } catch { /* the sweep applies it */ }
      }
      saveHold(ctx.db, h);
      emitGate(ctx, "gate.expired", h, { outcome: "escalated", escalatedTo: to.id });
      return { outcome: "escalated", escalatedTo: to.id };
    }
  }
  settle(ctx, h, "expired", "system");
  await cancelSchedules(ctx, h);
  saveHold(ctx.db, h);
  if (ctx.call) { try { await ctx.call("tasks.withdraw", { taskId: h.taskId, note: `Timed out: ${a.title} was not sent.` }); } catch { /* already closed */ } }
  emitGate(ctx, "gate.expired", h, { outcome: "dropped" });
  await resumeRun(ctx, h);
  return { outcome: "dropped" };
}

/** Apply every timeout that is due. The scheduler calls gate.expire at each hold's time; this is the catch-up for a scheduler that was down or a timer that could not be set. */
export async function sweep(ctx: GateCtx): Promise<{ holdId: string; outcome: string }[]> {
  const out: { holdId: string; outcome: string }[] = [];
  for (const h of holdsWhere(ctx.db, "state = 'held' AND sending_at IS NULL AND expires_at <= ?", ctx.now()).reverse()) {
    try {
      const r = (await expire(ctx, { holdId: h.id })) as { outcome: string };
      out.push({ holdId: h.id, outcome: r.outcome });
    } catch (e) {
      out.push({ holdId: h.id, outcome: `failed:${(e as { error?: { code?: string } })?.error?.code ?? "unexpected"}` });
    }
  }
  return out;
}
