// The one place a node event row is written (r42-runtime): the node core (node.ts) and the mirror of flow Runs (node-flow.ts) both append here, so the sequence of a tree is made one way. No imports on purpose: projections.ts reaches
// the mirror, and the mirror must not reach back into projections.
export interface LogDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

/** Append an event to a tree's log. With a key, the same (node, key) twice is the first event: returns its seq and duplicate true. */
export function appendEvent(
  db: LogDb,
  e: {
    rootRun: string;
    runId: string;
    at: number;
    type: string;
    actor?: string | undefined;
    key?: string | undefined;
    payload?: unknown;
  },
): { seq: number; duplicate: boolean } {
  if (e.key !== undefined) {
    const have = (
      db.all("SELECT seq FROM runs_event WHERE run_id = ? AND event_key = ?", e.runId, e.key) as Array<{ seq: number }>
    )[0];
    if (have) return { seq: Number(have.seq), duplicate: true };
  }
  const m = (
    db.all("SELECT COALESCE(MAX(seq), 0) AS m FROM runs_event WHERE root_run = ?", e.rootRun) as Array<{ m: number }>
  )[0];
  const seq = Number(m?.m ?? 0) + 1;
  db.run(
    "INSERT INTO runs_event (root_run, seq, run_id, at, type, actor, event_key, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    e.rootRun,
    seq,
    e.runId,
    e.at,
    e.type,
    e.actor ?? null,
    e.key ?? null,
    JSON.stringify(e.payload ?? null),
  );
  return { seq, duplicate: false };
}
