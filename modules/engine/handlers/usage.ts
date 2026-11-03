// engine.usage.get: what the composer's model panel shows for one chat and one account, and the store behind the limit meters.
//   context  the size of the chat so far against the model's window. Used is the input tokens of the thread's latest turn (the best proxy for how much the model was shown last);
//            the window comes from the model catalog (agent/src/transcript/windows.ts, the same table the rollover uses).
//   session, week  the subscription limit windows exactly as the engine reported them (Claude Code's rate_limit_event). The latest reading is kept per account in engine_account_limits
//            and is dropped once its reset time has passed. A provider that reports nothing gives null, and the meter is hidden: nothing here is ever estimated.
//   source   provider when a limit window was reported, estimate when only the context figure (counted from our own turn records) is known, none otherwise.
// DECISION: API-key accounts report per-minute throttles (anthropic-ratelimit-*), which are not a session or a week, so they are not shown as one.
// The table is created here with CREATE TABLE IF NOT EXISTS, the way the other engine_* helper tables are, so no migration list changes.
import { windowFor } from "../../../agent/src/transcript/windows.ts";
import { raise } from "../projections.ts";
import type { Db, EngineCtx } from "../projections.ts";
import { ensureExtra } from "./extra/schema.ts";
import { num, optStr, rows, str } from "./extra/util.ts";
import { keepEvery, lastCompaction } from "../cli-sessions.ts";
import { ensureInfo } from "./extra/reply-info.ts";

export type LimitWindow = "session" | "week";
export interface Reading { window: LimitWindow; pct: number; resetsAt?: number }

const ready = new WeakSet<object>();
function ensureLimits(db: Db): void {
  if (ready.has(db)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_account_limits (account_ref TEXT NOT NULL, win TEXT NOT NULL, pct REAL NOT NULL, resets_at INTEGER, at INTEGER NOT NULL, PRIMARY KEY (account_ref, win))");
  ready.add(db);
}

/** Keep the latest reading of one limit window of an account. A nonsense percent is not stored. */
export function recordAccountLimits(db: Db, accountRef: string, r: Reading, now: number): void {
  if (accountRef === "" || (r.window !== "session" && r.window !== "week") || !Number.isFinite(r.pct) || r.pct < 0 || r.pct > 100) return;
  ensureLimits(db);
  db.run(
    "INSERT OR REPLACE INTO engine_account_limits (account_ref, win, pct, resets_at, at) VALUES (?, ?, ?, ?, ?)",
    accountRef, r.window, r.pct, r.resetsAt !== undefined && Number.isFinite(r.resetsAt) ? Math.trunc(r.resetsAt) : null, now,
  );
}

function readingOf(db: Db, ref: string, window: LimitWindow, now: number): { pct: number; resetsAt?: number } | null {
  const r = rows({ db }, "SELECT pct, resets_at FROM engine_account_limits WHERE account_ref = ? AND win = ?", ref, window)[0];
  if (!r) return null;
  const resetsAt = optStr(r["resets_at"]);
  // a window that has reset since the reading says nothing about the new one
  if (resetsAt !== undefined && Number(resetsAt) <= now) return null;
  return { pct: num(r["pct"]), ...(resetsAt !== undefined ? { resetsAt: Number(resetsAt) } : {}) };
}

// ---- a model that ran out of usage on an account (the Space AI key, OpenCode Go): the provider refused with a limit. Kept until the time it said, or MODEL_REST_MS when it said none,
// and cleared by the next turn on that model that answers. The picker greys the model with the time; the meter of that model shows full.

/** How long a model that ran out is shown as out when the provider did not say when it comes back. */
export const MODEL_REST_MS = 30 * 60_000;
const modelReady = new WeakSet<object>();
function ensureModelLimits(db: Db): void {
  if (modelReady.has(db)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_model_limits (account_ref TEXT NOT NULL, model TEXT NOT NULL, resets_at INTEGER, at INTEGER NOT NULL, PRIMARY KEY (account_ref, model))");
  modelReady.add(db);
}
export function recordModelLimit(db: Db, accountRef: string, model: string, resetsAt: number | undefined, now: number): void {
  if (accountRef === "" || model === "") return;
  ensureModelLimits(db);
  db.run("INSERT OR REPLACE INTO engine_model_limits (account_ref, model, resets_at, at) VALUES (?, ?, ?, ?)", accountRef, model, resetsAt !== undefined && Number.isFinite(resetsAt) && resetsAt > now ? Math.trunc(resetsAt) : null, now);
}
export function clearModelLimit(db: Db, accountRef: string, model: string): void {
  ensureModelLimits(db);
  db.run("DELETE FROM engine_model_limits WHERE account_ref = ? AND model = ?", accountRef, model);
}
/** The models of an account that are out of usage now, with when they come back when the provider said. */
export function modelLimits(db: Db, accountRef: string, now: number): Map<string, { resetsAt?: number }> {
  ensureModelLimits(db);
  const out = new Map<string, { resetsAt?: number }>();
  for (const r of rows({ db }, "SELECT model, resets_at, at FROM engine_model_limits WHERE account_ref = ?", accountRef)) {
    const resetsAt = optStr(r["resets_at"]);
    const until = resetsAt !== undefined ? Number(resetsAt) : num(r["at"]) + MODEL_REST_MS;
    if (until <= now) continue;
    out.set(String(r["model"]), resetsAt !== undefined ? { resetsAt: Number(resetsAt) } : {});
  }
  return out;
}

interface AccountRow { ref: string; driver: string; title: string; name?: string; aliases?: string[] }
const PROVIDER_OF: Readonly<Record<string, string>> = { claude_code: "anthropic", codex: "openai", grok: "xai" };

/** The model the agent runs on in this thread: what Set model chose, else the thread's member row, else the agent's own. */
async function modelOf(ctx: EngineCtx, threadId: string, agentId: string): Promise<{ model?: string; provider?: string }> {
  const state = rows(ctx, "SELECT model, provider FROM engine_agent_state WHERE thread_id = ? AND agent_id = ?", threadId, agentId)[0];
  const model = optStr(state?.["model"]);
  if (model) return { model, ...(optStr(state?.["provider"]) ? { provider: optStr(state?.["provider"]) as string } : {}) };
  try {
    const t = (await ctx.call("threads.get", { threadId })) as { thread?: { agents?: Array<{ agentId: string; model?: string; provider?: string }> } };
    const m = t.thread?.agents?.find((a) => a.agentId === agentId);
    if (m?.model) return { model: m.model, ...(m.provider ? { provider: m.provider } : {}) };
  } catch { /* the thread lookup is the caller's access check elsewhere; here it only adds a model name */ }
  try {
    const a = (await ctx.call("agents.get", { agentId })) as { agent?: { model?: string } };
    if (a.agent?.model) return { model: a.agent.model };
  } catch { /* an agent that cannot be read has no model to size */ }
  return {};
}

/**
 * What the chat's latest turn really ran on, from the turn's own record: the model its engine named and the account that paid at the end. The account above it in usage.get is where the next turn would
 * go, which is the same only while nothing changed; this is the one that already ran, so a line about it agrees with the turn's own Details.
 */
async function lastTurnOf(ctx: EngineCtx, threadId: string, agentId: string, accounts: AccountRow[]): Promise<{ model?: string; account?: { ref: string; name?: string; provider: string; shared?: boolean }; paid?: string } | null> {
  const t = rows(ctx, "SELECT turn_id, asker, model, account_ref FROM engine_turns WHERE thread_id = ? AND agent_id = ? AND state IN ('completed', 'failed') ORDER BY started_at DESC, qseq DESC LIMIT 1", threadId, agentId)[0];
  if (!t) return null;
  ensureInfo(ctx.db);
  const i = rows(ctx, "SELECT info FROM engine_turn_info WHERE turn_id = ?", String(t["turn_id"]))[0];
  let info: { account?: { ref: string; driver: string; provider: string; shared?: boolean; spaceKey?: boolean }; paid?: string } | undefined;
  try { info = i && typeof i["info"] === "string" ? JSON.parse(i["info"] as string) : undefined; } catch { /* a record that is not JSON is no record */ }
  const ref = info?.account?.ref ?? optStr(t["account_ref"]);
  const row = ref ? accounts.find((a) => a.ref === ref) ?? accounts.find((a) => (a.aliases ?? []).includes(ref)) : undefined;
  const model = optStr(t["model"]);
  const mine = String(t["asker"]) === (ctx.actingFor ?? ctx.principal.id);
  const provider = info?.account?.provider ?? (row ? (PROVIDER_OF[row.driver] ?? row.driver) : undefined);
  return {
    ...(model && model !== "unknown" ? { model } : {}),
    ...(ref && provider ? { account: { ref, ...(row ? { name: row.name ?? row.title } : {}), provider, ...(info?.account?.shared || info?.account?.spaceKey ? { shared: true } : {}) } } : {}),
    ...(mine && info?.paid ? { paid: info.paid } : {}),
  };
}

export async function usageGet(ctx: EngineCtx, input: { threadId: string; agentId: string; accountRef?: string }) {
  ensureExtra(ctx.db);
  ensureLimits(ctx.db);
  const now = ctx.now();
  const listed = (await ctx.call("engine.accounts.list", {})) as { accounts: AccountRow[] };
  let ref = input.accountRef;
  if (ref === undefined) {
    const res = (await ctx.call("engine.account.resolve", { threadId: input.threadId, agentId: input.agentId })) as { accountRef: string | null };
    ref = res.accountRef ?? undefined;
  }
  // a pin to a folded handle or an older sign-in is listed as the account it shows under; the provider's readings stay the ref's own
  const row = ref === undefined ? undefined : listed.accounts.find((a) => a.ref === ref) ?? listed.accounts.find((a) => (a.aliases ?? []).includes(ref as string));
  if (ref !== undefined && !row) raise(ctx, "validation.not_found", "There is no such account.", { accountRef: ref });

  const picked = await modelOf(ctx, input.threadId, input.agentId);
  const last = rows(ctx, "SELECT turn_id, model, tokens_in, started_at, ended_at FROM engine_turns WHERE thread_id = ? AND agent_id = ? AND tokens_in > 0 ORDER BY started_at DESC, qseq DESC LIMIT 1", input.threadId, input.agentId)[0];
  // a turn's token total adds up every request it made, each of which re-sent the whole chat: the chat's size is what the turn's last request carried, when the engine said
  let lastSize: number | undefined;
  let lastCalls = 1;   // requests the turn made: its tool calls plus the answer
  if (last) {
    try {
      ensureInfo(ctx.db);
      const i = rows(ctx, "SELECT info FROM engine_turn_info WHERE turn_id = ?", String(last["turn_id"]))[0];
      const parsed = i && typeof i["info"] === "string" ? (JSON.parse(i["info"] as string) as { contextTokens?: number; tools?: unknown[] }) : undefined;
      if (Array.isArray(parsed?.tools)) lastCalls = parsed!.tools!.length + 1;
      if (typeof parsed?.contextTokens === "number" && parsed.contextTokens > 0) lastSize = parsed.contextTokens;
    } catch { /* the figure falls back to the turn's total */ }
  }
  // a chat that picked no model runs on the engine's own default: the model its latest turn really ran on sizes the window
  const ranModel = optStr(last?.["model"]);
  const model = picked.model ?? (ranModel && ranModel !== "unknown" ? ranModel : undefined);
  const provider = picked.provider;
  const accountProvider = row ? (PROVIDER_OF[row.driver] ?? row.driver) : undefined;
  let context: { used: number; window: number } | null = null;
  if (model) {
    const window = windowFor(model, provider ?? accountProvider ?? null);
    // a compaction since the latest turn left the context at what it reported (engine.compact): that is the figure until the next turn says otherwise
    const c = lastCompaction(ctx.db, input.threadId, input.agentId);
    const lastAt = last ? Math.max(num(last["started_at"]), num(last["ended_at"])) : 0;
    const used = c && c.used !== null && c.at >= lastAt ? c.used : last ? Math.trunc(lastSize ?? (lastCalls > 1 ? (2 * num(last["tokens_in"])) / lastCalls : num(last["tokens_in"]))) : 0;   // an engine that reports only the turn's total (Codex) made lastCalls requests, each re-sending a growing chat: the last one is about twice the average
    const estimated = !(c && c.used !== null && c.at >= lastAt) && last !== undefined && lastSize === undefined && lastCalls > 1;
    context = { used: Math.min(window, used), window, ...(estimated ? { approximate: true } : {}) };
  }

  // a model that ran out on this account reads as a full session until it comes back (what the provider refused, not an estimate)
  const out = row && ref !== undefined && model ? modelLimits(ctx.db, ref, now).get(model) : undefined;
  const session = out ? { pct: 100, ...(out.resetsAt !== undefined ? { resetsAt: out.resetsAt } : {}) } : row && ref !== undefined ? readingOf(ctx.db, ref, "session", now) : null;
  const week = row && ref !== undefined ? readingOf(ctx.db, ref, "week", now) : null;
  const source = session || week ? "provider" : context ? "estimate" : "none";
  const keep = keepEvery(ctx.db, input.threadId);
  const lastTurn = await lastTurnOf(ctx, input.threadId, input.agentId, listed.accounts);
  return {
    account: row ? { ref: row.ref, name: row.name ?? row.title, provider: accountProvider as string } : null,
    context, session, week, source, ...(keep !== "" ? { keepEvery: keep } : {}), ...(lastTurn ? { lastTurn } : {}), ...(picked.model ? { model: picked.model } : {}),
  } as const;
}

