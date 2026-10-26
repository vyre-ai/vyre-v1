// AI spend (spec 3.10, 4.14; ARCH 7.10): caps by scope (Space, person, agent), pause-all, "Raise once or for good", usage by day, person, agent or model,
// and the meter the turn worker calls while a turn runs (engine.turn.record_usage). A turn over a limit is stopped, agent.limit_hit is raised and a
// Needs you card "<agent> hit its daily limit: Raise once or Stop" is created for the person who pays. Money is in micros of a dollar.
import { actorOf, boundEngine, dayKey, dayStart, ensure, monthKey, monthStart, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

export type Scope = "space" | "person" | "agent";
export type LimitKind = "run" | "day" | "month" | "turns" | "time";
export interface Caps { run?: number; dayMicros?: number; monthMicros?: number; turnsPerDay?: number; timeMinutesPerRun?: number }

type Row = Record<string, unknown>;
const rows = (ctx: EngineCtx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const n = (v: unknown): number => Number(v ?? 0);

const CAP_FIELD: Readonly<Record<LimitKind, keyof Caps>> = { run: "run", day: "dayMicros", month: "monthMicros", turns: "turnsPerDay", time: "timeMinutesPerRun" };
const LIMIT_WORD: Readonly<Record<LimitKind, string>> = { run: "per-run", day: "daily", month: "monthly", turns: "daily turn", time: "time" };
const ORDER: readonly LimitKind[] = ["run", "day", "month", "turns", "time"];

function scopeKey(ctx: EngineCtx, scope: Scope, scopeId: string | undefined): string {
  if (scope === "space") return "";
  if (scopeId === undefined || scopeId === "") {
    if (scope === "person") return actorOf(ctx);
    raise(ctx, "validation.bad_input", "Name the agent whose spend this is.", { scope });
  }
  return scopeId;
}

function readCaps(ctx: EngineCtx, scope: Scope, scopeId: string): Caps {
  const r = rows(ctx, "SELECT caps FROM engine_spend_caps WHERE scope = ? AND scope_id = ?", scope, scopeId)[0];
  return r ? (JSON.parse(String(r["caps"])) as Caps) : {};
}

function writeCaps(ctx: EngineCtx, scope: Scope, scopeId: string, caps: Caps): void {
  ctx.db.run("INSERT OR REPLACE INTO engine_spend_caps (scope, scope_id, caps, updated_at) VALUES (?, ?, ?, ?)", scope, scopeId, JSON.stringify(caps), ctx.now());
}

/** The period a limit counts over: a day, or a month for the month limit. */
const periodOf = (limit: LimitKind, at: number): string => (limit === "month" ? monthKey(at) : dayKey(at));

function raisedBy(ctx: EngineCtx, scope: Scope, scopeId: string, limit: LimitKind, at: number): number {
  return n(rows(ctx, "SELECT COALESCE(SUM(amount), 0) AS total FROM engine_raises WHERE scope = ? AND scope_id = ? AND limit_kind = ? AND period = ?", scope, scopeId, limit, periodOf(limit, at))[0]?.["total"]);
}

/** Which usage rows belong to a scope. */
function scopeWhere(scope: Scope, scopeId: string): { sql: string; args: unknown[] } {
  if (scope === "person") return { sql: " AND person_id = ?", args: [scopeId] };
  if (scope === "agent") return { sql: " AND agent_id = ?", args: [scopeId] };
  return { sql: "", args: [] };
}

function totals(ctx: EngineCtx, scope: Scope, scopeId: string, since: number): { cost: number; turns: number } {
  const w = scopeWhere(scope, scopeId);
  const r = rows(ctx, `SELECT COALESCE(SUM(cost_micros), 0) AS cost, COUNT(*) AS turns FROM engine_usage WHERE at >= ?${w.sql}`, since, ...w.args)[0];
  return { cost: n(r?.["cost"]), turns: n(r?.["turns"]) };
}

function pausedState(ctx: EngineCtx): { paused: boolean; by?: string } {
  const r = rows(ctx, "SELECT paused, paused_by FROM engine_spend_state WHERE id = ?", "space")[0];
  if (!r || n(r["paused"]) !== 1) return { paused: false };
  return r["paused_by"] === null || r["paused_by"] === undefined ? { paused: true } : { paused: true, by: String(r["paused_by"]) };
}

/** True while all AI spend is paused. The turn worker checks it before it starts a turn. */
export function isPaused(ctx: EngineCtx): boolean {
  ensure(ctx.db);
  return pausedState(ctx).paused;
}

// ---- spend.get, caps.set, pause, resume, raise

export function spendGet(ctx: EngineCtx, input: { scope: Scope; scopeId?: string }): {
  caps: Caps; todayMicros: number; monthMicros: number; turnsToday: number; paused: boolean; pausedBy?: string;
} {
  ensure(ctx.db);
  const id = scopeKey(ctx, input.scope, input.scopeId);
  const at = ctx.now();
  const today = totals(ctx, input.scope, id, dayStart(at));
  const month = totals(ctx, input.scope, id, monthStart(at));
  const p = pausedState(ctx);
  return { caps: readCaps(ctx, input.scope, id), todayMicros: today.cost, monthMicros: month.cost, turnsToday: today.turns, paused: p.paused, ...(p.by === undefined ? {} : { pausedBy: p.by }) };
}

export function capsSet(ctx: EngineCtx, input: { scope: Scope; scopeId?: string; caps: Caps }): { caps: Caps } {
  ensure(ctx.db);
  const id = scopeKey(ctx, input.scope, input.scopeId);
  const clean: Caps = {};
  for (const limit of ORDER) {
    const field = CAP_FIELD[limit];
    const v = input.caps[field];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 0) raise(ctx, "validation.bad_input", `${field} must be a whole number, zero or more.`, { field });
    clean[field] = v;
  }
  // The Space is the ceiling: a person or an agent cap above it would never be reached. Refuse it so the page shows what really applies.
  if (input.scope !== "space") {
    const space = readCaps(ctx, "space", "");
    for (const limit of ORDER) {
      const field = CAP_FIELD[limit];
      const ceiling = space[field], v = clean[field];
      if (ceiling !== undefined && v !== undefined && v > ceiling) {
        raise(ctx, "validation.bad_input", `The Space cap for ${field} is ${ceiling}; a ${input.scope} cap cannot exceed it.`, { field, ceiling });
      }
    }
  }
  writeCaps(ctx, input.scope, id, clean);
  ctx.emit("spend.caps_changed", input.scope, { scope: input.scope, ...(id === "" ? {} : { scopeId: id }), by: actorOf(ctx) });
  return { caps: clean };
}

export function pauseAll(ctx: EngineCtx, input: { reason?: string }): { paused: boolean } {
  ensure(ctx.db);
  ctx.db.run("INSERT OR REPLACE INTO engine_spend_state (id, paused, paused_by, reason, at) VALUES (?, 1, ?, ?, ?)", "space", actorOf(ctx), input.reason ?? null, ctx.now());
  ctx.emit("spend.paused", actorOf(ctx), { by: actorOf(ctx), ...(input.reason === undefined ? {} : { reason: input.reason }) });
  return { paused: true };
}

export function resumeAll(ctx: EngineCtx, _input: Record<string, never>): { paused: boolean } {
  ensure(ctx.db);
  ctx.db.run("INSERT OR REPLACE INTO engine_spend_state (id, paused, paused_by, reason, at) VALUES (?, 0, NULL, NULL, ?)", "space", ctx.now());
  ctx.emit("spend.resumed", actorOf(ctx), { by: actorOf(ctx) });
  return { paused: false };
}

/**
 * Raise a limit. "Once" adds headroom for the current period only; "permanent" changes the cap. Without an amount, the raise is the size of the cap (it doubles).
 * The Needs you card of that limit is closed here, so the next hit opens a fresh one.
 */
export function raiseLimit(
  ctx: EngineCtx,
  input: { scope: Scope; scopeId?: string; limit: LimitKind; mode: "once" | "permanent"; amountMicros?: number },
): { raised: boolean } {
  ensure(ctx.db);
  const id = scopeKey(ctx, input.scope, input.scopeId);
  const caps = readCaps(ctx, input.scope, id);
  const field = CAP_FIELD[input.limit];
  const current = caps[field];
  if (input.amountMicros !== undefined && (!Number.isInteger(input.amountMicros) || input.amountMicros <= 0)) raise(ctx, "validation.bad_input", "The amount must be more than zero.", { field: "amountMicros" });
  if (current === undefined && input.amountMicros === undefined) raise(ctx, "validation.precondition_failed", "There is no cap to raise.", { limit: input.limit });
  const amount = input.amountMicros ?? current ?? 0;
  if (input.mode === "permanent") {
    const next: Caps = { ...caps };
    next[field] = input.amountMicros ?? (current ?? 0) * 2;
    writeCaps(ctx, input.scope, id, next);
  } else {
    ctx.db.run("INSERT INTO engine_raises (scope, scope_id, limit_kind, period, amount, by_principal, at) VALUES (?, ?, ?, ?, ?, ?, ?)", input.scope, id, input.limit, periodOf(input.limit, ctx.now()), amount, actorOf(ctx), ctx.now());
  }
  ctx.db.run("DELETE FROM engine_limit_cards WHERE card_key LIKE ?", `${input.scope}:${id}:${input.limit}:%`);
  ctx.emit("spend.raised", input.scope, { scope: input.scope, ...(id === "" ? {} : { scopeId: id }), limit: input.limit, mode: input.mode, by: actorOf(ctx) });
  return { raised: true };
}

// ---- usage.query

type UsageBy = "day" | "person" | "agent" | "model";
interface UsageTotals { turns: number; tokensIn: number; tokensOut: number; costMicros: number }

export function usageQuery(ctx: EngineCtx, input: { by: UsageBy; from?: number; to?: number; personId?: string; agentId?: string; itemId?: string }): {
  rows: Array<{ key: string; title: string; totals: UsageTotals }>; totals: UsageTotals;
} {
  ensure(ctx.db);
  // People see their own; managers of AI spend see everyone.
  const sees = ctx.authorize({ perm: "ai.spend", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
  const me = actorOf(ctx);
  const clauses: string[] = ["at >= ?", "at <= ?"];
  const args: unknown[] = [input.from ?? 0, input.to ?? Number.MAX_SAFE_INTEGER];
  const person = sees ? input.personId : me;
  if (person !== undefined) { clauses.push("person_id = ?"); args.push(person); }
  if (sees && input.agentId !== undefined) { clauses.push("agent_id = ?"); args.push(input.agentId); }
  // only the turns that ran on this Vault item; people still see their own turns only (the person clause above)
  if (input.itemId !== undefined) { clauses.push("turn_id IN (SELECT turn_id FROM engine_usage_item WHERE item_id = ?)"); args.push(input.itemId); }
  const key = input.by === "day" ? "strftime('%Y-%m-%d', at / 1000, 'unixepoch')" : input.by === "person" ? "person_id" : input.by === "agent" ? "agent_id" : "model";
  const out = rows(
    ctx,
    `SELECT ${key} AS k, COUNT(*) AS turns, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout, COALESCE(SUM(cost_micros), 0) AS cost
     FROM engine_usage WHERE ${clauses.join(" AND ")} GROUP BY k ORDER BY k ${input.by === "day" ? "DESC" : "ASC"}`,
    ...args,
  );
  const sum: UsageTotals = { turns: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 };
  const list = out.map((r) => {
    const t: UsageTotals = { turns: n(r["turns"]), tokensIn: n(r["tin"]), tokensOut: n(r["tout"]), costMicros: n(r["cost"]) };
    sum.turns += t.turns; sum.tokensIn += t.tokensIn; sum.tokensOut += t.tokensOut; sum.costMicros += t.costMicros;
    return { key: String(r["k"]), title: String(r["k"]), totals: t };
  });
  return { rows: list, totals: sum };
}

// ---- engine.turn.record_usage

interface Hit { scope: Scope; scopeId: string; limit: LimitKind; used: number; cap: number }

function firstHit(ctx: EngineCtx, turn: { id: string; agentId: string; asker: string; startedAt: number }, at: number): Hit | null {
  const scopes: Array<{ scope: Scope; id: string }> = [{ scope: "agent", id: turn.agentId }, { scope: "person", id: turn.asker }, { scope: "space", id: "" }];
  const own = n(rows(ctx, "SELECT cost_micros FROM engine_usage WHERE turn_id = ?", turn.id)[0]?.["cost_micros"]);
  for (const s of scopes) {
    const caps = readCaps(ctx, s.scope, s.id);
    for (const limit of ORDER) {
      const base = caps[CAP_FIELD[limit]];
      if (base === undefined) continue;
      const cap = base + raisedBy(ctx, s.scope, s.id, limit, at);
      let used: number;
      let over: boolean;
      if (limit === "run") { used = own; over = used >= cap; }
      else if (limit === "day") { used = totals(ctx, s.scope, s.id, dayStart(at)).cost; over = used >= cap; }
      else if (limit === "month") { used = totals(ctx, s.scope, s.id, monthStart(at)).cost; over = used >= cap; }
      else if (limit === "turns") { used = totals(ctx, s.scope, s.id, dayStart(at)).turns; over = used > cap; }
      else { used = Math.floor((at - turn.startedAt) / 60_000); over = used >= cap; }
      if (over) return { scope: s.scope, scopeId: s.id, limit, used, cap };
    }
  }
  return null;
}

/** The Needs you card for a limit hit: one per scope, limit and period. */
async function limitCard(ctx: EngineCtx, hit: Hit, who: { agentId: string; threadId: string; asker: string }, at: number): Promise<string | undefined> {
  const key = `${hit.scope}:${hit.scopeId}:${hit.limit}:${periodOf(hit.limit, at)}`;
  const had = rows(ctx, "SELECT task_id FROM engine_limit_cards WHERE card_key = ?", key)[0];
  if (had) return String(had["task_id"]);
  const title = hit.scope === "agent" ? `${who.agentId} hit its ${LIMIT_WORD[hit.limit]} limit` : hit.scope === "person" ? `You hit your ${LIMIT_WORD[hit.limit]} limit` : `The Space hit its ${LIMIT_WORD[hit.limit]} limit`;
  const onceInput = { scope: hit.scope, ...(hit.scopeId === "" ? {} : { scopeId: hit.scopeId }), limit: hit.limit, mode: "once" as const };
  try {
    const out = (await ctx.call("tasks.create", {
      idempotencyKey: `engine.limit_card:${key}`,
      kind: "unblock", title, summary: "Raise it once, or stop the work.", why: `Used ${hit.used} of ${hit.cap}.`,
      assigned: { kind: "person", id: who.asker },
      source: { kind: "chat", id: who.threadId },
      blocks: [{ type: "limit_card", v: 1, data: { ...hit, agentId: who.agentId, raiseOnce: { cap: "engine.spend.raise", input: onceInput } } }],
      actions: [{ key: "raise_once", label: "Raise once" }, { key: "stop", label: "Stop" }],
    })) as { task?: { id?: string } };
    const taskId = out.task?.id;
    if (taskId === undefined) return undefined;
    ctx.db.run("INSERT OR REPLACE INTO engine_limit_cards (card_key, task_id, at) VALUES (?, ?, ?)", key, taskId, at);
    return taskId;
  } catch (e) {
    ctx.log.warn("limit card was not created", { error: e instanceof Error ? e.message : "unknown" });
    return undefined;
  }
}

export async function recordUsage(
  ctx: EngineCtx,
  input: { turnId: string; tokensIn: number; tokensOut: number; costMicros: number; itemId?: string },
): Promise<{ overLimit?: LimitKind }> {
  ensure(ctx.db);
  for (const [field, v] of [["tokensIn", input.tokensIn], ["tokensOut", input.tokensOut], ["costMicros", input.costMicros]] as const) {
    if (!Number.isInteger(v) || v < 0) raise(ctx, "validation.bad_input", `${field} must be a whole number, zero or more.`, { field });
  }
  const engine = boundEngine(ctx);
  const turn = engine.turns().find((t) => t.id === input.turnId);
  if (!turn) raise(ctx, "validation.not_found", "There is no such turn on this host.", { turnId: input.turnId });
  const at = ctx.now();
  ctx.db.run(
    `INSERT INTO engine_usage (turn_id, thread_id, agent_id, person_id, model, at, tokens_in, tokens_out, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (turn_id) DO UPDATE SET
       tokens_in = engine_usage.tokens_in + excluded.tokens_in,
       tokens_out = engine_usage.tokens_out + excluded.tokens_out,
       cost_micros = engine_usage.cost_micros + excluded.cost_micros`,
    turn.id, turn.threadId, turn.agentId, turn.asker, turn.model ?? "unknown", at, input.tokensIn, input.tokensOut, input.costMicros,
  );
  // the Vault item this turn ran on, as the turn worker got it from engine.account.resolve; the first one seen for a turn stays
  if (input.itemId !== undefined) ctx.db.run("INSERT OR IGNORE INTO engine_usage_item (turn_id, item_id) VALUES (?, ?)", turn.id, input.itemId);
  const hit = firstHit(ctx, turn, at);
  if (!hit) return {};
  // Stop the turn that crossed the line, then tell the person who pays. The card is one per scope, limit and period.
  await engine.stop(turn.threadId, { agentId: turn.agentId });
  const taskId = await limitCard(ctx, hit, { agentId: turn.agentId, threadId: turn.threadId, asker: turn.asker }, at);
  ctx.emit("agent.limit_hit", turn.agentId, {
    agentId: turn.agentId, threadId: turn.threadId, turnId: turn.id, limit: hit.limit, used: hit.used, cap: hit.cap, ...(taskId === undefined ? {} : { taskId }),
  });
  return { overLimit: hit.limit };
}
