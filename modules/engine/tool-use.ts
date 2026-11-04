// Learned preload: count which tools each agent calls and list its most used ones at the start of its next turn, so an agent that always works in the same corner of Vyre never searches for its tools.
// Counted per agent (not per person), after a call that reached the tool (a refusal is not use). Tools already listed for everyone are not counted: they cost nothing to find.
import { ensure } from "./projections.ts";
import type { Db } from "./projections.ts";

/** How many learned tools an agent starts a turn with. Each is paid for on every call of the turn, so this is small. */
export const LEARNED_MAX = 10;
/** A tool used once is an accident; it is learned from the second use. */
export const LEARNED_MIN_USES = 2;

export function recordToolUse(db: Db, agentId: string, tool: string, now: number): void {
  ensure(db);
  db.run(`INSERT INTO engine_tool_use (agent_id, tool, uses, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(agent_id, tool) DO UPDATE SET uses = uses + 1, last_at = excluded.last_at`, agentId, tool, now);
}

/** The agent's most used tools, most used first, then most recent. */
export function topTools(db: Db, agentId: string, max: number = LEARNED_MAX): string[] {
  ensure(db);
  const rows = db.all(`SELECT tool FROM engine_tool_use WHERE agent_id = ? AND uses >= ? ORDER BY uses DESC, last_at DESC, tool ASC LIMIT ?`, agentId, LEARNED_MIN_USES, max) as { tool: string }[];
  return rows.map((r) => r.tool);
}
