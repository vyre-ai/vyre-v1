// Parking a call (ARCH 4.6): gate.park turns a call that authorize held into a hold row and an Approve task with the exact preview; the rules (gate.rules.*), the effective rule,
// the hold lists, and the two things the module does on its own: recover() after a crash and rejectAllOf() when a person leaves.
// gate.park is called by the invoke pipeline with the payload hash it computed; the Gate stores it with the decision id, writes both onto the task as reserved working notes
// (tasks.working_notes.set decision_id and payload_hash, once each) and sets two timers: gate.expire at the timeout and one approval.backstop notification at the backstop hour.
import {
  ACTS, APPROVER_RANK, RISK_RANK, actOf, allRules, approverFor, clean, effectiveRule, getHold, holdOut, holdsWhere, insertHold, mayHandle, newHoldId, previewBlocks, putRule,
  raise, readPolicy, saveHold, sha, summaryLine,
} from "../projections.ts";
import { isSystemCall } from "../../../lib/trust.ts";
import type { ActDef, GateCtx, Hold, PrincipalRef, RuleRow, Scope } from "../projections.ts";
import { dropHold } from "./approve.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const HOUR = 3_600_000;

// ---- gate.park ----

/** The person an `asker` rule names: whom the agent acts for, else the person who asked, else the agent's owner. */
async function askerOf(ctx: GateCtx, p: PrincipalRef, actingFor: string | undefined): Promise<string | undefined> {
  if (actingFor) return actingFor;
  if (p.kind === "person") return p.id;
  if (p.kind === "agent" && ctx.call) {
    try {
      const r = (await ctx.call("access.principals.get", { principal: { kind: "agent", id: p.id } })) as { principal?: { owner?: unknown } } | null;
      const owner = r?.principal?.owner;
      if (typeof owner === "string" && owner) return owner;
    } catch { /* falls to the admins */ }
  }
  return undefined;
}

export async function park(ctx: GateCtx, input: In): Promise<unknown> {
  // Only the pipeline parks a call: the Gate hook calls with origin "gate" (as the Space's owner, for the Space itself), the host with svc_host. The hold names the principal, the capability and the input
  // that gate.release later runs as that principal, so a hold a caller wrote themselves would run anything as anyone (P-SEC_10).
  if (!isSystemCall(ctx) && ctx.origin !== "gate") raise(ctx, "permission.role_lacks_permission", "Only the server parks a call for approval.", { reason: "system_only" });
  const same = holdsWhere(ctx.db, "decision_id = ?", input.decisionId)[0];
  if (same) return clean({ holdId: same.id, taskId: same.taskId, runId: same.runId });   // the same decision parked twice is one hold
  if (!ctx.call) raise(ctx, "internal.unavailable", "Approvals are not available right now.", { service: "call" });
  const principal = input.principal as PrincipalRef;
  const a = actOf(input.act);
  const policy = readPolicy(ctx.db);
  const rule = effectiveRule(ctx.db, principal, a.key, policy);
  const now = ctx.now();
  const asker = await askerOf(ctx, principal, input.actingFor);
  const approver = approverFor(rule.approvers, asker);
  const expiresAt = now + rule.afterHours * HOUR;
  const backstopAt = now + rule.emailBackstopHours * HOUR;
  const id = newHoldId();
  const summary = summaryLine(a, input.capName, input.input);

  const hold: Hold = {
    id, act: a.key, capName: input.capName, capVersion: input.capVersion, input: input.input ?? null, inputHash: await sha(input.input ?? null), payloadHash: input.payloadHash,
    principal, decisionId: input.decisionId, taskId: "", state: "held", summary, approver, rule, createdAt: now, expiresAt, backstopAt, possiblySent: false,
  };
  if (input.actingFor) hold.actingFor = input.actingFor;
  if (input.runId) hold.runId = input.runId;
  if (input.threadId) hold.threadId = input.threadId;
  insertHold(ctx.db, hold);

  let taskId: string;
  try {
    const r = (await ctx.call("tasks.create", clean({
      kind: "approve", title: `Approve: ${a.title}`, summary, why: rule.reason, assigned: approver, blocks: previewBlocks(a, input.capName, input.input),
      source: { kind: "gate", id }, expiresAt, idempotencyKey: `gate:${id}`,
    }))) as { task: { id: string } };
    taskId = r.task.id;
    await ctx.call("tasks.working_notes.set", { taskId, key: "decision_id", value: input.decisionId });
    await ctx.call("tasks.working_notes.set", { taskId, key: "payload_hash", value: input.payloadHash });
  } catch (e) {
    ctx.db.run("DELETE FROM gate_holds WHERE id = ?", id);
    throw e;
  }
  hold.taskId = taskId;

  if (input.runId) {
    try { await ctx.call("runs.mark_waiting", { runId: input.runId, reason: "approval", taskId }); } catch { /* the Run shows Waiting when it can; the hold stands either way */ }
  }
  if (ctx.schedule) {
    try { hold.expireSchedule = await ctx.schedule(expiresAt, "gate.expire", { holdId: id }); } catch { ctx.log?.warn("gate.timer_failed", { holdId: id, which: "expire" }); }
    if (approver.kind === "person" && backstopAt < expiresAt) {
      try {
        hold.backstopSchedule = await ctx.schedule(backstopAt, "notifications.send", {
          to: approver.id, kind: "approval.backstop", subject: { type: "task", id: taskId }, title: summary, collapseKey: `approval.backstop:${taskId}`,
        });
      } catch { ctx.log?.warn("gate.timer_failed", { holdId: id, which: "backstop" }); }
    }
  }
  saveHold(ctx.db, hold);

  ctx.emit("gate.requested", `task/${taskId}`, clean({
    holdId: id, act: a.key, capName: input.capName, taskId, principal, actingFor: input.actingFor, runId: input.runId, expiresAt,
  }), { vis: "participants" });
  return clean({ holdId: id, taskId, runId: input.runId });
}

// ---- reads ----

export async function effectiveRuleOf(ctx: GateCtx, input: In): Promise<unknown> {
  const e = effectiveRule(ctx.db, input.principal as PrincipalRef, input.act);
  return { hold: e.hold, reason: e.reason, approvers: e.approvers, peopleOnly: e.peopleOnly, afterHours: e.afterHours, onTimeout: e.onTimeout, sources: e.sources };
}

export async function actsList(_ctx: GateCtx, _input: In): Promise<unknown> {
  return { acts: ACTS.map((a) => ({ key: a.key, title: a.title, risk: a.risk, humanToo: a.humanToo, peopleOnly: a.agentOkFor === undefined || RISK_RANK[a.agentOkFor] < RISK_RANK[a.risk] })) };
}

function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const res: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) res.next = String(start + rows.length);
  return res;
}

export async function holdsList(ctx: GateCtx, input: In): Promise<unknown> {
  const all = holdsWhere(ctx.db).filter((h) =>
    (!input.states || (input.states as string[]).includes(h.state)) && (!input.act || h.act === input.act) && (!input.runId || h.runId === input.runId) && mayHandle(ctx, h));
  const p = page(all, input.cursor, input.limit);
  return clean({ holds: p.rows.map(holdOut), next: p.next, total: p.total });
}

export async function holdsGet(ctx: GateCtx, input: In): Promise<unknown> {
  const h = getHold(ctx, input.holdId);
  if (!mayHandle(ctx, h)) raise(ctx, "permission.not_found", "That hold is not available.");
  return { hold: holdOut(h) };
}

// ---- rules ----

function ruleOut(r: RuleRow | undefined, a: ActDef, scope: Scope, agentId: string, ctx: GateCtx): Record<string, unknown> {
  const policy = readPolicy(ctx.db);
  const okFor = r?.agentOkFor ?? a.agentOkFor;
  return clean({
    act: a.key, mode: r?.mode ?? "hold", approvers: r?.approvers ?? a.approvers, peopleOnly: okFor === undefined || RISK_RANK[okFor] < RISK_RANK[a.risk], agentOkFor: okFor,
    afterHours: r?.afterHours ?? policy.timeoutHours, onTimeout: r?.onTimeout ?? a.onTimeout, escalateTo: r?.escalateTo ?? a.escalateTo,
    emailBackstopHours: Math.min(policy.emailBackstopHours, a.emailBackstopHours), scope, agentId: agentId || undefined,
  });
}

export async function rulesList(ctx: GateCtx, input: In): Promise<unknown> {
  const rules: Record<string, unknown>[] = [];
  const stored = allRules(ctx.db);
  if (input.scope === undefined || input.scope === "space") {
    for (const a of ACTS) rules.push(ruleOut(stored.find((r) => r.act === a.key && r.scope === "space"), a, "space", "", ctx));   // the defaults show too
  }
  for (const r of stored) {
    if (r.scope === "space" || (input.scope !== undefined && r.scope !== input.scope)) continue;
    if (input.agentId !== undefined && r.agentId !== input.agentId) continue;
    rules.push(ruleOut(r, actOf(r.act), r.scope, r.agentId, ctx));
  }
  return { rules };
}

const APPROVERS = /^(owner|asker|role:[a-z0-9_-]+)$/;

export async function rulesSet(ctx: GateCtx, input: In): Promise<unknown> {
  const a = actOf(input.act);
  const scope = input.scope as Scope;
  const agentId = (input.agentId as string | undefined) ?? "";
  if (scope === "agent" && !agentId) raise(ctx, "validation.precondition_failed", "An agent rule names the agent.", { reason: "agent_required" });
  if (scope !== "agent" && agentId) raise(ctx, "validation.precondition_failed", "Only an agent rule names an agent.", { reason: "agent_not_allowed" });
  if (scope === "floor" && input.mode === "allow") raise(ctx, "validation.precondition_failed", "The owner floor only asks. To let something through, change the Space rule.", { reason: "floor_holds_only" });
  if (input.approvers !== undefined && !APPROVERS.test(input.approvers)) raise(ctx, "validation.precondition_failed", "Approvers are owner, asker or role:<name>.", { reason: "bad_approvers" });

  // a rule can never loosen the strictest level: below the Space, it can only tighten what the Space says
  if (scope !== "space") {
    const policy = readPolicy(ctx.db);
    const space = allRules(ctx.db).find((r) => r.act === a.key && r.scope === "space");
    const base = {
      mode: space?.mode ?? "hold", approvers: space?.approvers ?? a.approvers, afterHours: space?.afterHours ?? policy.timeoutHours, onTimeout: space?.onTimeout ?? a.onTimeout,
      agentOkFor: space?.agentOkFor ?? a.agentOkFor,
    };
    const loosens = (what: string): never => raise(ctx, "validation.precondition_failed", `That would loosen the Space rule (${what}). Rules below the Space can only tighten it.`, { reason: "would_loosen", what });
    if (input.mode === "allow" && base.mode === "hold") loosens("mode");
    if (input.approvers !== undefined && APPROVER_RANK(input.approvers) < APPROVER_RANK(base.approvers)) loosens("approvers");
    if (input.afterHours !== undefined && input.afterHours > base.afterHours) loosens("afterHours");
    if (input.onTimeout === "escalate" && base.onTimeout === "drop") loosens("onTimeout");
    if (input.agentOkFor !== undefined && (base.agentOkFor === undefined || RISK_RANK[input.agentOkFor as keyof typeof RISK_RANK] > RISK_RANK[base.agentOkFor])) loosens("agentOkFor");
  }
  const row: RuleRow = { act: a.key, scope, agentId, mode: input.mode, updatedAt: ctx.now() };
  if (input.approvers !== undefined) row.approvers = input.approvers;
  if (input.agentOkFor !== undefined) row.agentOkFor = input.agentOkFor;
  if (input.afterHours !== undefined) row.afterHours = input.afterHours;
  if (input.onTimeout !== undefined) row.onTimeout = input.onTimeout;
  if (input.escalateTo !== undefined) row.escalateTo = input.escalateTo;
  putRule(ctx.db, row);
  ctx.emit("gate.rule_changed", `entity/${a.key}`, clean({ act: a.key, scope, agentId: agentId || undefined, by: ctx.principal.id }));
  return { rule: ruleOut(row, a, scope, agentId, ctx) };
}

// ---- crash recovery and member removal ----

/** At boot: a hold whose approved call was running when the process died goes back to held and is marked possibly sent, so the approver checks before sending it again. */
export async function recover(ctx: Pick<GateCtx, "db" | "now" | "call">): Promise<string[]> {
  const stuck = holdsWhere(ctx.db, "state = 'held' AND sending_at IS NOT NULL");
  for (const h of stuck) {
    delete h.sendingAt;
    h.possiblySent = true;
    h.error = "Interrupted while sending. It may have gone out. Check before sending it again.";
    saveHold(ctx.db, h);
    if (ctx.call && h.taskId) {
      try { await ctx.call("tasks.working_notes.set", { taskId: h.taskId, key: "possibly_sent", value: "This may already have been sent. Check before approving again." }); } catch { /* the hold row carries the mark */ }
    }
  }
  return stuck.map((h) => h.id);
}

/** A person was removed: everything they asked the Gate to send is dropped, never sent. */
export async function rejectAllOf(ctx: GateCtx, person: string, reason: string): Promise<string[]> {
  const mine = holdsWhere(ctx.db, "state = 'held' AND (principal_id = ? OR acting_for = ?)", person, person);
  const done: string[] = [];
  for (const h of mine) {
    if (h.sendingAt !== undefined) continue;   // mid-send: recover() sorts it out
    await dropHold(ctx, h, reason);
    done.push(h.id);
  }
  return done;
}
