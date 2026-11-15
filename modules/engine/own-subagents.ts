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
  /** the task line of the subagent `parent` names */
  title?: boolean;
  /** The result only says the work STARTED (a helper or shell job launched in the background): it is working until its own end comes (noteTask). */
  launched?: boolean;
}

/**
 * Background helpers and jobs that are running now, by chat and the call that started each. Memory only: a server that restarts has none running (the engine's process went with it), so a row still
 * marked working is then read as stopped. A background row is settled by its own end, never by the end of its turn.
 */
const bgLive = new Map<string, Map<string, { agentId: string; asker: string; startedAt: number }>>();
const bgKey = (threadId: string): Map<string, { agentId: string; asker: string; startedAt: number }> =>
  bgLive.get(threadId) ?? bgLive.set(threadId, new Map()).get(threadId)!;

/** The chats that have background work running now, with who started it, how many and since when. */
export function backgroundNow(): Array<{
  threadId: string;
  agentId: string;
  asker: string;
  since: number;
  count: number;
}> {
  const out = [];
  for (const [threadId, m] of bgLive) {
    const first = [...m.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (first)
      out.push({ threadId, agentId: first.agentId, asker: first.asker, since: first.startedAt, count: m.size });
  }
  return out;
}
export const backgroundCount = (threadId: string): number => bgLive.get(threadId)?.size ?? 0;

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
    if (id === "" || (typeof s.parent === "string" && s.parent !== "" && s.title !== true)) continue;
    if (s.phase === "result" && s.launched === true && !running.get(e.turnId)?.has(id)) {
      // a shell job launched in the background: a row of its own (a helper's row was made at its call)
      ensure(db);
      db.run(
        "INSERT INTO engine_own_subagent (thread_id, call_id, agent_id, turn_id, asker, started_at, title, background) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(thread_id, call_id) DO NOTHING",
        e.threadId,
        id,
        e.agentId,
        e.turnId,
        e.asker ?? "",
        now,
        typeof s.detail === "string" && s.detail !== "" ? s.detail : "A job in the background",
      );
      bgKey(e.threadId).set(id, { agentId: e.agentId, asker: e.asker ?? "", startedAt: now });
      continue;
    }
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
    } else if (s.phase === "result" && s.launched === true) {
      // started, not finished: it works on after this turn, until its own end (noteTask) says otherwise
      running.get(e.turnId)?.delete(id);
      db.run(
        "UPDATE engine_own_subagent SET background = 1 WHERE thread_id = ? AND call_id = ? AND state = 'working'",
        e.threadId,
        id,
      );
      bgKey(e.threadId).set(id, { agentId: e.agentId, asker: e.asker ?? "", startedAt: now });
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
  // a helper started in the background is not the turn's to end: it works on, and its own end settles it
  db.run(
    "UPDATE engine_own_subagent SET state = 'stopped', ended_at = ? WHERE turn_id = ? AND state = 'working' AND background = 0",
    now,
    turnId,
  );
}

/**
 * A background task of the engine, at any time: it started, it is on a step, it ended (agent/src/drivers/cli/claude.ts). `id` is the call that started it. Its row is found by that id, else by the engine's own
 * task id. An end of a helper that was stopped, or whose process ended, is stopped; one that failed is failed; else done with the words it returned. Returns true when this ended a row.
 */
export function noteTask(
  db: Db,
  e: { threadId: string; turnId?: string; agentId: string; asker: string },
  t: {
    state: "start" | "progress" | "end";
    id: string;
    taskId: string;
    text?: string;
    ok?: boolean;
    stopped?: boolean;
  },
  now: number,
): boolean {
  ensure(db);
  let row = (
    db.all("SELECT call_id FROM engine_own_subagent WHERE thread_id = ? AND call_id = ?", e.threadId, t.id) as Row[]
  )[0];
  if (!row && t.taskId !== "")
    row = (
      db.all(
        "SELECT call_id FROM engine_own_subagent WHERE thread_id = ? AND task_id = ?",
        e.threadId,
        t.taskId,
      ) as Row[]
    )[0];
  if (!row) {
    // a task the engine started without a call this chat saw (a helper of a helper, a task after a restart): its own row, so it is counted and shown
    if (t.state === "end") return false;
    db.run(
      "INSERT INTO engine_own_subagent (thread_id, call_id, agent_id, turn_id, asker, started_at, title, background) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(thread_id, call_id) DO NOTHING",
      e.threadId,
      t.id,
      e.agentId,
      e.turnId ?? "",
      e.asker,
      now,
      t.text && t.state === "start" ? t.text : "A helper in the background",
    );
    row = { call_id: t.id };
  }
  const callId = String(row["call_id"]);
  if (t.taskId !== "")
    db.run(
      "UPDATE engine_own_subagent SET task_id = ? WHERE thread_id = ? AND call_id = ?",
      t.taskId,
      e.threadId,
      callId,
    );
  if (t.state !== "end") {
    bgKey(e.threadId).set(
      callId,
      bgLive.get(e.threadId)?.get(callId) ?? { agentId: e.agentId, asker: e.asker, startedAt: now },
    );
    db.run(
      "UPDATE engine_own_subagent SET background = 1 WHERE thread_id = ? AND call_id = ? AND state = 'working'",
      e.threadId,
      callId,
    );
    if (t.state === "progress" && t.text)
      db.run(
        "UPDATE engine_own_subagent SET step = ? WHERE thread_id = ? AND call_id = ? AND state = 'working'",
        t.text,
        e.threadId,
        callId,
      );
    if (t.state === "start" && t.text)
      db.run(
        "UPDATE engine_own_subagent SET title = CASE WHEN title = '' OR title = 'A helper in the background' THEN ? ELSE title END WHERE thread_id = ? AND call_id = ?",
        t.text,
        e.threadId,
        callId,
      );
    return false;
  }
  bgLive.get(e.threadId)?.delete(callId);
  if (bgLive.get(e.threadId)?.size === 0) bgLive.delete(e.threadId);
  const found = (t.text ?? "").trim();
  db.run(
    "UPDATE engine_own_subagent SET state = ?, found = COALESCE(?, found), step = NULL, ended_at = ? WHERE thread_id = ? AND call_id = ? AND state = 'working'",
    t.stopped === true ? "stopped" : t.ok === false ? "failed" : "done",
    found === "" ? null : found,
    now,
    e.threadId,
    callId,
  );
  return true;
}

/** The reply of a turn was posted: its subagents hang under that message. */
export function hangOwn(db: Db, turnId: string, messageId: string): void {
  ensure(db);
  db.run("UPDATE engine_own_subagent SET message_id = ? WHERE turn_id = ?", messageId, turnId);
}

/** A message, or a whole chat, was removed: the subagents that hung under it go with it. */
export function eraseOwn(db: Db, o: { messageId?: string; messageIds?: readonly string[]; threadId?: string }): number {
  ensure(db);
  const before = (db.all("SELECT COUNT(*) AS n FROM engine_own_subagent") as Row[])[0]?.["n"] as number;
  for (const id of o.messageIds ?? []) db.run("DELETE FROM engine_own_subagent WHERE message_id = ?", id);
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
  /** What it is doing now, in words (a background helper; a foreground one's step rides the live stream). */
  step?: string;
  startedAt: number;
  endedAt?: number;
}

/** The subagents of one chat, oldest first. A row left working by a server that went away is read as stopped. */
export function listOwn(db: Db, threadId: string, liveTurnIds: ReadonlySet<string>): OwnSubagent[] {
  ensure(db);
  return (
    db.all("SELECT * FROM engine_own_subagent WHERE thread_id = ? ORDER BY started_at, rowid", threadId) as Row[]
  ).map((r) => {
    // a background helper is alive while the engine's process is (bgLive); any other is alive while its turn is
    const alive =
      Number(r["background"] ?? 0) === 1
        ? (bgLive.get(threadId)?.has(String(r["call_id"])) ?? false)
        : liveTurnIds.has(String(r["turn_id"]));
    const stale = String(r["state"]) === "working" && !alive;
    return {
      callId: String(r["call_id"]),
      agentId: String(r["agent_id"]),
      asker: String(r["asker"] ?? ""),
      title: String(r["title"] ?? ""),
      state: stale ? "stopped" : (String(r["state"]) as OwnSubagent["state"]),
      ...(r["found"] ? { found: String(r["found"]) } : {}),
      ...(r["step"] && !stale ? { step: String(r["step"]) } : {}),
      startedAt: Number(r["started_at"]),
      ...(r["ended_at"] !== null && r["ended_at"] !== undefined ? { endedAt: Number(r["ended_at"]) } : {}),
    };
  });
}

/**
 * What is true now about the background helpers of a chat, for the agent's turn context (and so for its answer when the person writes while they run): "2 of 4 helpers started in the background are
 * still working: Batch 3, Batch 4." Null when none were started or none is running. Counts come from Vyre's own rows, never from the agent's memory of them.
 */
export function backgroundLine(db: Db, threadId: string): string | null {
  ensure(db);
  const rows = db.all(
    "SELECT title, state FROM engine_own_subagent WHERE thread_id = ? AND background = 1 ORDER BY started_at, rowid",
    threadId,
  ) as Row[];
  const alive = bgLive.get(threadId);
  const running = rows.filter((r) => String(r["state"]) === "working");
  if (rows.length === 0 || !alive || alive.size === 0 || running.length === 0) return null;
  const names = running.map((r) => String(r["title"] ?? "")).filter((t) => t !== "");
  return `${running.length} of ${rows.length} helpers or jobs you started in the background ${running.length === 1 ? "is" : "are"} still working${names.length > 0 ? `: ${names.join(", ")}` : ""}. Vyre wakes you once when the last one has finished; say this count, not a guess.`;
}
