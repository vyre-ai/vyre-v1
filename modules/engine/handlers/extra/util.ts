// Small helpers the leftover engine handlers share: row access, cursor paging, the contract's turn row.
import type { EngineCtx } from "../../projections.ts";

export type Row = Record<string, unknown>;
export const rows = (ctx: Pick<EngineCtx, "db">, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
export const num = (v: unknown): number => Number(v ?? 0);
export const str = (v: unknown): string => String(v ?? "");
export const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
export const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

export type TurnState = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export interface ErrShape { code: string; message: string; next: Array<{ kind: string; label: string }>; traceId: string }

export interface TurnOut {
  turnId: string; threadId: string; agentId: string; asker: string; accountRef?: string; engine: string; model: string; state: TurnState; traceId: string;
  runId?: string; startedAt: number; endedAt?: number; tokensIn: number; tokensOut: number; costMicros: number; error?: ErrShape;
}

/** The contract's turn row from an engine_turns row. */
export function turnOf(r: Row): TurnOut {
  const accountRef = optStr(r["account_ref"]), runId = optStr(r["run_id"]), endedAt = optNum(r["ended_at"]), error = optStr(r["error"]);
  return {
    turnId: str(r["turn_id"]), threadId: str(r["thread_id"]), agentId: str(r["agent_id"]), asker: str(r["asker"]),
    ...(accountRef === undefined ? {} : { accountRef }), engine: str(r["engine"]), model: str(r["model"]), state: str(r["state"]) as TurnState, traceId: str(r["trace_id"]),
    ...(runId === undefined ? {} : { runId }), startedAt: num(r["started_at"]), ...(endedAt === undefined ? {} : { endedAt }),
    tokensIn: num(r["tokens_in"]), tokensOut: num(r["tokens_out"]), costMicros: num(r["cost_micros"]), ...(error === undefined ? {} : { error: JSON.parse(error) as ErrShape }),
  };
}

export const DEFAULT_PAGE = 50;

/** Offset cursors: the cursor is the number of rows already returned. */
export function pageOf<T>(all: readonly T[], input: { cursor?: string; limit?: number }): { items: T[]; next?: string; total: number } {
  const limit = input.limit ?? DEFAULT_PAGE;
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, ...(end < all.length ? { next: String(end) } : {}), total: all.length };
}
