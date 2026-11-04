// Hooks handlers (lane l-hooks): list, set, remove, pause, runs, the Space switch, and fire (what the engine, the tool session and the CLI shim ask). The rules about who may set what are here, once.
//   Space hooks are an admin's. Person hooks are the person's own. An agent sets hooks only for itself (agent, chat and run scope) and for the helpers it starts (run scope), as checks, notes and its own
//   actions: nothing an agent makes can loosen a Space or person hook, skip the Gate, approve a held act or reach past the agent's own reach, because a hook can only stop work, add a note or run an
//   action through the normal pipeline as the agent. An admin can turn agent-made hooks off for the whole Space.
import { HOOK_EVENTS, HOOK_KINDS, HOOK_SCOPES, plainLine, plainTools, redact } from "../../../lib/hooks.ts";
import { isTenantService, isTrustedService } from "../../../lib/trust.ts";
import type { HookFire } from "../../../lib/hooks.ts";
import { ACTION_DENIED, fire as fireHooks } from "../eval.ts";
import { addPass, PASS_MS, agentHooksOn, allHooks, ensure, helpersActive, hookById, lineage, link, nextSeq, parentOf, raise, setAgentHooks } from "../projections.ts";
import type { HooksCtx, Rec, Spec } from "../projections.ts";

type Row = Record<string, unknown>;
export const MAX_AGENT_HOOKS = 30;

interface Actor { id: string; kind: "person" | "agent" | "trusted"; asker: string; admin: boolean }
/**
 * Who is calling, and whether they may use hooks at all. Every trust decision is lib/trust.ts: a service the host runs (svc_host, svc_engine ...) is trusted, a service a tenant can make (an Automation's
 * svc_<hex>, a form, a site) never is, and any other principal kind is refused. What a trusted service may do:
 *   "fire"  the engine and the MCP session ask hooks.fire for the person whose turn it is (they name the asker);
 *   "read"  it lists hooks, runs and the Space switch (the Console and the engine read what applies);
 *   "none"  it may not set, change, remove, pause, let go by or ask about a hook: those are a person's (and, for its own, an agent's).
 */
function actorOf(ctx: HooksCtx, svc: "none" | "read" | "fire" = "none"): Actor {
  const p = ctx.principal;
  // every service principal is one of the two kinds lib/trust.ts names: a tenant's (refused) or the host's own (trusted)
  if (isTenantService(p as never)) raise(ctx, "permission.no_grant", "That service may not use hooks.");
  if (isTrustedService(p as never)) {
    if (svc === "none") raise(ctx, "permission.no_grant", "Hooks are set by people and their agents, not by a service.");
    return { id: p.id, kind: "trusted", asker: "", admin: false };
  }
  if (p.kind !== "person" && p.kind !== "agent") raise(ctx, "permission.no_grant", "Hooks are for people and their agents.");
  const kind = p.kind === "agent" ? "agent" : "person";
  const asker = kind === "agent" ? (ctx.actingFor ?? "") : p.id;
  const admin = kind === "person" && ctx.authorize?.({ perm: "policy.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
  return { id: p.id, kind, asker, admin };
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
  const line = plainTools(redact((i.summary ?? "").trim() || plainLine({ event: i.event, kind: i.kind, matcher: i.matcher ?? "", ...(spec.instruction ? { instruction: spec.instruction } : {}), ...(spec.cap ? { cap: spec.cap } : {}), ...(spec.command ? { command: spec.command } : {}) }), 200));
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
  const a = actorOf(ctx);
  const h = hookById(ctx, i.id);
  if (!h) return { removed: false };
  mayTouch(ctx, a, h);
  ctx.db.run("UPDATE hooks_hook SET removed_at = ?, updated_at = ? WHERE id = ?", ctx.now(), ctx.now(), h.id);
  await tell(ctx, a, h, "removed", i.threadId);
  return { removed: true };
}
export async function pause(ctx: HooksCtx, i: { id: string; paused: boolean; threadId?: string }): Promise<{ hook: Row }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  const h = hookById(ctx, i.id);
  if (!h) raise(ctx, "validation.not_found", "That hook does not exist.");
  mayTouch(ctx, a, h);
  ctx.db.run("UPDATE hooks_hook SET paused = ?, updated_at = ? WHERE id = ?", i.paused ? 1 : 0, ctx.now(), h.id);
  const now = hookById(ctx, h.id)!;
  await tell(ctx, a, now, i.paused ? "paused" : "resumed", i.threadId);
  return { hook: outRow(now, a) };
}

export async function list(ctx: HooksCtx, i: { scope?: string; threadId?: string; agentId?: string }): Promise<{ hooks: Row[]; agentHooks: boolean }> {
  ensure(ctx.db);
  const a = actorOf(ctx, "read");
  if (i.threadId && !(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  const rows = allHooks(ctx).filter((h) => {
    if (i.scope && h.scope !== i.scope) return false;
    if (h.scope === "space") return true;
    if (h.scope === "person") return h.personId === a.asker || a.kind === "trusted";
    if (h.scope === "agent") return i.agentId !== undefined ? h.agentId === i.agentId : h.agentId === a.id || h.forPerson === a.asker || h.madeBy === a.id;
    if (!i.threadId) return h.madeBy === a.id || h.forPerson === a.asker;
    // the thread's own hooks, and the chat and run hooks of every chat above it: what a helper works under
    return h.threadId === i.threadId || ((h.scope === "run" || h.scope === "chat") && h.threadId !== null && lineage(ctx, i.threadId).includes(h.threadId));
  });
  return { hooks: rows.map((h) => outRow(h, a)), agentHooks: agentHooksOn(ctx) };
}

/** The same rules as changing the hook, for letting it go by once: a person's own press (never an agent), and a Space hook only an admin's. */
export async function allowOnce(ctx: HooksCtx, i: { id: string; threadId: string }): Promise<{ allowed: boolean; expiresAt: number }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (a.kind === "agent") raise(ctx, "permission.no_grant", "Only a person lets a hook go by.");
  const h = hookById(ctx, i.id);
  if (!h) raise(ctx, "validation.not_found", "That hook does not exist.");
  if (!(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  if (h.scope === "space" && !a.admin) raise(ctx, "permission.no_grant", "Only an admin can let a Space hook go by. You can ask one.");
  if (!a.admin && !mayChange(h, a)) raise(ctx, "permission.no_grant", "That hook is not yours to let go by. You can ask an admin.");
  addPass(ctx, h.id, i.threadId, a.id);
  ctx.emit("hook.changed", i.threadId, { hookId: h.id, scope: h.scope, change: "allowed_once", by: a.id, line: h.line, threadId: i.threadId });
  if (ctx.call) { try { await ctx.call("chat.hook_line", { threadId: i.threadId, body: `${a.admin && h.scope === "space" ? "An admin" : "Someone"} let a hook go by once: ${h.line}`, kind: "allowed", hookId: h.id, scope: h.scope, by: a.id, subject: h.line }); } catch { /* the pass stands without its line */ } }
  return { allowed: true, expiresAt: ctx.now() + PASS_MS };
}
export async function askAdmin(ctx: HooksCtx, i: { id: string; threadId: string; note?: string }): Promise<{ asked: boolean }> {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (a.kind === "agent") raise(ctx, "permission.no_grant", "Only a person asks the admins.");
  const h = hookById(ctx, i.id);
  if (!h) raise(ctx, "validation.not_found", "That hook does not exist.");
  if (!(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  const note = i.note ? redact(i.note, 300) : undefined;
  ctx.emit("hook.admin_asked", i.threadId, { hookId: h.id, threadId: i.threadId, line: h.line, by: a.id, ...(note ? { note } : {}) });
  if (ctx.call) { try { await ctx.call("chat.hook_line", { threadId: i.threadId, body: `Someone asked an admin about a hook: ${h.line}`, kind: "asked", hookId: h.id, scope: h.scope, by: a.id, subject: h.line }); } catch { /* the question stands without its line */ } }
  return { asked: true };
}

const runOut = (r: Row): Row => ({ id: r["id"], hookId: r["hook_id"], event: r["event"], threadId: r["thread_id"] ?? undefined, agentId: r["agent_id"] ?? undefined, tool: r["tool"] ?? undefined, outcome: r["outcome"], detail: r["detail"] ?? undefined, ms: r["ms"], at: r["at"] });
const RUN_OUTCOMES = ["ok", "blocked", "note", "error", "timeout", "skipped", "allowed_once"];
/**
 * What the hooks did lately, newest first. The caller sees the runs of hooks they could list: the Space's, their own person hooks, and the agent, chat and run hooks they made or that were made for them.
 * `since` and `outcomes` narrow the log before the limit is taken, so a busy week cannot push the failures out. `scope: "space"` is the admin's Space-wide read: only runs of Space hooks, from every
 * chat. A caller who is not an admin asking for it gets what they could see anyway: a Space hook's run in a chat they cannot use stays hidden.
 */
export async function runsList(ctx: HooksCtx, i: { hookId?: string; threadId?: string; limit?: number; since?: number; outcomes?: string[]; scope?: string }): Promise<{ runs: Row[] }> {
  ensure(ctx.db);
  const a = actorOf(ctx, "read");
  // a person or an agent names what they read (l-hooks): a chat they can use, a hook they may change, or the Space-wide read (l-consolidate), whose runs are filtered below to what they could see anyway
  if (a.kind !== "trusted") {
    if (i.threadId) { if (!(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use."); }
    else if (i.hookId) { const h = hookById(ctx, i.hookId); if (!h || !mayChange(h, a)) raise(ctx, "permission.no_grant", "Name a chat you can use, or a hook you may change."); }
    else if (i.scope !== "space" && !a.admin) raise(ctx, "permission.no_grant", "Name a chat you can use, or a hook you may change.");   // an admin reads the Console list unnamed
  }
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
    if (a.kind === "trusted") return i.scope !== "space" || h.scope === "space";   // a trusted service reads any (lib/trust.ts)
    if (i.scope === "space" && h.scope !== "space") return false;
    if (h.scope === "space") return a.admin || !r["thread_id"] || (await mayUse(String(r["thread_id"])));
    if (h.scope === "person") return h.personId === a.asker;
    return h.madeBy === a.id || h.forPerson === a.asker || (h.madeBy === a.asker && a.kind !== "agent");   // an admin reads Space hooks, never another person's own or their private agents' hooks
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
  return { runs: out.map((r) => ({ id: r["id"], hookId: r["hook_id"], event: r["event"], threadId: r["thread_id"] ?? undefined, agentId: r["agent_id"] ?? undefined, tool: r["tool"] ?? undefined, outcome: r["outcome"], detail: r["detail"] ?? undefined, ms: r["ms"], at: r["at"] })) };
}

/** The newest run of each hook in one chat: one row per hook, so a busy hook never crowds the others out. */
export async function runsLatest(ctx: HooksCtx, i: { threadId: string }): Promise<{ runs: Row[] }> {
  ensure(ctx.db);
  const a = actorOf(ctx, "read");
  if (a.kind !== "trusted" && !(await mayUseThread(ctx, i.threadId))) raise(ctx, "permission.no_grant", "That chat is not one you can use.");
  const rows = ctx.db.all("SELECT * FROM hooks_run WHERE id IN (SELECT MAX(id) FROM hooks_run WHERE thread_id = ? GROUP BY hook_id) ORDER BY id DESC", i.threadId) as Row[];
  return { runs: rows.map(runOut) };
}

export function policyGet(ctx: HooksCtx): { agentHooks: boolean } { actorOf(ctx, "read"); ensure(ctx.db); return { agentHooks: agentHooksOn(ctx) }; }
export function policySet(ctx: HooksCtx, i: { agentHooks: boolean }): { agentHooks: boolean } {
  ensure(ctx.db);
  const a = actorOf(ctx);
  if (!a.admin) raise(ctx, "permission.no_grant", "A Space admin turns agent-made hooks on or off.");
  setAgentHooks(ctx, i.agentHooks);
  ctx.emit("hook.changed", "space", { hookId: "policy", scope: "space", change: i.agentHooks ? "agents_on" : "agents_off", by: a.id, line: i.agentHooks ? "Agents may make hooks" : "Hooks made by agents are off" });
  return { agentHooks: i.agentHooks };
}

/** What the engine, the tool session and the CLI shim ask for. The asker is the caller; the agent and thread are the event's. */
export async function fire(ctx: HooksCtx, i: Omit<HookFire, "asker"> & { asker?: string }): Promise<{ block: { reason: string; hookId: string; by: string; scope: string; next?: Array<{ label: string; ask: string }> } | null; notes: string[]; ran: number }> {
  ensure(ctx.db);
  const a = actorOf(ctx, "fire");
  // a trusted service (the engine) names the person whose turn it is; a person or an agent can only ask for themselves, and only about an agent they can see
  if (a.kind === "trusted") { if (!i.asker || !/^usr_/.test(i.asker)) raise(ctx, "validation.bad_input", "Name the person whose turn it is."); }
  else {
    if (i.asker !== undefined && i.asker !== a.asker) raise(ctx, "permission.no_grant", "You can only ask about your own turns.");
    if (ctx.call && a.kind === "person") { try { await ctx.call("agents.get", { agentId: i.agentId }); } catch { raise(ctx, "permission.no_grant", "That agent is not one you can use."); } }
  }
  const asker = a.kind === "trusted" ? i.asker! : a.asker;
  // a helper's very first call can come before the helper-started event has been folded in: ask the thread itself which chat it works for, so the chat's rules bind it from its first step
  if ((i.threadKind === "helper" || i.threadKind === undefined) && parentOf(ctx, i.threadId) === null && ctx.call) {
    try {
      const t = (await ctx.call("threads.get", { threadId: i.threadId })) as { thread?: { kind?: string; parentThreadId?: string } };
      if (t.thread?.kind === "helper" && typeof t.thread.parentThreadId === "string") link(ctx, i.threadId, t.thread.parentThreadId);
    } catch { /* not readable: the event link, if it comes, will do */ }
  }
  return fireHooks(ctx, { ...i, asker });
}
export { link, helpersActive };
