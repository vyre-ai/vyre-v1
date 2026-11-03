// What a reply's Details show (owner, 3 Nov: "which provider it ran on, how much this answer cost, who was the asker, what was the model ... and it needs to be accurate").
// Every value comes from what was recorded with the turn, never from an estimate:
//   engine_turns        asker, agent, model, engine, account ref, times, tokens in and out, trace id, error (engine.turn.record)
//   engine_turn_where   where it ran, in order (a computer, then the Space when the computer slept)
//   engine_turn_info    the rest the turn engine saw (TurnInfo: effort, the account it paid with, first token, cache and reasoning counts, the provider's own price, tool calls,
//                       account switches) and the price it was charged at, plus the chat message the turn's reply was posted as (the bridge's final event)
// Who sees what in a shared chat: everyone in the chat sees the model, the agent, the asker, where it ran, the times and the token counts. The account, the cost and what each tool was
// asked to do are the asker's and the AI-spend managers' only; anyone else gets `private: true` and the chat says it was on the asker's account.
import { actorOf, raise } from "../../projections.ts";
import type { Db, EngineCtx } from "../../projections.ts";
import { costOf } from "../../turn-cost.ts";
import type { TurnCost } from "../../turn-cost.ts";
import type { ToolTrace, TurnInfo } from "../../../../agent/src/turn-engine/types.ts";
import { loadTurn } from "./turns.ts";
import { num, optNum, rows, str } from "./util.ts";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS engine_turn_info (
    turn_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    reply_message_id TEXT,
    info TEXT,
    cost TEXT,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS engine_turn_info_reply ON engine_turn_info (thread_id, reply_message_id)",
];
const ready = new WeakSet<object>();

export function ensureInfo(db: Db): void {
  if (ready.has(db)) return;
  for (const stmt of SCHEMA) db.run(stmt);
  ready.add(db);
}

/** Keep what the turn engine saw, and price the turn once, at the price of the day it ran. A repeat (a second record call) replaces both with the same values. */
export function saveTurnInfo(db: Db, t: { turnId: string; threadId: string; model: string; driver?: string; tokensIn: number; tokensOut: number }, info: TurnInfo, now: number): TurnCost {
  ensureInfo(db);
  const cost = costOf({
    model: t.model, tokensIn: t.tokensIn, tokensOut: t.tokensOut,
    ...(t.driver ?? info.account?.driver ? { driver: t.driver ?? info.account?.driver } : {}), ...(info.account ? { provider: info.account.provider, accountKind: info.account.kind } : {}),
    ...(info.cacheReadTokens !== undefined ? { cacheReadTokens: info.cacheReadTokens } : {}), ...(info.cacheWriteTokens !== undefined ? { cacheWriteTokens: info.cacheWriteTokens } : {}),
    ...(info.costUsd !== undefined ? { costUsd: info.costUsd } : {}),
  });
  db.run(
    `INSERT INTO engine_turn_info (turn_id, thread_id, reply_message_id, info, cost, updated_at) VALUES (?, ?, NULL, ?, ?, ?)
     ON CONFLICT (turn_id) DO UPDATE SET info = excluded.info, cost = excluded.cost, updated_at = excluded.updated_at`,
    t.turnId, t.threadId, JSON.stringify(info), JSON.stringify(cost), now,
  );
  writeSteps(db, t.turnId, info);
  return cost;
}

/**
 * The in-process engine's turns had no writer for engine_turn_blocks and engine_turn_fallbacks, so engine.turn.get showed no steps and no fallbacks for them. Its tool calls and account
 * switches are written there too, once per turn: a repeat rewrites the same rows. The worker path (engine.turn.append and engine.turn.fallback) keeps writing its own.
 */
function writeSteps(db: Db, turnId: string, info: TurnInfo): void {
  if (info.tools.length > 0) {
    db.run("DELETE FROM engine_turn_blocks WHERE turn_id = ?", turnId);
    let idx = 0;
    for (const x of info.tools) {
      db.run("INSERT INTO engine_turn_blocks (turn_id, idx, kind, data, at) VALUES (?, ?, 'tool_call', ?, ?)", turnId, idx++, JSON.stringify({ id: x.id, name: x.name }), x.startedAt);
      if (x.endedAt !== undefined) db.run("INSERT INTO engine_turn_blocks (turn_id, idx, kind, data, at) VALUES (?, ?, 'tool_result', ?, ?)", turnId, idx++, JSON.stringify({ id: x.id, name: x.name, ok: x.ok !== false }), x.endedAt);
    }
  }
  if (info.switches.length > 0) {
    db.run("DELETE FROM engine_turn_fallbacks WHERE turn_id = ?", turnId);
    info.switches.forEach((s, i) => db.run("INSERT INTO engine_turn_fallbacks (turn_id, n, kind, to_what, at) VALUES (?, ?, 'backup_key', ?, ?)", turnId, i + 1, s.to, s.at));
  }
}

/** The chat message a turn's reply was posted as (the bridge's final event). A turn can be linked before or after its info is saved. */
export function linkReply(db: Db, l: { threadId: string; turnId: string; messageId: string }, now: number): void {
  ensureInfo(db);
  db.run(
    `INSERT INTO engine_turn_info (turn_id, thread_id, reply_message_id, info, cost, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)
     ON CONFLICT (turn_id) DO UPDATE SET reply_message_id = excluded.reply_message_id, updated_at = excluded.updated_at`,
    l.turnId, l.threadId, l.messageId, now,
  );
}

const parse = <T>(v: unknown): T | null => { try { return typeof v === "string" ? (JSON.parse(v) as T) : null; } catch { return null; } };

export interface ReplyTool { name: string; args?: string; ok?: boolean; durationMs?: number; heldTaskId?: string }
export interface ReplyTurn {
  turnId: string; traceId: string; agentId: string; asker: string; model: string; effort?: string; engine: string; provider?: string;
  /** "subscription" (a sign-in) or "api_key"; with `shared` it is a key of the Space, not the asker's own. */
  accountKind?: string; shared?: boolean;
  /** Who paid and why, in a plain line. The asker's and managers' only. */
  paid?: string;
  /** The asker's and managers' only. */
  accountRef?: string;
  state: string; ranOn: Array<{ kind: string; name: string }>;
  timing: { queuedAt?: number; startedAt: number; firstTokenAt?: number; endedAt?: number };
  tokens: { in: number; out: number; cacheRead?: number; cacheWrite?: number; reasoning?: number };
  cost?: TurnCost;
  tools: ReplyTool[];
  files: { read: string[]; written: string[] };
  skills: string[];
  switches: Array<{ at: number; why: string; sameAccount: boolean; from?: string; to?: string }>;
  error?: { code: string; message: string };
  /** The account, the cost and the tool arguments were left out: the caller is neither the asker nor a manager of AI spend. */
  private: boolean;
  /** Older turns recorded before the turn engine kept its Details: only the turn row is there. */
  partial: boolean;
}

const READS = new Set(["Read", "NotebookRead", "Glob", "Grep"]);
const WRITES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function toolOut(t: ToolTrace, full: boolean): ReplyTool {
  return {
    name: t.name, ...(full && t.detail ? { args: t.detail } : {}), ...(t.ok === undefined ? {} : { ok: t.ok }),
    ...(t.endedAt !== undefined ? { durationMs: Math.max(0, t.endedAt - t.startedAt) } : {}), ...(t.held ? { heldTaskId: t.held } : {}),
  };
}

/** engine.turn.of_message: the turn behind one reply, as the caller may see it. */
export function turnOfMessage(ctx: EngineCtx, input: { threadId: string; messageId: string }): { turn: ReplyTurn } {
  ensureInfo(ctx.db);
  const link = rows(ctx, "SELECT * FROM engine_turn_info WHERE thread_id = ? AND reply_message_id = ? ORDER BY updated_at DESC LIMIT 1", input.threadId, input.messageId)[0];
  if (!link) raise(ctx, "validation.not_found", "No turn is recorded for that reply.", { messageId: input.messageId });
  const t = loadTurn(ctx, str(link["turn_id"]));
  const info = parse<TurnInfo>(link["info"]);
  const cost = parse<TurnCost>(link["cost"]);
  const asker = str(t["asker"]);
  const full = asker === actorOf(ctx) || ctx.authorize({ perm: "ai.spend", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";
  const q = rows(ctx, "SELECT enqueued_at FROM engine_thread_queue WHERE thread_id = ? AND qseq = ?", str(t["thread_id"]), num(t["qseq"]))[0];
  const startedAt = num(t["started_at"]), queuedAt = q ? num(q["enqueued_at"]) : undefined;
  const endedAt = optNum(t["ended_at"]);
  const err = parse<{ code: string; message: string }>(t["error"]);
  const traces = info?.tools ?? [];
  const named = (set: Set<string>) => [...new Set(traces.filter((x) => set.has(x.name) && x.detail).map((x) => x.detail as string))];
  const accountRef = info?.account?.ref ?? (t["account_ref"] == null ? undefined : str(t["account_ref"]));
  return {
    turn: {
      turnId: str(t["turn_id"]), traceId: str(t["trace_id"]), agentId: str(t["agent_id"]), asker, model: str(t["model"]),
      ...(info?.effort ? { effort: info.effort } : {}), engine: info?.account?.driver ?? str(t["engine"]), ...(info?.account ? { provider: info.account.provider, accountKind: info.account.kind } : {}),
      ...(info?.account?.shared || info?.account?.spaceKey ? { shared: true } : {}), ...(full && accountRef ? { accountRef } : {}), ...(full && info?.paid ? { paid: info.paid } : {}),
      state: str(t["state"]), ranOn: Array.isArray(t["ran_on"]) ? (t["ran_on"] as Array<{ kind: string; name: string }>) : [],
      timing: { ...(queuedAt !== undefined && queuedAt <= startedAt ? { queuedAt } : {}), startedAt, ...(info?.firstTokenAt ? { firstTokenAt: info.firstTokenAt } : {}), ...(endedAt === undefined ? {} : { endedAt }) },
      tokens: {
        in: num(t["tokens_in"]), out: num(t["tokens_out"]), ...(info?.cacheReadTokens !== undefined ? { cacheRead: info.cacheReadTokens } : {}),
        ...(info?.cacheWriteTokens !== undefined ? { cacheWrite: info.cacheWriteTokens } : {}), ...(info?.reasoningTokens !== undefined ? { reasoning: info.reasoningTokens } : {}),
      },
      ...(full && cost ? { cost } : {}),
      tools: traces.map((x) => toolOut(x, full)),
      // a file name is what a tool was asked to touch: the same rule as the arguments
      files: full ? { read: named(READS), written: named(WRITES) } : { read: [], written: [] },
      skills: [...new Set(traces.filter((x) => x.name === "Skill" && x.detail).map((x) => x.detail as string))],
      switches: (info?.switches ?? []).map((s) => ({ at: s.at, why: s.why, sameAccount: s.from === s.to, ...(full ? { from: s.from, to: s.to } : {}) })),
      ...(err ? { error: { code: err.code, message: err.message } } : {}),
      private: !full, partial: info === null,
    },
  };
}
