// What happens to a hold after it is parked (ARCH 4.6): release (approve), deny, expire (timeout escalation or drop), and the sweep that applies due timeouts.
// Approving goes through tasks.act, which mints a sealed approval token bound to this task, this hold, its decision id and payload hash, the approver and the device, valid 10 minutes.
// gate.release opens that token with ctx.seal, checks every claim against the hold, then re-invokes the parked call as its original caller with the token (the host lets exactly this payload through).
// Held -> sending is one guarded UPDATE, so two taps send once. A failed send goes back to held with its error: the person approved it and may try again.
import { actOf, cut, getHold, holdsWhere, raise, saveHold, sha } from "../projections.ts";
import type { Assignee, GateCtx, Hold } from "../projections.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { addStepTargets } from "./grants.ts";

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

// the chat the held call came from and the agent that made it, recorded at hold time, so an answer wakes that agent there (modules/engine held-notes.ts) without looking for it afterwards
const payloadOf = (h: Hold, extra: Record<string, unknown>): Record<string, unknown> => ({
  holdId: h.id, act: h.act, taskId: h.taskId, capName: h.capName, ...(h.askedBy ? { askedBy: h.askedBy } : {}),
  ...(h.threadId ? { threadId: h.threadId } : {}), ...(h.principal.kind === "agent" ? { agentId: h.principal.id } : {}), ...(h.actingFor ? { actingFor: h.actingFor } : {}), ...extra,
});
const emitGate = (ctx: GateCtx, name: string, h: Hold, extra: Record<string, unknown>): void => {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payloadOf(h, extra))) if (v !== undefined) clean[k] = v;
  ctx.emit(name, `task/${h.taskId}`, clean, { vis: "participants" });
};

// ---- who decides ----

const asAssignee = (v: unknown): Assignee | null => (v && typeof v === "object" && typeof (v as Assignee).id === "string" && typeof (v as Assignee).kind === "string" ? { kind: (v as Assignee).kind, id: (v as Assignee).id } : null);

/** A task slot moved: the hold follows it, and the move is written down. Only a hold still waiting, and never a person-only one. */
export async function syncApprover(ctx: GateCtx, event: { name: string; payload: Record<string, unknown> }): Promise<string[]> {
  const p = event.payload, taskId = typeof p["taskId"] === "string" ? p["taskId"] : "";
  if (!taskId) return [];
  const how = event.name === "task.assigned" ? "assigned" : event.name === "task.delegated" ? "delegated" : "escalated";
  if (how === "assigned" && p["slot"] !== "approver") return [];
  const to = asAssignee(how === "delegated" ? p["passedTo"] : p["to"]);
  if (!to) return [];
  const h = holdsWhere(ctx.db, "task_id = ? AND state = 'held'", taskId)[0];
  if (!h || actOf(h.act).personOnly || (h.approver.kind === to.kind && h.approver.id === to.id)) return [];
  const by = typeof p["by"] === "string" ? p["by"] : typeof p["from"] === "string" ? p["from"] : undefined;
  // only a move made by someone who may decide the hold is followed (a member with Edit on the task can write the slot, but that does not hand them the approval); a move onto the mover needs the same
  if (!(await mayMove(ctx, h, by))) {
    ctx.log?.warn("gate.approver_move_refused", { holdId: h.id, taskId, by: by ?? null, to, how });
    return [];
  }
  const from = h.approver;
  h.approver = to;
  saveHold(ctx.db, h);
  ctx.emit("gate.approver_moved", `task/${taskId}`, { holdId: h.id, act: h.act, taskId, from, to, ...(by ? { by } : {}), how }, { vis: "participants" });
  return [h.id];
}

/** May this person move the hold's approval on? The current approver, a member of its role or group, someone holding Manage on its task, or a trusted service (the timeout sweep). Nobody else, and an agent never. */
async function mayMove(ctx: GateCtx, h: Hold, by: string | undefined): Promise<boolean> {
  if (!by) return false;
  if (by.startsWith("svc_") && isTrustedService({ kind: "service", id: by })) return true;
  const a = h.approver;
  if ((a.kind === "person" || a.kind === "agent" || a.kind === "automation") && a.id === by) return a.kind === "person";
  if (!ctx.call) return false;
  try {
    if (a.kind === "role") {
      const r = (await ctx.call("access.roles.get", { roleId: a.id })) as { holders?: Array<{ id?: string }> } | null;
      if (r?.holders?.some((x) => x.id === by)) return true;
    } else if (a.kind === "group") {
      const g = (await ctx.call("access.groups.get", { groupId: a.id })) as { members?: Array<{ id?: string }> } | null;
      if (g?.members?.some((x) => x.id === by)) return true;
    }
    const d = (await ctx.call("access.check", { principal: { kind: "person", id: by }, action: { perm: null, level: "manage" }, resource: { type: "task", id: h.taskId } })) as { decision?: { effect?: string } } | null;
    return d?.decision?.effect === "allow";
  } catch { return false; }
}

/**
 * May this releaser decide the hold? The one it waits on now (a person, or a member of its role or group, read from their own roles); or someone the Space's own grants let act on its task (the owner approves a
 * member's agent's send: that is how the product works and tests hold it); or, where the Space names agents for a low-risk act, an agent. Moving the task's slot changes who it waits on (gate.approver_moved),
 * so an approval handed on by anyone is followed by the hold. A person-only act never reaches here: it is judged before, by identity alone.
 */
async function decides(ctx: GateCtx, h: Hold, claims: Claims): Promise<boolean> {
  const a = h.approver;
  if (ctx.principal.kind === "agent" && !h.rule.peopleOnly) return true;
  if ((a.kind === "person" || a.kind === "agent" || a.kind === "automation") && (ctx.principal.id === a.id || claims.forPerson === a.id)) return true;
  if ((a.kind === "role" || a.kind === "group") && ctx.call) {
    try {
      const me = (await ctx.call("identity.whoami", {})) as { roles?: unknown; groups?: unknown } | null;
      const have = a.kind === "role" ? me?.roles : me?.groups;
      if (Array.isArray(have) && have.includes(a.id)) return true;
    } catch { /* falls to the grants */ }
  }
  return !!ctx.authorize && !!h.taskId && ctx.authorize({ perm: null, level: "manage" }, { type: "task", id: h.taskId }).effect === "allow";
}

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
  // an act that is the person's alone (a session using their GitHub): only the person it was asked of, from their own session, and never as someone acting for them. Whatever the task's slots say now.
  if (actOf(h.act).personOnly && (ctx.principal.kind !== "person" || h.approver.kind !== "person" || claims.by !== h.approver.id || claims.forPerson !== null)) {
    raise(ctx, "validation.precondition_failed", "Only the person this was asked of can approve it.", { reason: "not_the_person" });
  }
  if (ctx.principal.kind !== "person" && h.rule.peopleOnly) raise(ctx, "validation.precondition_failed", "Only a person can approve this.", { reason: "people_only" });
  // Ask the person: it runs as them, so only their own press, from their own session, releases it. An agent acting for them, a delegate or an admin cannot.
  if (h.askedBy && (claims.by !== h.principal.id || claims.forPerson !== null || ctx.principal.kind !== "person")) {
    raise(ctx, "validation.precondition_failed", "Only the person this runs as can approve it.", { reason: "not_the_person" });
  }
  // a step of an automation is the automation's act, not the person's request: the person it runs as may approve it
  if (!h.askedBy && h.principal.kind === "person" && h.principal.id === claims.by && h.rule.approvers !== "asker" && !h.step) {
    raise(ctx, "validation.precondition_failed", "Someone else has to approve what you asked for.", { reason: "self_approval" });
  }
  // the Gate is the one source of truth for who decides: whatever a task slot says, the releaser is the hold's current approver, or in its role (the slot moves it through gate.approver_moved)
  if (!(await decides(ctx, h, claims))) raise(ctx, "validation.precondition_failed", "This is waiting on someone else.", { reason: "not_the_approver" });
  if ((await sha(h.input)) !== h.inputHash) raise(ctx, "internal.unexpected", "The held act changed after it was parked.", { reason: "tampered" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Approvals are not available right now.", { service: "call" });

  // held -> sending, once
  const at = ctx.now();
  const won = ctx.db.run("UPDATE gate_holds SET sending_at = ?, error = NULL WHERE id = ? AND state = 'held' AND sending_at IS NULL AND json_extract(approver, '$.kind') = ? AND json_extract(approver, '$.id') = ?", at, h.id, h.approver.kind, h.approver.id).changes === 1;
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
  const kept = result === undefined || result === null ? undefined : JSON.stringify(result);
  // only a chat turn, or an agent that asked its person, waits for the answer, and a secret is never kept: vault.* calls resume the turn with "approved" only
  if (kept !== undefined && (h.threadId !== undefined || h.askedBy !== undefined) && !h.capName.startsWith("vault.")) h.result = kept.length <= 100_000 ? result : { truncated: true };
  settle(ctx, h, "approved", claims.by);
  addStepTargets(ctx, h);
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
  await learnFromDenial(ctx, h, note);
  await resumeRun(ctx, h);
  return { ok: true };
}

/** A person turned down what an agent was about to do: memory keeps a lesson from it (memory.corrections.record, as the person), when their switch is on. A failing memory never holds the denial up. */
async function learnFromDenial(ctx: GateCtx, h: Hold, note: string | undefined): Promise<void> {
  if (!ctx.call || h.principal.kind !== "agent" || ctx.principal.kind !== "person") return;
  try {
    await ctx.call("memory.corrections.record", { agentId: h.principal.id, how: "refuse", was: h.summary, ...(note ? { note } : {}), ...(h.threadId ? { threadId: h.threadId } : {}), ref: h.id });
  } catch { /* the denial stands; the lesson is a courtesy */ }
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
