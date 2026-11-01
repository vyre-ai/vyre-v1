// Grants (chat design, holes 1 and 3): what lets an outward act go without a hold. A grant is a row: person, act, target, and for an automation the hash of the definition it was given for.
// Only a person's press writes one, and it names the outward steps. An agent's save writes none and clears what was there, and the hash voids a row whatever path changed the definition.
// A step with a template where its target goes reaches something new on each Run: a person who wrote that step owns what it computes (row target *), and a person who only pressed Turn on for a step
// an agent wrote allows the targets it names, so a Run reaching another raises a task. Approving that task adds the one target it reached.
// A person's own message asks for an act this turn: the engine reads the words with lib/asked.ts and writes single-use rows here, as that person. No model output reaches this path. A row follows the request
// through wakes, Jobs and plan approval because it is matched on the thread and the threads above it, and the Gate spends it at the moment the act happens.
import { ANY_TARGET, namedCovers, normalLink, targetsOf } from "../../../lib/grants.ts";
import { isHostService } from "../../../lib/trust.ts";
import { clean, newHoldId, raise, sha } from "../projections.ts";
import type { GateCtx, Hold, StepRef } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Row { id: string; act: string; target: string; step_id: string | null }
interface StepIn { stepId: string; act: string; targets: string[]; computed: boolean; changed: boolean }

const newGrantId = (): string => `grt_${newHoldId().slice(4)}`;
const rowOut = (r: Row): Record<string, unknown> => ({ id: r.id, act: r.act, target: r.target, ...(r.step_id ? { stepId: r.step_id } : {}) });
const standing = (ctx: GateCtx, automationId: string): Row[] => ctx.db.all("SELECT id, act, target, step_id FROM gate_grants WHERE kind = 'standing' AND subject_id = ?", automationId) as unknown as Row[];

/** The targets of one step after this press. Null keeps nothing for that step. */
function targetsAfter(s: StepIn, kept: string[], press: "save" | "on"): string[] {
  const named = s.targets.length > 0 ? s.targets : s.computed ? [] : [ANY_TARGET];
  if (s.changed) return s.computed ? [...named, ANY_TARGET] : named;      // the person wrote this step
  if (kept.length > 0) return kept;                                        // a grant stands for a step this save did not touch
  return press === "on" ? named : [];                                     // Turn on names the step: it allows what the step names, never what it computes
}

export async function grantsSet(ctx: GateCtx, input: In): Promise<unknown> {
  // the automation capability a person pressed calls this, and it checked their access to the automation; nobody calls it from outside
  if ((ctx.depth ?? 0) === 0 && !isHostService(ctx.principal)) raise(ctx, "permission.role_lacks_permission", "An automation sets this when it is saved.", { reason: "system_only" });
  const by = ctx.principal;
  const pressed = by.kind === "person" || isHostService(by);
  const before = standing(ctx, input.automationId);
  ctx.db.run("DELETE FROM gate_grants WHERE kind = 'standing' AND subject_id = ?", input.automationId);
  if (!pressed) return { grants: [] };                                     // an agent's save: the automation holds nothing until a person presses
  const made: Row[] = [];
  for (const s of input.steps as StepIn[]) {
    const kept = before.filter((r) => r.step_id === s.stepId && r.act === s.act).map((r) => r.target);
    for (const target of new Set(targetsAfter(s, kept, input.press))) {
      const row: Row = { id: newGrantId(), act: s.act, target, step_id: s.stepId };
      ctx.db.run("INSERT INTO gate_grants (id, kind, person, act, target, def_hash, subject_id, step_id, created_at) VALUES (?, 'standing', ?, ?, ?, ?, ?, ?, ?)", row.id, by.id, s.act, target, input.defHash, input.automationId, s.stepId, ctx.now());
      made.push(row);
    }
  }
  return { grants: made.map(rowOut) };
}

/** Does this automation hold this act for this step, on this very definition, for every target the call reaches? A call that names no target needs a row for the step. */
function stepCovered(ctx: GateCtx, step: StepRef, act: string, targets: readonly string[]): boolean {
  const rows = ctx.db.all("SELECT target FROM gate_grants WHERE kind = 'standing' AND subject_id = ? AND def_hash = ? AND step_id = ? AND act = ?", step.automationId, step.defHash, step.nodeId, act) as unknown as { target: string }[];
  if (rows.length === 0) return false;
  const held = new Set(rows.map((r) => r.target));
  return held.has(ANY_TARGET) || (targets.length > 0 && targets.every((t) => held.has(t)));
}

/** Spend the person's own ask on this call. Every target must be one they named. A request that named none covers any target, and a call that shows none (a crew push, a saved draft) takes any ask for its act: once, and only in a thread no outside content has reached, because nothing checks where it goes. */
function turnSpent(ctx: GateCtx, act: string, targets: readonly string[], turn: { person: string; threads: string[] }): boolean {
  const marks = turn.threads.map(() => "?").join(", ");
  const taint = ctx.db.all(`SELECT cleared_at FROM gate_taint WHERE thread_id IN (${marks})`, ...turn.threads) as unknown as { cleared_at: number | null }[];
  if (taint.some((t) => t.cleared_at === null)) return false;
  const rows = ctx.db.all(`SELECT id, target FROM gate_grants WHERE kind = 'turn' AND person = ? AND act = ? AND used_at IS NULL AND expires_at > ? AND thread_id IN (${marks}) ORDER BY created_at ASC, id ASC`,
    turn.person, act, ctx.now(), ...turn.threads) as unknown as { id: string; target: string }[];
  const named = targets.map((t) => rows.find((r) => r.target !== "" && namedCovers(r.target, t)));
  const loose = targets.length === 0 ? rows : rows.filter((r) => r.target === "");
  const spend = targets.length > 0 && named.every((r) => r !== undefined) ? named.map((r) => r!.id) : taint.length === 0 ? loose.slice(0, 1).map((r) => r.id) : [];
  if (spend.length === 0) return false;
  let won = 0;
  for (const id of new Set(spend)) won += ctx.db.run("UPDATE gate_grants SET used_at = ? WHERE id = ? AND used_at IS NULL", ctx.now(), id).changes;
  return won > 0;
}

/** An Always allow rule that reads on this call, live: a removed or expired rule stops at the next act. */
function alwaysCovered(ctx: GateCtx, act: string, targets: readonly string[], a: { person: string; agentId: string; threads: string[]; cap: string }): boolean {
  const rows = ctx.db.all("SELECT target, agent_id, thread_id FROM gate_grants WHERE kind = 'always' AND person = ? AND act = ? AND expires_at > ?", a.person, act, ctx.now()) as unknown as { target: string; agent_id: string | null; thread_id: string | null }[];
  return rows.some((r) => (r.agent_id === null || r.agent_id === a.agentId) && (r.thread_id === null || a.threads.includes(r.thread_id))
    && (r.target === ANY_TARGET || r.target === a.cap || (targets.length > 0 && targets.every((t) => namedCovers(r.target, t)))));
}

export async function grantsTake(ctx: GateCtx, input: In): Promise<unknown> {
  if (!isHostService(ctx.principal) && !(ctx.origin === "gate" && (ctx.depth ?? 0) === 0)) raise(ctx, "permission.role_lacks_permission", "Only the server asks this.", { reason: "system_only" });
  const targets = input.targets as string[];
  if (input.step) return { granted: stepCovered(ctx, input.step as StepRef, input.act, targets) };
  if (input.always && alwaysCovered(ctx, input.act, targets, input.always)) return { granted: true };
  return { granted: input.turn ? turnSpent(ctx, input.act, targets, input.turn) : false };
}

const ALWAYS_DAYS = 30;
const DAY_MS = 86_400_000;
interface AllowRow { id: string; kind: string; act: string; target: string; agent_id: string | null; thread_id: string | null; subject_id: string | null; step_id: string | null; expires_at: number | null; person: string }
const allowOut = (r: AllowRow): Record<string, unknown> => clean({
  id: r.id, kind: r.kind, act: r.act, target: r.target, agentId: r.agent_id ?? undefined, threadId: r.thread_id ?? undefined, automationId: r.subject_id ?? undefined, stepId: r.step_id ?? undefined, expiresAt: r.expires_at ?? undefined,
});
const isAdmin = (ctx: GateCtx): boolean => ctx.authorize?.({ perm: "policy.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";

/** Always allow. It names who it lets through, so it never reaches further than that agent or chat. Local changes are a person's own to allow; an outward act needs an admin; money stays a Need. */
export async function allowSet(ctx: GateCtx, input: In): Promise<unknown> {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person allows this.", { reason: "people_only" });
  if (!input.agentId && !input.threadId) raise(ctx, "validation.bad_input", "Always allow is for one agent or one chat.");
  if (input.act === "pay") raise(ctx, "permission.role_lacks_permission", "Sending money always asks.", { reason: "money" });
  if (input.act !== "approve" && !isAdmin(ctx)) raise(ctx, "permission.role_lacks_permission", "An admin allows this.", { reason: "admin_only" });
  const now = ctx.now();
  const row: AllowRow = { id: newGrantId(), kind: "always", act: input.act, target: input.target, agent_id: input.agentId ?? null, thread_id: input.threadId ?? null, subject_id: null, step_id: null, expires_at: now + (input.days ?? ALWAYS_DAYS) * DAY_MS, person: ctx.principal.id };
  ctx.db.run("INSERT INTO gate_grants (id, kind, person, act, target, agent_id, thread_id, expires_at, created_at) VALUES (?, 'always', ?, ?, ?, ?, ?, ?, ?)", row.id, row.person, row.act, row.target, row.agent_id, row.thread_id, row.expires_at, now);
  return { rule: allowOut(row) };
}

export async function allowList(ctx: GateCtx): Promise<unknown> {
  const me = ctx.actingFor ?? ctx.principal.id;
  const rows = ctx.db.all("SELECT id, kind, act, target, agent_id, thread_id, subject_id, step_id, expires_at, person FROM gate_grants WHERE person = ? AND kind IN ('always', 'standing') AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC, id", me, ctx.now()) as unknown as AllowRow[];
  return { rules: rows.map(allowOut) };
}

export async function allowRemove(ctx: GateCtx, input: In): Promise<unknown> {
  const row = (ctx.db.all("SELECT person FROM gate_grants WHERE id = ?", input.id) as unknown as { person: string }[])[0];
  if (!row || (row.person !== ctx.principal.id && !isAdmin(ctx))) raise(ctx, "permission.not_found", "That rule is not available.");
  ctx.db.run("DELETE FROM gate_grants WHERE id = ?", input.id);
  return { ok: true };
}

const TURN_MS = 24 * 3_600_000;

/** Links are kept as hashes: the known list is for matching, and a link's query string can hold anything. */
async function keepLinks(ctx: GateCtx, thread: string, links: readonly string[]): Promise<void> {
  for (const raw of links) {
    const l = normalLink(raw);
    if (l !== null) ctx.db.run("INSERT OR IGNORE INTO gate_links (thread_id, link, at) VALUES (?, ?, ?)", thread, await sha(l), ctx.now());
  }
}

export async function linksKnown(ctx: GateCtx, input: In): Promise<unknown> {
  const l = normalLink(String(input.url));
  if (l === null) return { known: false };
  const threads = input.threads as string[];
  return { known: ctx.db.all(`SELECT 1 AS x FROM gate_links WHERE link = ? AND thread_id IN (${threads.map(() => "?").join(", ")})`, await sha(l), ...threads).length > 0 };
}

export async function taintMark(ctx: GateCtx, input: In): Promise<unknown> {
  if (!isHostService(ctx.principal) && !((ctx.origin === "gate" || ctx.origin === "engine") && (ctx.depth ?? 0) === 0)) raise(ctx, "permission.role_lacks_permission", "Only the server marks this.", { reason: "system_only" });
  for (const t of input.threads as string[]) {
    ctx.db.run("INSERT INTO gate_taint (thread_id, source, at) VALUES (?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET source = excluded.source, at = excluded.at, cleared_at = NULL", t, input.source, ctx.now());
    await keepLinks(ctx, t, (input.links ?? []) as string[]);
  }
  return { ok: true };
}

/** What a person's own message asks for this turn. Called by the engine as that person, before the turn starts. It ends what their last message in this thread left unused, and it clears the thread's taint: the person spoke. */
export async function grantsAsk(ctx: GateCtx, input: In): Promise<unknown> {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person's own message asks.", { reason: "people_only" });
  const person = ctx.principal.id, now = ctx.now();
  ctx.db.run("UPDATE gate_grants SET expires_at = ? WHERE kind = 'turn' AND person = ? AND thread_id = ? AND used_at IS NULL AND message_id <> ?", now, person, input.threadId, input.messageId);
  ctx.db.run("UPDATE gate_taint SET cleared_at = ? WHERE thread_id = ? AND cleared_at IS NULL", now, input.threadId);
  for (const a of input.asked as { act: string; target: string }[]) {
    ctx.db.run("INSERT OR IGNORE INTO gate_grants (id, kind, person, act, target, thread_id, message_id, expires_at, created_at) VALUES (?, 'turn', ?, ?, ?, ?, ?, ?, ?)", newGrantId(), person, a.act, a.target, input.threadId, input.messageId, now + TURN_MS, now);
  }
  await keepLinks(ctx, input.threadId, (input.links ?? []) as string[]);
  return { ok: true };
}

/** A person approved a held step: the automation may reach this target from now on, until its definition changes. A step set to ask before sending asks every time. */
export function addStepTargets(ctx: GateCtx, h: Hold): void {
  const step = h.step;
  if (!step || step.ask === true || ctx.principal.kind !== "person") return;
  const targets = targetsOf(h.input);
  for (const target of targets.length > 0 ? targets : [ANY_TARGET]) {
    ctx.db.run("INSERT INTO gate_grants (id, kind, person, act, target, def_hash, subject_id, step_id, created_at) VALUES (?, 'standing', ?, ?, ?, ?, ?, ?, ?)", newGrantId(), ctx.principal.id, h.act, target, step.defHash, step.automationId, step.nodeId, ctx.now());
  }
}
