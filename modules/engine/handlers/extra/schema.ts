// Tables of the engine capabilities that the first engine packet left over (turn records, policy, defaults, review, person switches).
// They sit next to the migration's tables and follow the same rule: every name starts with engine_, which is all ctx.db lets a module touch.
// DECISION: the turn records are written only by the engine.turn.* system capabilities, so a host that did not run the turn can still answer
//   engine.turn.get and engine.turns.list from SQL. The in-process TurnEngine keeps its own copy for the live worker.
import { ensure } from "../../projections.ts";
import type { Db } from "../../projections.ts";

const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS engine_turns (
    turn_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    asker TEXT NOT NULL,
    account_ref TEXT,
    engine TEXT NOT NULL,
    model TEXT NOT NULL,
    placement TEXT NOT NULL,
    state TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    run_id TEXT,
    qseq INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    tokens_in INTEGER NOT NULL,
    tokens_out INTEGER NOT NULL,
    cost_micros INTEGER NOT NULL,
    error TEXT,
    retry_of TEXT
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS engine_turns_queue ON engine_turns (thread_id, qseq)",
  "CREATE INDEX IF NOT EXISTS engine_turns_thread ON engine_turns (thread_id, started_at)",
  `CREATE TABLE IF NOT EXISTS engine_turn_blocks (
    turn_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (turn_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS engine_turn_fallbacks (
    turn_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    kind TEXT NOT NULL,
    to_what TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (turn_id, n)
  )`,
  `CREATE TABLE IF NOT EXISTS engine_turn_parks (
    turn_id TEXT PRIMARY KEY,
    task_id TEXT,
    block_id TEXT,
    run_id TEXT,
    until_at INTEGER,
    at INTEGER NOT NULL
  )`,
  "CREATE TABLE IF NOT EXISTS engine_policy (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS engine_defaults (person_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS engine_review (
    turn_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    sampled_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at INTEGER,
    note TEXT,
    incident_id TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS engine_review_state ON engine_review (state, sampled_at)",
  `CREATE TABLE IF NOT EXISTS engine_person_flags (
    person_id TEXT NOT NULL,
    flag TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    wrapped_key TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (person_id, flag)
  )`,
];

const ready = new WeakSet<object>();

/** Make sure the base engine tables and these exist. One cheap probe per handle. */
export function ensureExtra(db: Db): void {
  ensure(db);
  if (ready.has(db)) return;
  try {
    db.all("SELECT person_id FROM engine_person_flags WHERE person_id = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
  }
  ready.add(db);
}
