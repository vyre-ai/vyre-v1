// The subagents a command-line engine starts on its own (finding F41, 14 Nov 2026). Vyre's helpers are threads of their own; a CLI's subagents are not: the engine runs them inside its turn and reports each as
// one Agent (or Task) call, the lines the subagent itself works through (tagged with that call), and the call's result. This reads those from the step stream (crew-watch.ts feeds it) and keeps one row per
// subagent, so engine.crew.status can list it beside the helpers and one strip, one island and one pane draw both. Nothing here is guessed: a row is a call the engine really made.
import { stepWords } from "../../lib/plain-words.ts";
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
const MAX_STEPS = 8;

export function ensureOwn(db: Db): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS engine_own_subagent (thread_id TEXT NOT NULL, call_id TEXT NOT NULL, agent_id TEXT NOT NULL, turn_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', step TEXT, steps TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'working', found TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, PRIMARY KEY (thread_id, call_id))",
  );
  db.run("CREATE INDEX IF NOT EXISTS engine_own_subagent_turn ON engine_own_subagent (turn_id)");
}

const names = new Map<string, string>(); // call id -> tool name, for the results that do not repeat it
const steps = (r: Row): string[] => {
  try {
    const v = JSON.parse(String(r["steps"] ?? "[]")) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** Read a batch of the turn's steps: a subagent starts, names its task, works, and returns. */
export function noteOwn(
  db: Db,
  e: { threadId: string; turnId: string; agentId: string },
  list: readonly unknown[],
  now: number,
): void {
  const finished: string[] = [];
  for (const raw of list) {
    const s = raw as Step;
    const id = typeof s.id === "string" ? s.id : "";
    if (id === "") continue;
    const parent = typeof s.parent === "string" && s.parent !== "" ? s.parent : "";
    // a call is known by name until its result: its input line does not repeat the name
    if (s.phase === "call" && typeof s.name === "string") names.set(id, s.name);
    if (s.phase === "result") finished.push(id);
    const name = names.get(id) ?? s.name ?? "";
    if (parent === "") {
      if (!SUBAGENT_CALL.test(name)) continue;
      ensureOwn(db);
      if (s.phase === "call") {
        db.run(
          "INSERT INTO engine_own_subagent (thread_id, call_id, agent_id, turn_id, started_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id, call_id) DO NOTHING",
          e.threadId,
          id,
          e.agentId,
          e.turnId,
          now,
        );
      } else if (s.phase === "input" && typeof s.detail === "string" && s.detail !== "") {
        db.run(
          "UPDATE engine_own_subagent SET title = ? WHERE thread_id = ? AND call_id = ?",
          s.detail,
          e.threadId,
          id,
        );
      } else if (s.phase === "result") {
        const found = typeof s.result === "string" ? s.result.trim() : "";
        db.run(
          "UPDATE engine_own_subagent SET state = ?, found = ?, step = NULL, ended_at = ? WHERE thread_id = ? AND call_id = ? AND state = 'working'",
          s.ok === false ? "failed" : "done",
          found === "" ? null : found,
          now,
          e.threadId,
          id,
        );
      }
      continue;
    }
    // a line the subagent itself works through: what it is on now, and the few before it
    const row = db.all(
      "SELECT steps, state FROM engine_own_subagent WHERE thread_id = ? AND call_id = ?",
      e.threadId,
      parent,
    )[0] as Row | undefined;
    if (!row || String(row["state"]) !== "working") continue;
    if (s.phase === "call") {
      const words = stepWords(name);
      const kept = [...steps(row), words].slice(-MAX_STEPS);
      db.run(
        "UPDATE engine_own_subagent SET step = ?, steps = ? WHERE thread_id = ? AND call_id = ?",
        words,
        JSON.stringify(kept),
        e.threadId,
        parent,
      );
    } else if (s.phase === "input" && typeof s.detail === "string" && s.detail !== "") {
      const words = stepWords(name, s.detail);
      const kept = steps(row);
      if (kept.length > 0) kept[kept.length - 1] = words;
      db.run(
        "UPDATE engine_own_subagent SET step = ?, steps = ? WHERE thread_id = ? AND call_id = ?",
        words,
        JSON.stringify(kept),
        e.threadId,
        parent,
      );
    }
  }
  for (const id of finished) names.delete(id);
}

/** The turn ended: a subagent that never returned (the turn was stopped, or the server went down under it) is stopped, not left working. */
export function settleOwn(db: Db, turnId: string, now: number): void {
  ensureOwn(db);
  db.run(
    "UPDATE engine_own_subagent SET state = 'stopped', step = NULL, ended_at = ? WHERE turn_id = ? AND state = 'working'",
    now,
    turnId,
  );
}

export interface OwnSubagent {
  callId: string;
  agentId: string;
  title: string;
  step?: string;
  steps: string[];
  state: "working" | "done" | "failed" | "stopped";
  found?: string;
  startedAt: number;
  endedAt?: number;
}

/** The subagents of one chat, oldest first. A row left working by a server that went away is read as stopped. */
export function listOwn(db: Db, threadId: string, liveTurnIds: ReadonlySet<string>): OwnSubagent[] {
  ensureOwn(db);
  return (
    db.all("SELECT * FROM engine_own_subagent WHERE thread_id = ? ORDER BY started_at, rowid", threadId) as Row[]
  ).map((r) => {
    const working = String(r["state"]) === "working" && liveTurnIds.has(String(r["turn_id"]));
    const state =
      String(r["state"]) === "working" && !working ? "stopped" : (String(r["state"]) as OwnSubagent["state"]);
    return {
      callId: String(r["call_id"]),
      agentId: String(r["agent_id"]),
      title: String(r["title"] ?? ""),
      ...(working && r["step"] ? { step: String(r["step"]) } : {}),
      steps: steps(r),
      state,
      ...(r["found"] ? { found: String(r["found"]) } : {}),
      startedAt: Number(r["started_at"]),
      ...(r["ended_at"] !== null && r["ended_at"] !== undefined ? { endedAt: Number(r["ended_at"]) } : {}),
    };
  });
}
