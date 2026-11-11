// What keeps a synced type current by itself (spec 2.10). A synced type polls as a chain: a finished pass plans the next poll (planPoll in sync.ts). The chain has holes: a pass that failed, a poll job
// that was lost, or a type nobody has pulled yet leaves no next poll, so the type goes stale until a person presses Resync. This is the periodic driver that closes them. Every 30 seconds it looks at each
// synced type and, only when the type has no poll coming, is not paused, has a usable connection, is not failing too fast and is not already running, starts one pass through connectors.sync_now
// (so the Gate, the permissions and the audit apply as for a person). The pass plans the next poll itself, so a revived chain carries on without this driver.
import type { Tx } from "../../../kernel/src/store/projection.ts";

export interface Polling { activeSec: number; idleSec: number; dormantSec: number }

/** A running mark older than this is a pass that died: it no longer blocks the connection. */
export const RUN_STALE_MS = 30 * 60_000;
/** A planned poll more than this late is a lost job: the chain counts as dead. */
export const POLL_GRACE_MS = 5 * 60_000;
/** The longest wait after repeated failures. */
export const BACKOFF_CAP_MS = 60 * 60_000;

export const CADENCE_SQL = `
-- One pass at a time per connection: set when a pass is asked for, cleared when it ends (a mark that is never cleared goes stale).
CREATE TABLE IF NOT EXISTS cn_sync_running (connection_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
-- Failures in a row per synced type, and the earliest time the driver may try again.
CREATE TABLE IF NOT EXISTS cn_sync_guard (sync_type_id TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL, next_at INTEGER NOT NULL DEFAULT 0);
`;
const ready = new WeakSet<object>();
export function ensureCadenceTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(CADENCE_SQL);
  ready.add(tx);
}

/** The wait after `failures` failures in a row: the idle interval, doubled each time, never more than an hour. */
export const backoffMs = (polling: Polling, failures: number): number => Math.min(BACKOFF_CAP_MS, polling.idleSec * 1000 * 2 ** Math.max(0, failures - 1));

export function markRunning(tx: Tx, connectionId: string, now: number): void {
  ensureCadenceTables(tx);
  tx.run("INSERT INTO cn_sync_running (connection_id, started_at) VALUES (?, ?) ON CONFLICT(connection_id) DO UPDATE SET started_at = excluded.started_at", connectionId, now);
}
export function clearRunning(tx: Tx, connectionId: string): void {
  ensureCadenceTables(tx);
  tx.run("DELETE FROM cn_sync_running WHERE connection_id = ?", connectionId);
}
export function isRunning(tx: Tx, connectionId: string, now: number): boolean {
  ensureCadenceTables(tx);
  const r = tx.get<{ started_at: number }>("SELECT started_at FROM cn_sync_running WHERE connection_id = ?", connectionId);
  return r !== undefined && now - r.started_at < RUN_STALE_MS;
}

/** A pass ended. A success clears the failure count; a failure counts it and says when the driver may try again (returned, so a poll chain can wait the same time). */
export function noteResult(tx: Tx, syncTypeId: string, polling: Polling, ok: boolean, now: number): number {
  ensureCadenceTables(tx);
  if (ok) { tx.run("INSERT INTO cn_sync_guard (sync_type_id, failures, last_at, next_at) VALUES (?, 0, ?, 0) ON CONFLICT(sync_type_id) DO UPDATE SET failures = 0, last_at = excluded.last_at, next_at = 0", syncTypeId, now); return 0; }
  const failures = (tx.get<{ failures: number }>("SELECT failures FROM cn_sync_guard WHERE sync_type_id = ?", syncTypeId)?.failures ?? 0) + 1;
  const next = now + backoffMs(polling, failures);
  tx.run("INSERT INTO cn_sync_guard (sync_type_id, failures, last_at, next_at) VALUES (?, ?, ?, ?) ON CONFLICT(sync_type_id) DO UPDATE SET failures = excluded.failures, last_at = excluded.last_at, next_at = excluded.next_at", syncTypeId, failures, now, next);
  return next;
}

export interface CadenceDeps { tx: Tx; now: () => number; call: (cap: string, input: unknown) => Promise<unknown> }
export interface Due { syncTypeId: string; type: string; connectionId: string; slot: number }

interface Row { sync_type_id: string; type: string; connection_id: string; polling: string; paused: number; created_at: number; last_run_at: number | null; poll_at: number | null; last_at: number | null; next_at: number | null; conn_state: string | null }
const hasTable = (tx: Tx, name: string): boolean => tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined;

/** The synced types that need a pass now. Nothing is returned for a paused type, a connection that is not active (paused, pending, needs reconnect, gone), a connection with a pass running, a type whose poll is still coming, or a type still waiting out its backoff. */
export function dueSyncs(d: Pick<CadenceDeps, "tx" | "now">): Due[] {
  if (!hasTable(d.tx, "cn_synced_types")) return [];
  ensureCadenceTables(d.tx);
  const now = d.now();
  const state = hasTable(d.tx, "sy_state");
  const outbox = hasTable(d.tx, "sy_outbox");
  const rows = d.tx.all<Row>(
    `SELECT t.sync_type_id, t.type, t.connection_id, t.polling, t.paused, t.created_at,
       ${state ? "(SELECT s.last_run_at FROM sy_state s WHERE s.sync_type = t.sync_type_id)" : "NULL"} AS last_run_at,
       (SELECT p.at FROM cn_sync_poll p WHERE p.sync_type_id = t.sync_type_id) AS poll_at,
       (SELECT g.last_at FROM cn_sync_guard g WHERE g.sync_type_id = t.sync_type_id) AS last_at,
       (SELECT g.next_at FROM cn_sync_guard g WHERE g.sync_type_id = t.sync_type_id) AS next_at,
       (SELECT c.state FROM cn_connections c WHERE c.connection_id = t.connection_id) AS conn_state
     FROM cn_synced_types t ORDER BY t.created_at, t.rowid`,
  );
  const out: Due[] = [];
  const busy = new Set<string>();   // one pass per connection per tick: types of one connection go one at a time
  for (const r of rows) {
    if (r.paused === 1) continue;
    if (r.conn_state !== "active") continue;
    if (busy.has(r.connection_id) || isRunning(d.tx, r.connection_id, now)) continue;
    if (r.poll_at !== null && now < r.poll_at + POLL_GRACE_MS) continue;   // the chain is alive: its next poll will run
    if (r.next_at !== null && now < r.next_at) continue;   // backing off after failures
    const polling = JSON.parse(r.polling) as Polling;
    const waiting = outbox && (d.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_outbox WHERE sync_type = ? AND status IN ('pending', 'failed')", r.sync_type_id)?.n ?? 0) > 0;
    const every = 1000 * (waiting ? polling.activeSec : polling.idleSec);
    const last = Math.max(r.created_at, r.last_run_at ?? 0, r.last_at ?? 0);
    if (now - last < every) continue;
    busy.add(r.connection_id);
    out.push({ syncTypeId: r.sync_type_id, type: r.type, connectionId: r.connection_id, slot: Math.floor(now / every) });
  }
  return out;
}

/** Starts one pass for each due type. A refusal for one type counts as a failure for it (so it backs off) and does not stop the others. */
export async function runCadence(d: CadenceDeps, log?: { warn?(msg: string, attrs?: Record<string, unknown>): void }): Promise<Due[]> {
  const started: Due[] = [];
  for (const due of dueSyncs(d)) {
    try {
      await d.call("connectors.sync_now", { syncTypeId: due.syncTypeId, mode: "incremental", idempotencyKey: `cadence:${due.syncTypeId}:${due.slot}` });
      started.push(due);
    } catch (e) {
      clearRunning(d.tx, due.connectionId);
      const row = d.tx.get<{ polling: string }>("SELECT polling FROM cn_synced_types WHERE sync_type_id = ?", due.syncTypeId);
      noteResult(d.tx, due.syncTypeId, row ? JSON.parse(row.polling) as Polling : { activeSec: 120, idleSec: 900, dormantSec: 3600 }, false, d.now());
      log?.warn?.("connectors: a scheduled sync could not start", { type: due.type, error: e instanceof Error ? e.message : String((e as { error?: { message?: string } })?.error?.message ?? e) });
    }
  }
  return started;
}
