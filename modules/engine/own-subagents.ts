// The subagents a command-line engine starts on its own (finding F41). Vyre's helpers are threads of their own; a CLI's subagents are not: the engine runs them inside its turn and reports each as one Agent (or
// Task) call and that call's result. This reads those from the step stream (crew-watch.ts feeds it) and keeps one row per subagent, written twice: at the start (task, who asked, time) and at the end (state, the words
// it returned). The step each is on rides the live stream and is never written. The row hangs under the reply of its turn and goes with that message or its chat. Who may read what is in handlers/crew-status.ts.
import { ensure } from "./projections.ts";
import type { Db } from "./projections.ts";

type Row = Record<string, unknown>;
interface Step {
  phase?: string;
  id?: string;
  name?: string;
  ok?: boolean;
  detail?: string;
  parent?: string;
  result?: string;
}

/** The names a CLI engine gives the call that starts a subagent. */
export const SUBAGENT_CALL = /^(Agent|Task)$/;

/** The subagent calls of each running turn (id -> true), so an input or result line that does not repeat the name is still read. A turn's entry goes when the turn ends. */
const running = new Map<string, Set<string>>();

/** Read a batch of the turn's steps: a subagent starts, names its task, and returns. Lines a subagent works through (they carry `parent`) are the live stream's and are not kept. */
export function noteOwn(
  db: Db,
  e: { threadId: string; turnId: string; agentId: string; asker?: string },
  list: readonly unknown[],
  now: number,
): void {
  for (const raw of list) {
    const s = raw as Step;
    const id = typeof s.id === "string" ? s.id : "";
    if (id === "" || (typeof s.parent === "string" && s.parent !== "")) continue;
    if (s.phase === "call") {
      if (typeof s.name !== "string" || !SUBAGENT_CALL.test(s.name)) continue;
      ensure(db);
      (running.get(e.turnId) ?? running.set(e.turnId, new Set()).get(e.turnId)!).add(id);
      db.run(
        "INSERT INTO engine_own_subagent (thread_id, call_id, agent_id, turn_id, asker, started_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(thread_id, call_id) DO NOTHING",
        e.threadId,
        id,
        e.agentId,
        e.turnId,
        e.asker ?? "",
        now,
      );
      continue;
    }
    if (!running.get(e.turnId)?.has(id)) continue;
    if (s.phase === "input" && typeof s.detail === "string" && s.detail !== "") {
      db.run("UPDATE engine_own_subagent SET title = ? WHERE thread_id = ? AND call_id = ?", s.detail, e.threadId, id);
    } else if (s.phase === "result") {
      running.get(e.turnId)?.delete(id);
      const found = typeof s.result === "string" ? s.result.trim() : "";
      db.run(
        "UPDATE engine_own_subagent SET state = ?, found = ?, ended_at = ? WHERE thread_id = ? AND call_id = ? AND state = 'working'",
        s.ok === false ? "failed" : "done",
        found === "" ? null : found,
        now,
        e.threadId,
        id,
      );
    }
  }
}

/** The turn ended: a subagent that never returned (the turn was stopped, or the server went down under it) is stopped, not left working. */
export function settleOwn(db: Db, turnId: string, now: number): void {
  running.delete(turnId);
  ensure(db);
  db.run(
    "UPDATE engine_own_subagent SET state = 'stopped', ended_at = ? WHERE turn_id = ? AND state = 'working'",
    now,
    turnId,
  );
}

/** The reply of a turn was posted: its subagents hang under that message. */
export function hangOwn(db: Db, turnId: string, messageId: string): void {
  ensure(db);
  db.run("UPDATE engine_own_subagent SET message_id = ? WHERE turn_id = ?", messageId, turnId);
}

/** A message, or a whole chat, was removed: the subagents that hung under it go with it. */
export function eraseOwn(db: Db, o: { messageId?: string; threadId?: string }): number {
  ensure(db);
  const before = (db.all("SELECT COUNT(*) AS n FROM engine_own_subagent") as Row[])[0]?.["n"] as number;
  if (o.messageId) db.run("DELETE FROM engine_own_subagent WHERE message_id = ?", o.messageId);
  if (o.threadId) db.run("DELETE FROM engine_own_subagent WHERE thread_id = ?", o.threadId);
  return before - Number((db.all("SELECT COUNT(*) AS n FROM engine_own_subagent") as Row[])[0]?.["n"]);
}

export interface OwnSubagent {
  callId: string;
  agentId: string;
  asker: string;
  title: string;
  state: "working" | "done" | "failed" | "stopped";
  found?: string;
  startedAt: number;
  endedAt?: number;
}

/** The subagents of one chat, oldest first. A row left working by a server that went away is read as stopped. */
export function listOwn(db: Db, threadId: string, liveTurnIds: ReadonlySet<string>): OwnSubagent[] {
  ensure(db);
  return (
    db.all("SELECT * FROM engine_own_subagent WHERE thread_id = ? ORDER BY started_at, rowid", threadId) as Row[]
  ).map((r) => {
    const stale = String(r["state"]) === "working" && !liveTurnIds.has(String(r["turn_id"]));
    return {
      callId: String(r["call_id"]),
      agentId: String(r["agent_id"]),
      asker: String(r["asker"] ?? ""),
      title: String(r["title"] ?? ""),
      state: stale ? "stopped" : (String(r["state"]) as OwnSubagent["state"]),
      ...(r["found"] ? { found: String(r["found"]) } : {}),
      startedAt: Number(r["started_at"]),
      ...(r["ended_at"] !== null && r["ended_at"] !== undefined ? { endedAt: Number(r["ended_at"]) } : {}),
    };
  });
}
