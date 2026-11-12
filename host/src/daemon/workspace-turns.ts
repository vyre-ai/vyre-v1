// Does anyone have a turn in progress in this agent's workspace (the room rule, lead and fifth look V1, 12 Nov)? A turn counts while it runs and while it waits (on an approval: the approved
// command then runs in the same shell). It counts for the workspace's own agent and for any agent with an open tab in that workspace: a crew helper works in its parent's workspace under its
// own agent id. A turn started more than 12 hours ago does not count (a row a crash left must not hold a workspace awake forever). undefined when the tables cannot be read.

export interface TurnsDb {
  all(sql: string, ...args: unknown[]): unknown[];
}

export const TURN_STALE_MS = 12 * 3_600_000;

export function workspaceInTurn(db: TurnsDb, workspaceAgent: string, now: number): boolean | undefined {
  try {
    const helpers = (
      db.all(
        "SELECT DISTINCT t.actor AS actor FROM terminal_tabs t JOIN terminal_sessions s ON s.terminal_id = t.terminal_id WHERE s.agent_id = ? AND s.closed_at IS NULL AND t.actor IS NOT NULL",
        workspaceAgent,
      ) as Array<{ actor?: string | null }>
    )
      .map((r) => r.actor)
      .filter((a): a is string => typeof a === "string" && a !== workspaceAgent);
    const who = [workspaceAgent, ...helpers];
    const marks = who.map(() => "?").join(", ");
    return (
      db.all(
        `SELECT 1 FROM engine_turns WHERE agent_id IN (${marks}) AND state IN ('running', 'waiting') AND started_at > ? LIMIT 1`,
        ...who,
        now - TURN_STALE_MS,
      ).length > 0
    );
  } catch {
    return undefined;
  }
}
