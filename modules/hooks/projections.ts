// Hooks projections (lane l-hooks): the hook rows, which ones apply to one event, the helper links, the Space switch and the run log. Every statement names only hooks_* tables (ctx.db refuses
// anything else, ARCH B2).
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { scopeRank } from "../../lib/hooks.ts";

export interface Db { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } }
export interface HooksCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  origin?: string;
  depth?: number;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown, opts?: { idempotencyKey?: string }): unknown;
  call?(cap: string, input: unknown, opts?: { idempotencyKey?: string }): Promise<unknown>;
  authorize?(action: { perm: string | null; level: string }, resource: { type: string; id: string | null }): { effect: string };
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

const SCHEMA = readFileSync(new URL("./migrations/0001_hooks.sql", import.meta.url), "utf8")
  .split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => s.length > 0);
const ready = new WeakSet<object>();
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try { for (const q of ["SELECT id FROM hooks_hook WHERE id = ?", "SELECT helper_thread FROM hooks_link WHERE helper_thread = ?", "SELECT key FROM hooks_policy WHERE key = ?", "SELECT id FROM hooks_run WHERE id = ?", "SELECT id FROM hooks_pass WHERE id = ?"]) db.all(q, "probe"); }
  catch { for (const s of SCHEMA) db.run(s); }
  ready.add(db);
}

export interface Spec { command?: string; args?: string[]; instruction?: string; cap?: string; input?: unknown }
export interface Rec {
  id: string; scope: string; personId: string | null; agentId: string | null; threadId: string | null; helpers: boolean; event: string; kind: string; matcher: string; spec: Spec;
  timeoutSec: number; paused: boolean; line: string; madeBy: string; madeByKind: "admin" | "person" | "agent"; forPerson: string | null; seq: number; createdAt: number; updatedAt: number; endedAt: number | null;
}
type Row = Record<string, unknown>;
const json = (s: unknown): Spec => { try { return JSON.parse(String(s)) as Spec; } catch { return {}; } };
export function recOf(r: Row): Rec {
  return {
    id: r["id"] as string, scope: r["scope"] as string, personId: (r["person_id"] as string | null) ?? null, agentId: (r["agent_id"] as string | null) ?? null, threadId: (r["thread_id"] as string | null) ?? null,
    helpers: r["helpers"] === 1, event: r["event"] as string, kind: r["kind"] as string, matcher: r["matcher"] as string, spec: json(r["spec"]), timeoutSec: r["timeout_sec"] as number,
    paused: r["paused"] === 1, line: r["line"] as string, madeBy: r["made_by"] as string, madeByKind: r["made_by_kind"] as Rec["madeByKind"], forPerson: (r["for_person"] as string | null) ?? null,
    seq: r["seq"] as number, createdAt: r["created_at"] as number, updatedAt: r["updated_at"] as number, endedAt: (r["ended_at"] as number | null) ?? null,
  };
}
export function hookById(ctx: HooksCtx, id: string): Rec | null {
  ensure(ctx.db);
  const r = ctx.db.all("SELECT * FROM hooks_hook WHERE id = ? AND removed_at IS NULL", id)[0] as Row | undefined;
  return r ? recOf(r) : null;
}
export const allHooks = (ctx: HooksCtx): Rec[] => { ensure(ctx.db); return (ctx.db.all("SELECT * FROM hooks_hook WHERE removed_at IS NULL ORDER BY seq") as Row[]).map(recOf); };
export function nextSeq(ctx: HooksCtx): number {
  const r = ctx.db.all("SELECT MAX(seq) AS m FROM hooks_hook")[0] as Row | undefined;
  return (Number(r?.["m"] ?? 0) || 0) + 1;
}

// ---- helper links ----
export function link(ctx: HooksCtx, helper: string, parent: string): void {
  ensure(ctx.db);
  ctx.db.run("INSERT OR REPLACE INTO hooks_link (helper_thread, parent_thread, done, at) VALUES (?, ?, 0, ?)", helper, parent, ctx.now());
}
export function parentOf(ctx: HooksCtx, thread: string): string | null {
  ensure(ctx.db);
  return ((ctx.db.all("SELECT parent_thread FROM hooks_link WHERE helper_thread = ?", thread)[0] as Row | undefined)?.["parent_thread"] as string | undefined) ?? null;
}
/** The thread and every thread above it that started it, nearest first. */
export function lineage(ctx: HooksCtx, thread: string): string[] {
  const out = [thread];
  for (let p = parentOf(ctx, thread); p !== null && !out.includes(p) && out.length < 12; p = parentOf(ctx, p)) out.push(p);
  return out;
}
export function helpersActive(ctx: HooksCtx, parent: string): number {
  ensure(ctx.db);
  return Number((ctx.db.all("SELECT COUNT(*) AS n FROM hooks_link WHERE parent_thread = ? AND done = 0", parent)[0] as Row | undefined)?.["n"] ?? 0);
}

// ---- the Space switch ----
export function agentHooksOn(ctx: HooksCtx): boolean {
  ensure(ctx.db);
  return (ctx.db.all("SELECT value FROM hooks_policy WHERE key = 'agent_hooks'")[0] as Row | undefined)?.["value"] !== "off";
}
export function setAgentHooks(ctx: HooksCtx, on: boolean): void {
  ensure(ctx.db);
  ctx.db.run("INSERT OR REPLACE INTO hooks_policy (key, value) VALUES ('agent_hooks', ?)", on ? "on" : "off");
}

/**
 * The hooks that apply to one event of one agent in one thread, in the order they run: Space, person, agent, chat, run; within a scope, oldest first. A paused hook and, while an admin has agent-made
 * hooks off, an agent-made hook is left out. Run hooks reach the thread that set them and every helper under it (unless the hook is only for the thread itself).
 */
export function applicable(ctx: HooksCtx, q: { event: string; agentId: string; asker: string; threadId: string }): Rec[] {
  const agentOk = agentHooksOn(ctx);
  const chain = lineage(ctx, q.threadId);
  const out = allHooks(ctx).filter((h) => {
    if (h.paused || h.event !== q.event) return false;
    if (h.madeByKind === "agent" && !agentOk) return false;
    switch (h.scope) {
      case "space": return true;
      case "person": return h.personId === q.asker;
      case "agent": return h.agentId === q.agentId;
      case "chat": return h.threadId === q.threadId && (h.agentId === null || h.agentId === q.agentId);
      case "run": return h.threadId !== null && chain.includes(h.threadId) && (h.endedAt === null || h.threadId !== q.threadId) && (h.threadId === q.threadId || h.helpers) && (h.agentId === null || h.agentId === q.agentId || h.threadId !== q.threadId);
      default: return false;
    }
  });
  return out.sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || a.seq - b.seq);
}

// ---- runs ----
export function logRun(ctx: HooksCtx, r: { hookId: string; event: string; threadId: string; agentId: string; tool?: string; outcome: string; detail?: string; ms: number }): void {
  ensure(ctx.db);
  ctx.db.run("INSERT INTO hooks_run (hook_id, event, thread_id, agent_id, tool, outcome, detail, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.hookId, r.event, r.threadId, r.agentId, r.tool ?? null, r.outcome, r.detail ?? null, r.ms, ctx.now());
  // a short log: the newest 500
  ctx.db.run("DELETE FROM hooks_run WHERE id <= (SELECT MAX(id) FROM hooks_run) - 500");
}

// ---- "run once anyway" ----
export const PASS_MS = 10 * 60_000;
export function addPass(ctx: HooksCtx, hookId: string, threadId: string, by: string): void {
  ensure(ctx.db);
  ctx.db.run("INSERT INTO hooks_pass (hook_id, thread_id, by, expires_at) VALUES (?, ?, ?, ?)", hookId, threadId, by, ctx.now() + PASS_MS);
}
/** Uses up a live pass for this hook in this chat: true when there was one (the hook is let go by this once). */
export function takePass(ctx: HooksCtx, hookId: string, threadId: string): boolean {
  ensure(ctx.db);
  const r = ctx.db.all("SELECT id FROM hooks_pass WHERE hook_id = ? AND thread_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id LIMIT 1", hookId, threadId, ctx.now())[0] as Row | undefined;
  if (!r) return false;
  ctx.db.run("UPDATE hooks_pass SET used_at = ? WHERE id = ? AND used_at IS NULL", ctx.now(), r["id"]);
  return true;
}
