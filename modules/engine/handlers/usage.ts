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
import { num, optStr, rows } from "./extra/util.ts";

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

interface AccountRow { ref: string; driver: string; title: string; name?: string }
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
  const row = ref === undefined ? undefined : listed.accounts.find((a) => a.ref === ref);
  if (ref !== undefined && !row) raise(ctx, "validation.not_found", "There is no such account.", { accountRef: ref });

  const { model, provider } = await modelOf(ctx, input.threadId, input.agentId);
  const last = rows(ctx, "SELECT tokens_in FROM engine_turns WHERE thread_id = ? AND agent_id = ? AND tokens_in > 0 ORDER BY started_at DESC, qseq DESC LIMIT 1", input.threadId, input.agentId)[0];
  const accountProvider = row ? (PROVIDER_OF[row.driver] ?? row.driver) : undefined;
  let context: { used: number; window: number } | null = null;
  if (model) {
    const window = windowFor(model, provider ?? accountProvider ?? null);
    context = { used: Math.min(window, last ? Math.trunc(num(last["tokens_in"])) : 0), window };
  }

  const session = row ? readingOf(ctx.db, row.ref, "session", now) : null;
  const week = row ? readingOf(ctx.db, row.ref, "week", now) : null;
  const source = session || week ? "provider" : context ? "estimate" : "none";
  return {
    account: row ? { ref: row.ref, name: row.name ?? row.title, provider: accountProvider as string } : null,
    context, session, week, source,
  } as const;
}

