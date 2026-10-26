// tasks.act, tasks.delegate, tasks.escalate and stuck-task detection (ARCH 4.6 and 4.7, spec 2.8 and 2.14).
// Acting in Needs you acts at the source: approving a held act mints an approval token and releases the hold, a run is resumed, a chat hears the events.
// The approval token is sealed (ctx.seal) with its claims, so it is bound to this task, this hold, this payload hash, this person and this device, and lives 10 minutes.
// CONTRACT NOTE for module gate (P-L6_02): a held act is a task of kind approve whose source is { kind: 'gate', id: <holdId> }. After tasks.create the Gate writes
// two reserved working notes, decision_id and payload_hash (tasks.working_notes.set, once each); the claims below carry them. gate.release unseals the token
// with ctx.seal.unseal, checks the claims (task, hold, decision, hash, device) and expiry, and only then re-invokes the parked capability.
import { isTrustedService } from "../../../lib/trust.ts";
import {
  actionableByMe, actionableSlot, allTasks, clean, emitTask, getTask, isOpen, isRequest, openIndex, out, raise, readPolicy, sameAssignee, touch, visibleTo, whoIs,
} from "../projections.ts";
import type { Assignee, Task, TasksCtx } from "../projections.ts";
import { KIND_ACTIONS, afterReview, checkMove, commitMove, submitTarget } from "./state.ts";
import type { Policy } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** Keys each kind of task accepts in tasks.act. delegate, snooze and take have their own capabilities. */
export const ACT_KEYS: Record<Task["kind"], readonly string[]> = {
  work: ["start", "submit", "complete", "approve", "send_back", "reject", "cancel", "reopen"],
  approve: ["approve", "reject"],
  review: ["approve", "send_back"],
  answer: ["answer", "dismiss"],
  unblock: ["resolved", "cannot"],
  signature: ["cancel", "reopen"],
};
const OWN_CAPABILITY: Record<string, string> = { delegate: "tasks.delegate", snooze: "tasks.snooze", take: "tasks.take" };
export const TOKEN_MINUTES = 10;

/** Where an action leads, given the task as it is now; null when it does not apply in this state. */
export function targetFor(t: Task, key: string): Task["state"] | null {
  switch (key) {
    case "start": return t.state === "todo" ? "doing" : null;
    case "submit": case "complete": case "answer": case "resolved": return t.state === "todo" || t.state === "doing" ? submitTarget(t) : null;
    case "approve": return t.state === "awaiting_approval" ? "done" : t.state === "in_review" ? afterReview(t) : null;
    case "reject": return t.state === "awaiting_approval" ? "doing" : null;
    case "send_back": return t.state === "in_review" ? "doing" : null;
    case "dismiss": case "cannot": case "cancel": return "canceled";
    case "reopen": return isOpen(t.state) ? null : "todo";
    default: return null;
  }
}

// ---- approval token ----

export interface ApprovalClaims { v: 1; task: string; hold: string | null; decision: string | null; hash: string | null; by: string; forPerson: string | null; device: string | null; exp: number }

const b64url = (s: string): string => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const unb64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export function mintApprovalToken(ctx: TasksCtx, t: Task): string {
  if (!ctx.seal) raise(ctx, "internal.unavailable", "Approvals are not available right now.", { service: "seal" });
  const claims: ApprovalClaims = {
    v: 1, task: t.id, hold: t.source?.kind === "gate" ? t.source.id : null, decision: t.decisionId ?? null, hash: t.payloadHash ?? null,
    by: ctx.principal.id, forPerson: ctx.actingFor ?? null, device: ctx.device ?? null, exp: ctx.now() + TOKEN_MINUTES * 60_000,
  };
  const sealed = ctx.seal.seal(new TextEncoder().encode(JSON.stringify(claims)), "tasks.approval");
  return `apv_${b64url(JSON.stringify(sealed))}`;
}

/** The claims of a token, or null when it is not one of ours. The caller still checks the claims against the hold and the clock. */
export function readApprovalToken(ctx: TasksCtx, token: string): ApprovalClaims | null {
  if (!ctx.seal || !token.startsWith("apv_")) return null;
  try {
    const sealed = JSON.parse(unb64url(token.slice(4))) as { keyId: string; nonce: string; bytes: string };
    const claims = JSON.parse(new TextDecoder().decode(ctx.seal.unseal(sealed))) as ApprovalClaims;
    return claims && claims.v === 1 && typeof claims.task === "string" && typeof claims.exp === "number" ? claims : null;
  } catch { return null; }
}

// ---- tasks.act ----

export async function act(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  const who = whoIs(ctx);
  const key = String(input.action ?? "");
  const note = typeof input.note === "string" ? input.note.trim() : "";

  if (!isOpen(t.state) && key !== "reopen") {
    if (t.handledBy !== undefined && t.handledBy !== who.id) raise(ctx, "validation.precondition_failed", `Handled by ${t.handledBy}.`, { reason: "handled", handledBy: t.handledBy });
    raise(ctx, "validation.precondition_failed", `This task is ${t.state === "done" ? "done" : "canceled"} already.`, { reason: "closed" });
  }
  if (isOpen(t.state) && t.expiresAt !== undefined && ctx.now() > t.expiresAt) raise(ctx, "permission.expired", "This request expired. Ask for it again.", { expiresAt: t.expiresAt });
  const own = OWN_CAPABILITY[key];
  if (own) raise(ctx, "validation.precondition_failed", `Use ${own} for that.`, { reason: "own_capability", cap: own });
  const offered = t.actions.length > 0 ? t.actions.map((a) => a.key) : KIND_ACTIONS[t.kind].map((a) => a.key);
  const allowed = ACT_KEYS[t.kind].filter((k) => t.kind === "work" || t.kind === "signature" || offered.includes(k));
  if (!allowed.includes(key)) raise(ctx, "validation.precondition_failed", `A ${t.kind} task has no action called ${key}.`, { reason: "unknown_action", allowed });
  const def = t.actions.find((a) => a.key === key) ?? KIND_ACTIONS[t.kind].find((a) => a.key === key);
  if (def?.note === "required" && !note) raise(ctx, "validation.precondition_failed", "Add a note so the sender knows what to change.", { reason: "note_required" });
  const to = targetFor(t, key);
  if (to === null) raise(ctx, "validation.precondition_failed", `That cannot be done while the task is ${t.state}.`, { reason: "illegal_transition", state: t.state, action: key });

  const gate = t.source?.kind === "gate" ? t.source : undefined;
  const edits = input.edits as Record<string, unknown> | undefined;
  if (gate && edits && Object.keys(edits).length > 0) raise(ctx, "validation.field_locked", "A held act is approved exactly as it was shown.", { field: "edits" });

  const policy: Policy = readPolicy(ctx.db);
  const checked = checkMove(ctx, t, to, { note }, policy);   // nothing is written or released before every rule has passed

  const result: Record<string, unknown> = { action: key };
  if (gate && (key === "approve" || key === "reject")) {
    if (key === "approve") {
      if (!ctx.call) raise(ctx, "internal.unavailable", "Approvals are not available right now.", { service: "call" });
      if (ctx.principal.kind === "person" && !ctx.device) raise(ctx, "validation.precondition_failed", "Approve from a signed-in device.", { reason: "device_required" });
      const token = mintApprovalToken(ctx, t);
      const r = (await ctx.call("gate.release", { holdId: gate.id, taskId: t.id, approvalToken: token })) as { result?: unknown } | null;
      result.released = true;
      if (r && r.result !== undefined) result.sent = r.result;
    } else if (ctx.call) {
      await ctx.call("gate.deny", clean({ holdId: gate.id, taskId: t.id, mode: "send_back", note }));
      result.denied = true;
    }
  }
  if (input.answer !== undefined && (t.kind === "answer" || t.kind === "unblock")) {
    t.workingNotes = { ...t.workingNotes, answer: JSON.stringify(input.answer) };
    result.answer = input.answer;
  }
  if (edits && Object.keys(edits).length > 0) t.workingNotes = { ...t.workingNotes, edits: JSON.stringify(edits) };

  const applied = commitMove(ctx, t, to, checked);
  if (applied.handled) emitTask(ctx, ctx.db, "task.handled", t, { by: ctx.principal.id }, { type: "handled", by: ctx.principal.id });

  // continue the source at once; a failure here is reported in the result, never undoes the decision
  if (t.source?.kind === "run" && ctx.call && to !== "canceled" && (key === "approve" || key === "answer" || key === "resolved")) {
    const wr = t.workingNotes.wait_reason;
    const reason = wr === "approval" || wr === "background" || wr === "key" ? wr : t.kind === "unblock" ? "background" : "approval";
    try { await ctx.call("runs.resume", { runId: t.source.id, reason }); result.resumed = true; }
    catch (e) { result.resumed = false; result.resumeError = (e as { error?: { code?: string } }).error?.code ?? "internal.unexpected"; }
  }
  return { task: out(ctx, t), result };
}

// ---- tasks.delegate and tasks.escalate ----

async function nextHolder(ctx: TasksCtx, t: Task, person: string): Promise<Assignee | undefined> {
  if (!ctx.call) raise(ctx, "internal.unavailable", "Handing over is not available right now.", { service: "call" });
  const r = (await ctx.call("notifications.delegate.resolve", { person, resource: { type: "task", id: t.id } })) as { delegate?: { kind: "person" | "role"; id: string } } | null;
  return r?.delegate ? { kind: r.delegate.kind, id: r.delegate.id } : undefined;
}

export async function delegate(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "A finished task cannot be handed over.", { reason: "closed" });
  if (!isRequest(t.kind)) raise(ctx, "validation.precondition_failed", "Only a request is handed over. Use tasks.assign for work.", { reason: "not_a_request" });
  const slot = actionableSlot(t.state);
  if (!slot) raise(ctx, "validation.precondition_failed", "Nothing is waiting on anyone.", { reason: "closed" });
  if (!actionableByMe(ctx, t) && !isTrustedService(ctx.principal)) raise(ctx, "validation.precondition_failed", "Only the person this request is waiting on can hand it over.", { reason: "wrong_actor" });
  const to = input.to as Assignee;
  if (!to || typeof to.id !== "string" || to.id.trim() === "") raise(ctx, "validation.bad_input", "Say who gets it.", { errors: ["/to/id: required"] });
  // delegation never widens access: a person goes through the delegate chain to the first who can act on this item
  let passedTo: Assignee | undefined = to;
  if (to.kind === "person") passedTo = await nextHolder(ctx, t, to.id);
  if (!passedTo) raise(ctx, "validation.precondition_failed", "Nobody in that chain can act on this request.", { reason: "nobody_can_act" });
  if (sameAssignee(passedTo, t[slot])) raise(ctx, "validation.precondition_failed", "It is with them already.", { reason: "same_holder" });
  const policy = readPolicy(ctx.db);
  if (slot === "approver" && policy.requireHumanApprover && (passedTo.kind === "agent" || passedTo.kind === "automation")) {
    raise(ctx, "validation.precondition_failed", "This Space needs a person to approve.", { reason: "human_approver_required" });
  }
  const from = ctx.principal.id;
  t[slot] = passedTo;
  delete t.takenBy; delete t.takenAt;
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined;
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.delegated", t, { from, to, passedTo }, clean({ type: "delegated", by: from, note }));
  return { task: out(ctx, t), passedTo };
}

export async function escalate(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const slot = isOpen(t.state) ? actionableSlot(t.state) : null;
  if (!slot) raise(ctx, "validation.precondition_failed", "A finished task is not escalated.", { reason: "closed" });
  const holder = t[slot];
  if (!holder) raise(ctx, "validation.precondition_failed", "Nobody holds this step.", { reason: "no_holder" });
  if (holder.kind === "group" || holder.kind === "role") raise(ctx, "validation.precondition_failed", "It is with a role already.", { reason: "already_role" });
  const person = holder.kind === "agent" ? t.responsible ?? holder.id : holder.id;
  const target = await nextHolder(ctx, t, person);
  if (!target || sameAssignee(target, holder)) raise(ctx, "validation.precondition_failed", "There is nobody to pass it to.", { reason: "no_delegate" });
  t[slot] = target;
  delete t.takenBy; delete t.takenAt; delete t.snoozedUntil;
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.escalated", t, { to: target, reason: input.reason }, { type: "escalated", by: ctx.principal.id });
  return { task: out(ctx, t) };
}

// ---- stuck tasks ----

export type StuckWhy = "unblock_waiting" | "idle_agent" | "waiting_on_decision";
export interface Stuck { taskId: string; why: StuckWhy; since: number; /** who should look: the agent's owner, else the creator */ notify: string }
export const STUCK_IDLE_MS = 24 * 3_600_000;

/** Open tasks that stopped moving: an Unblock nobody answered, an agent task that went quiet while Doing, a review or approval nobody decided.
 *  The scheduler and the Home at-risk read call this; it only reads. A snoozed request is not stuck, it is waiting for its time. */
export function findStuck(ctx: TasksCtx, o: { idleMs?: number } = {}): Stuck[] {
  const now = ctx.now();
  const idle = o.idleMs ?? STUCK_IDLE_MS;
  const rows = allTasks(ctx.db, "c.state NOT IN ('done', 'canceled')");
  const idx = openIndex(ctx.db);
  const result: Stuck[] = [];
  for (const t of rows) {
    if (t.snoozedUntil !== undefined && t.snoozedUntil > now) continue;
    const notify = t.responsible ?? t.createdBy;
    if (t.kind === "unblock" && t.parentTaskId !== undefined && idx.open.has(t.parentTaskId) && now - t.updatedAt >= idle) {
      const parent = rows.find((p) => p.id === t.parentTaskId);
      result.push({ taskId: t.parentTaskId, why: "unblock_waiting", since: t.updatedAt, notify: parent?.responsible ?? parent?.createdBy ?? notify });
    } else if (t.state === "doing" && t.assigned.kind === "agent" && now - t.updatedAt >= idle) {
      result.push({ taskId: t.id, why: "idle_agent", since: t.updatedAt, notify });
    } else if ((t.state === "in_review" || t.state === "awaiting_approval") && !isRequest(t.kind) && now - t.updatedAt >= idle) {
      result.push({ taskId: t.id, why: "waiting_on_decision", since: t.updatedAt, notify });
    }
  }
  return result.sort((a, b) => a.since - b.since || (a.taskId < b.taskId ? -1 : 1));
}
