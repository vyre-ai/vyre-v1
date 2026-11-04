// Hooks handlers (lane l-hooks): list, set, remove, pause, runs, the Space switch, and fire (what the engine, the tool session and the CLI shim ask). The rules about who may set what are here, once.
//   Space hooks are an admin's. Person hooks are the person's own. An agent sets hooks only for itself (agent, chat and run scope) and for the helpers it starts (run scope), as checks, notes and its own
//   actions: nothing an agent makes can loosen a Space or person hook, skip the Gate, approve a held act or reach past the agent's own reach, because a hook can only stop work, add a note or run an
//   action through the normal pipeline as the agent. An admin can turn agent-made hooks off for the whole Space.
import { HOOK_EVENTS, HOOK_KINDS, HOOK_SCOPES, plainLine, redact } from "../../../lib/hooks.ts";
import { isHostService } from "../../../lib/trust.ts";
import type { HookFire } from "../../../agent/src/tools/hooks.ts";
import { ACTION_DENIED, fire as fireHooks } from "../eval.ts";
import { agentHooksOn, allHooks, ensure, helpersActive, hookById, link, nextSeq, parentOf, raise, setAgentHooks } from "../projections.ts";
import type { HooksCtx, Rec, Spec } from "../projections.ts";

type Row = Record<string, unknown>;
export const MAX_AGENT_HOOKS = 30;

interface Actor { id: string; kind: "person" | "agent" | "service"; asker: string; admin: boolean }
function actorOf(ctx: HooksCtx): Actor {
  const kind = ctx.principal.kind === "agent" ? "agent" : isHostService(ctx.principal as never) ? "service" : "person";
  const asker = kind === "agent" ? (ctx.actingFor ?? "") : ctx.principal.id;
  const admin = kind === "service" || (kind === "person" && ctx.authorize?.({ perm: "policy.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow");
  return { id: ctx.principal.id, kind, asker, admin };
}
/** The same rule mayTouch enforces, as a yes or no the screen can show (Remove, or "Only an admin can remove this"). */
function mayChange(h: Rec, a: Actor): boolean {
  if (a.admin) return true;
  if (a.kind === "agent") return h.madeBy === a.id;
  return h.scope !== "space" && (h.madeBy === a.id || h.forPerson === a.id || h.personId === a.id);
}
const outRow = (h: Rec, actor: Actor): Row => ({
  id: h.id, scope: h.scope, event: h.event, kind: h.kind, matcher: h.matcher, line: h.line, paused: h.paused, madeBy: h.madeBy, madeByKind: h.madeByKind,
  ...(h.threadId ? { threadId: h.threadId } : {}), ...(h.agentId ? { agentId: h.agentId } : {}), helpers: h.helpers, timeoutSec: h.timeoutSec, createdAt: h.createdAt, updatedAt: h.updatedAt,
  spec: h.spec, mine: h.madeBy === actor.id || (actor.admin && h.scope === "space"), canChange: mayChange(h, actor), ...(h.endedAt ? { endedAt: h.endedAt } : {}),
});

/** Is this thread one the actor may see and speak in? The threads module decides; this asks it as the same caller. */
async function mayUseThread(ctx: HooksCtx, threadId: string): Promise<boolean> {
  if (!ctx.call) return true;
  try { await ctx.call("threads.get", { threadId }); return true; } catch { return false; }
}
async function nameOf(ctx: HooksCtx, agentId: string): Promise<string> {
  try { return ((await ctx.call?.("agents.get", { agentId })) as { agent?: { name?: string } } | undefined)?.agent?.name || "Assistant"; } catch { return "Assistant"; }
}
async function tell(ctx: HooksCtx, a: Actor, h: Rec, did: "added" | "changed" | "removed" | "paused" | "resumed", threadId: string | undefined): Promise<void> {
  ctx.emit("hook.changed", h.threadId ?? threadId ?? h.id, { hookId: h.id, scope: h.scope, change: did, by: h.madeBy, line: h.line, ...(h.threadId ? { threadId: h.threadId } : {}), ...(h.agentId ? { agentId: h.agentId } : {}) });
  const where = threadId ?? h.threadId;
  if (!where || !ctx.call) return;
  const who = a.kind === "agent" ? await nameOf(ctx, a.id) : a.admin && h.scope === "space" ? "An admin" : "Someone";
  const place = h.scope === "chat" || h.scope === "run" ? " in this chat" : h.scope === "space" ? " for the Space" : h.scope === "agent" ? " for this agent" : " for you";
  const verb = { added: "added a hook", changed: "changed a hook", removed: "removed a hook", paused: "paused a hook", resumed: "turned a hook back on" }[did];
  try { await ctx.call("chat.hook_line", { threadId: where, body: `${who} ${verb}${place}: ${h.line}`, kind: did, hookId: h.id, scope: h.scope, by: h.madeBy, byKind: h.madeByKind }); } catch (e) { ctx.log?.warn("a hook line was not posted", { error: e instanceof Error ? e.message : String(e) }); }
}

export interface SetIn {
  id?: string; scope: string; event: string; kind: string; matcher?: string; command?: string; args?: string[]; instruction?: string; cap?: string; input?: unknown; timeoutSec?: number; summary?: string;
  threadId?: string; agentId?: string; helpers?: boolean; paused?: boolean;
}

function clean(ctx: HooksCtx, i: SetIn): { spec: Spec; line: string; timeoutSec: number } {
  if (!(HOOK_EVENTS as readonly string[]).includes(i.event)) raise(ctx, "validation.bad_input", `A hook is on one of: ${HOOK_EVENTS.join(", ")}.`);
  if (!(HOOK_KINDS as readonly string[]).includes(i.kind)) raise(ctx, "validation.bad_input", "A hook is a command, a check or an action.");
  const timeoutSec = Math.min(60, Math.max(1, Math.round(i.timeoutSec ?? 20)));
  let spec: Spec;
  if (i.kind === "command") {
    if (!i.command || i.command.trim() === "" || i.command.length > 2000) raise(ctx, "validation.bad_input", "A command hook needs the command to run.");
    spec = { command: i.command.trim(), ...(i.args?.length ? { args: i.args.map(String).slice(0, 40) } : {}) };
  } else if (i.kind === "check") {
    const text = (i.instruction ?? "").trim();
    if (text === "" || text.length > 1000) raise(ctx, "validation.bad_input", "A check hook needs a short instruction, up to 1000 characters.");
    spec = { instruction: text };
  } else {
    const cap = (i.cap ?? "").trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(cap)) raise(ctx, "validation.bad_input", "An action hook names one capability, like chat.post.");
    if (ACTION_DENIED.test(cap)) raise(ctx, "permission.no_grant", "A hook cannot approve, grant or change hooks, settings or access.");
    spec = { cap, input: i.input ?? {} };
  }
  const line = redact((i.summary ?? "").trim() || plainLine({ event: i.event, kind: i.kind, matcher: i.matcher ?? "", ...(spec.instruction ? { instruction: spec.instruction } : {}), ...(spec.cap ? { cap: spec.cap } : {}), ...(spec.command ? { command: spec.command } : {}) }), 200);
  return { spec, line, timeoutSec };
}

export async function set(ctx: HooksCtx, i: SetIn): Promise<{ hook: Row }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (!(HOOK_SCOPES as readonly string[]).includes(i.scope)) raise(ctx, "validation.bad_input", `A hook is for: ${HOOK_SCOPES.join(", ")}.`);
  const { spec, line, timeoutSec } = clean(ctx, i);
  const now = ctx.now();
  const existing = i.id ? hookById(ctx, i.id) : null;
  if (i.id && !existing) raise(ctx, "validation.not_found", "That hook does not exist.");
  if (a.kind === "agent") {
    if (!agentHooksOn(ctx)) raise(ctx, "permission.no_grant", "Your admin turned off hooks made by agents in this Space.");
    if (i.scope === "space" || i.scope === "person") raise(ctx, "permission.no_grant", "An agent can add hooks for itself, a chat it is in, or its own run. Space and person hooks are a person's.");
    if (i.agentId !== undefined && i.agentId !== a.id) raise(ctx, "permission.no_grant", "An agent sets hooks for itself only.");
    if (existing && (existing.madeBy !== a.id)) raise(ctx, "permission.no_grant", "An agent changes only the hooks it made.");
    const mine = allHooks(ctx).filter((h) => h.madeBy === a.id).length;
    if (!existing && mine >= MAX_AGENT_HOOKS) raise(ctx, "permission.limit", `An agent keeps at most ${MAX_AGENT_HOOKS} hooks. Remove one first.`);
  } else if (i.scope === "space" && !a.admin) raise(ctx, "permission.no_grant", "Space hooks are set by a Space admin.");
  else if (existing && !(a.admin || existing.madeBy === a.id || existing.forPerson === a.id)) raise(ctx, "permission.no_grant", "That hook is not yours to change.");
  else if (existing && existing.scope === "space" && !a.admin) raise(ctx, "permission.no_grant", "Space hooks are set by a Space admin.");

  const where = i.threadId ?? existing?.threadId ?? undefined;
  if ((i.scope === "chat" || i.scope === "run") && !where) raise(ctx, "validation.bad_input", "Say which chat this hook is for.");
  if (where && !(await mayUseThread(ctx, where))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  const agentId = a.kind === "agent" ? a.id : i.scope === "agent" ? i.agentId ?? null : i.agentId ?? null;
  if (i.scope === "agent" && !agentId) raise(ctx, "validation.bad_input", "Say which agent this hook is for.");
  if (a.kind === "person" && i.scope === "agent" && agentId && ctx.authorize && ctx.authorize({ perm: null, level: "manage" }, { type: "agent", id: agentId }).effect !== "allow" && !a.admin) raise(ctx, "permission.no_grant", "You can set hooks for agents you manage.");
  const madeByKind: Rec["madeByKind"] = a.kind === "agent" ? "agent" : a.admin && i.scope === "space" ? "admin" : "person";
  const personId = i.scope === "person" ? a.asker : null;
  if (i.scope === "person" && a.kind === "agent") raise(ctx, "permission.no_grant", "An agent cannot set a person's hooks.");

  if (existing) {
    ctx.db.run("UPDATE hooks_hook SET event = ?, kind = ?, matcher = ?, spec = ?, timeout_sec = ?, line = ?, helpers = ?, paused = ?, updated_at = ? WHERE id = ?",
      i.event, i.kind, i.matcher ?? "", JSON.stringify(spec), timeoutSec, line, (i.helpers ?? existing.helpers) ? 1 : 0, (i.paused ?? existing.paused) ? 1 : 0, now, existing.id);
    const h = hookById(ctx, existing.id)!;
    await tell(ctx, a, h, "changed", i.threadId);
    return { hook: outRow(h, a) };
  }
  const id = `hok_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  ctx.db.run(
    "INSERT INTO hooks_hook (id, scope, person_id, agent_id, thread_id, helpers, event, kind, matcher, spec, timeout_sec, paused, line, made_by, made_by_kind, for_person, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)",
    id, i.scope, personId, i.scope === "space" || i.scope === "person" || (i.scope === "run" && where && parentOf(ctx, where) !== null) ? null : agentId, i.scope === "chat" || i.scope === "run" ? where ?? null : null, (i.helpers ?? true) ? 1 : 0, i.event, i.kind, i.matcher ?? "", JSON.stringify(spec), timeoutSec, line,
    a.id, madeByKind, a.kind === "agent" ? a.asker || null : null, nextSeq(ctx), now, now,
  );
  const h = hookById(ctx, id)!;
  await tell(ctx, a, h, "added", i.threadId);
  return { hook: outRow(h, a) };
}

function mayTouch(ctx: HooksCtx, a: Actor, h: Rec): void {
  if (a.admin) return;
  if (a.kind === "agent") { if (h.madeBy !== a.id) raise(ctx, "permission.no_grant", "An agent changes only the hooks it made."); return; }
  if (h.scope === "space") raise(ctx, "permission.no_grant", "Space hooks are set by a Space admin.");
  if (h.madeBy !== a.id && h.forPerson !== a.id && h.personId !== a.id) raise(ctx, "permission.no_grant", "That hook is not yours to change.");
}
export async function remove(ctx: HooksCtx, i: { id: string; threadId?: string }): Promise<{ removed: boolean }> {
  ensure(ctx.db);
  const h = hookById(ctx, i.id);
  if (!h) return { removed: false };
  const a = actorOf(ctx);
  mayTouch(ctx, a, h);
  ctx.db.run("UPDATE hooks_hook SET removed_at = ?, updated_at = ? WHERE id = ?", ctx.now(), ctx.now(), h.id);
  await tell(ctx, a, h, "removed", i.threadId);
  return { removed: true };
}
export async function pause(ctx: HooksCtx, i: { id: string; paused: boolean; threadId?: string }): Promise<{ hook: Row }> {
  ensure(ctx.db);
  const h = hookById(ctx, i.id);
  if (!h) raise(ctx, "validation.not_found", "That hook does not exist.");
  const a = actorOf(ctx);
  mayTouch(ctx, a, h);
  ctx.db.run("UPDATE hooks_hook SET paused = ?, updated_at = ? WHERE id = ?", i.paused ? 1 : 0, ctx.now(), h.id);
  const now = hookById(ctx, h.id)!;
  await tell(ctx, a, now, i.paused ? "paused" : "resumed", i.threadId);
  return { hook: outRow(now, a) };
}

export async function list(ctx: HooksCtx, i: { scope?: string; threadId?: string; agentId?: string }): Promise<{ hooks: Row[]; agentHooks: boolean }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (i.threadId && !(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  const rows = allHooks(ctx).filter((h) => {
    if (i.scope && h.scope !== i.scope) return false;
    if (h.scope === "space") return true;
    if (h.scope === "person") return h.personId === a.asker || a.kind === "service";
    if (h.scope === "agent") return i.agentId !== undefined ? h.agentId === i.agentId : h.agentId === a.id || h.forPerson === a.asker || h.madeBy === a.id;
    if (!i.threadId) return h.madeBy === a.id || h.forPerson === a.asker;
    return h.threadId === i.threadId || (h.scope === "run" && h.threadId !== null && parentOf(ctx, i.threadId) === h.threadId);
  });
  return { hooks: rows.map((h) => outRow(h, a)), agentHooks: agentHooksOn(ctx) };
}

const RUN_OUTCOMES = ["ok", "blocked", "note", "error", "timeout", "skipped"];
/**
 * What the hooks did lately, newest first. The caller sees the runs of hooks they could list: the Space's, their own person hooks, and the agent, chat and run hooks they made or that were made for them.
 * `since` and `outcomes` narrow the log before the limit is taken, so a busy week cannot push the failures out. `scope: "space"` is the admin's Space-wide read: only runs of Space hooks, from every
 * chat. A caller who is not an admin asking for it gets what they could see anyway: a Space hook's run in a chat they cannot use stays hidden.
 */
export async function runsList(ctx: HooksCtx, i: { hookId?: string; threadId?: string; limit?: number; since?: number; outcomes?: string[]; scope?: string }): Promise<{ runs: Row[] }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  const outcomes = (i.outcomes ?? []).filter((o) => RUN_OUTCOMES.includes(o));
  const where = [i.hookId ? "hook_id = ?" : "", i.threadId ? "thread_id = ?" : "", i.since !== undefined ? "at >= ?" : "", i.outcomes ? `outcome IN (${outcomes.length ? outcomes.map(() => "?").join(", ") : "NULL"})` : ""].filter(Boolean);
  const args = [i.hookId, i.threadId, i.since].filter((x): x is string | number => x !== undefined);
  const cap = Math.min(200, Math.max(1, i.limit ?? 50));
  const hooks = new Map(allHooks(ctx).map((h) => [h.id, h]));
  const usable = new Map<string, boolean>();
  const mayUse = async (threadId: string): Promise<boolean> => { if (!usable.has(threadId)) usable.set(threadId, await mayUseThread(ctx, threadId)); return usable.get(threadId)!; };
  const seen = async (r: Row): Promise<boolean> => {
    const h = hooks.get(String(r["hook_id"]));
    if (!h) return false;
    if (i.scope === "space" && h.scope !== "space") return false;
    if (h.scope === "space") return a.admin || !r["thread_id"] || (await mayUse(String(r["thread_id"])));
    if (h.scope === "person") return h.personId === a.asker || a.kind === "service";
    return h.madeBy === a.id || h.forPerson === a.asker || (h.madeBy === a.asker && a.kind !== "agent");
  };
  const out: Row[] = [];
  let before = Number.MAX_SAFE_INTEGER;
  // read in pages so a long log of runs this caller cannot see still gives them up to `limit` of their own
  for (let page = 0; page < 10 && out.length < cap; page++) {
    const rows = ctx.db.all(`SELECT * FROM hooks_run WHERE id < ?${where.length ? ` AND ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 200`, before, ...args, ...(i.outcomes ? outcomes : [])) as Row[];
    for (const r of rows) { if (out.length < cap && (await seen(r))) out.push(r); }
    if (rows.length < 200) break;
    before = Number(rows[rows.length - 1]!["id"]);
  }
  return { runs: out.map((r) => ({ id: r["id"], hookId: r["hook_id"], event: r["event"], threadId: r["thread_id"] ?? undefined, agentId: r["agent_id"] ?? undefined, outcome: r["outcome"], detail: r["detail"] ?? undefined, ms: r["ms"], at: r["at"] })) };
}

export function policyGet(ctx: HooksCtx): { agentHooks: boolean } { ensure(ctx.db); return { agentHooks: agentHooksOn(ctx) }; }
export function policySet(ctx: HooksCtx, i: { agentHooks: boolean }): { agentHooks: boolean } {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (!a.admin) raise(ctx, "permission.no_grant", "A Space admin turns agent-made hooks on or off.");
  setAgentHooks(ctx, i.agentHooks);
  ctx.emit("hook.changed", "space", { hookId: "policy", scope: "space", change: i.agentHooks ? "agents_on" : "agents_off", by: a.id, line: i.agentHooks ? "Agents may make hooks" : "Hooks made by agents are off" });
  return { agentHooks: i.agentHooks };
}

/** What the engine, the tool session and the CLI shim ask for. The asker is the caller; the agent and thread are the event's. */
export async function fire(ctx: HooksCtx, i: Omit<HookFire, "asker"> & { asker?: string }): Promise<{ block: { reason: string; hookId: string; by: string; scope: string } | null; notes: string[]; ran: number }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  const asker = a.kind === "agent" ? a.asker : a.id;
  return fireHooks(ctx, { ...i, asker });
}
export { link, helpersActive };
