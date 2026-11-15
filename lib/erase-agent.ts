// Deleting an agent for good (F77): the pieces every module that keeps something of an agent shares. The agents module runs the job (modules/agents/handlers/erase.ts) and asks each module, through its host
// call `<module>.erase_agent`, to clear its own tables; a module answers what it holds (dry) or clears it, and never reads another module's tables.
type Db = { run(sql: string, ...a: unknown[]): { changes: number }; all(sql: string, ...a: unknown[]): unknown[] };

/** What a module answers: counts of what it holds of the agent, and the things made by others that name it (they need someone, they are never silently broken). */
export interface Footprint {
  chats?: number;
  sharedChats?: number;
  memory?: number;
  bytes?: number;
  routines?: number;
  named?: Array<{ kind: "automation" | "task" | "goal" | "project"; id: string; title: string }>;
}
export interface EraseInput {
  agentId: string;
  name?: string;
  dry?: boolean;
}
/** The host calls that clear an agent's data are the agents job's alone (host/src/daemon/consumers.ts guardCall). */
export const ERASE_CALL = /\.erase_agent$/;
export const ERASE_CALLERS = ["host.hook.periodic.agents.erase_job", "agents.delete_preview"] as const;

const missing = (e: unknown): boolean => /no such (table|column)/i.test(e instanceof Error ? e.message : String(e));

/** Run a statement on a table or column that may not exist yet in this Space: nothing to clear then. */
export function tryRun(db: Db, sql: string, ...a: unknown[]): number {
  try {
    return db.run(sql, ...a).changes;
  } catch (e) {
    if (missing(e)) return 0;
    throw e;
  }
}
export function tryAll(db: Db, sql: string, ...a: unknown[]): Record<string, unknown>[] {
  try {
    return db.all(sql, ...a) as Record<string, unknown>[];
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** One DELETE per [table, column] (or a count of the rows when dry). Answers how many rows. */
export function eraseWhere(db: Db, id: string, tables: ReadonlyArray<readonly [string, string]>, dry = false): number {
  let n = 0;
  for (const [table, col] of tables)
    n += dry
      ? Number(tryAll(db, `SELECT COUNT(*) AS n FROM "${table}" WHERE "${col}" = ?`, id)[0]?.["n"] ?? 0)
      : tryRun(db, `DELETE FROM "${table}" WHERE "${col}" = ?`, id);
  return n;
}

export type EraseCtx = {
  db: Db;
  now(): number;
  emit?(name: string, subject: string, payload: Record<string, unknown>): void;
};
export interface EraseIn extends EraseInput {
  folderId?: string;
}
/** A module whose store is only tables keyed by the agent: one host call that clears (or counts) them, and what else it needs in `more`. */
export const eraseTables =
  (tables: ReadonlyArray<readonly [string, string]>, more?: (ctx: EraseCtx, i: EraseIn) => Footprint | void) =>
  (ctx: EraseCtx, i: EraseIn): Footprint => {
    eraseWhere(ctx.db, i.agentId, tables, i.dry === true);
    return more?.(ctx, i) ?? {};
  };
