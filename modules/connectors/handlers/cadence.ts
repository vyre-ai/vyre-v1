// Sync cadence (spec 2.10: cursor polling 2 min in use, 15 min idle, 1 h dormant, plus a nightly reconcile). Nothing else calls connectors.sync_now on a timer; the periodic hook in impl.ts
// asks `dueSyncs` which synced types are due and starts one run for each through the same capability a person uses, so the Gate, the permissions and the audit all apply.
// "In use" is read from a signal the host can hand over (`usedAt`: the last time a person looked at the type); without one every type counts as idle, never as active, so nothing polls
// faster than a person asked for.
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { ConflictRule, FieldMapRow, PollingRow, SyncMode } from "./sync.ts";

/** 2 minutes in use, 15 minutes idle, 1 hour dormant. */
export const DEFAULT_POLLING: PollingRow = { activeSec: 120, idleSec: 900, dormantSec: 3600 };

export type UseState = "active" | "idle" | "dormant";
/** A type someone looked at in the last 15 minutes is in use; one nobody opened for a week is dormant. */
export const ACTIVE_WINDOW_MS = 15 * 60_000;
export const DORMANT_AFTER_MS = 7 * 24 * 3_600_000;
/** The nightly reconcile is due once per UTC day, from 03:00 UTC. */
export const NIGHTLY_HOUR_UTC = 3;

export function useStateOf(lastUsedAt: number | undefined, now: number): UseState {
  if (lastUsedAt === undefined) return "idle";
  const age = now - lastUsedAt;
  return age <= ACTIVE_WINDOW_MS ? "active" : age >= DORMANT_AFTER_MS ? "dormant" : "idle";
}

export const intervalMs = (p: PollingRow, state: UseState): number => 1000 * (state === "active" ? p.activeSec : state === "idle" ? p.idleSec : p.dormantSec);

const SENSITIVE = /(ssn|social_security|password|passwd|secret|token|tax_?id|birth|dob|salary|iban|account_number|card)/i;
/** What a new synced type's conflict rule is when the person did not choose one: newest wins, but a type that mirrors a sensitive-looking field asks first. */
export function conflictDefault(fields: readonly FieldMapRow[], given: ConflictRule | undefined): ConflictRule {
  if (given !== undefined) return given;
  return fields.some((f) => f.dir !== "off" && (SENSITIVE.test(f.remote) || SENSITIVE.test(f.key))) ? "ask" : "newest";
}

export interface DueSync { syncTypeId: string; type: string; mode: Extract<SyncMode, "incremental" | "reconcile">; useState: UseState; slot: number }
export interface CadenceDeps { tx: Tx; now: () => number; usedAt?: (type: string) => number | undefined }

interface Row { sync_type_id: string; type: string; connection_id: string; polling: string; nightly: number; paused: number; schema_changes: string; created_at: number; last_run_at: number | null; last_req_at: number | null; last_reconcile_at: number | null }

const hasTable = (tx: Tx, name: string): boolean => tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined;

/** Synced types whose turn has come, with the mode to run. A paused type, a type with schema changes waiting for review and a type whose connection is not usable are left alone. */
export function dueSyncs(d: CadenceDeps): DueSync[] {
  if (!hasTable(d.tx, "cn_synced_types")) return [];
  const now = d.now();
  const state = hasTable(d.tx, "sy_state");
  const reqs = hasTable(d.tx, "cn_sync_requests");
  const rows = d.tx.all<Row>(
    `SELECT t.sync_type_id, t.type, t.connection_id, t.polling, t.nightly, t.paused, t.schema_changes, t.created_at,
       ${state ? "(SELECT s.last_run_at FROM sy_state s WHERE s.sync_type = t.sync_type_id)" : "NULL"} AS last_run_at,
       ${reqs ? "(SELECT max(r.at) FROM cn_sync_requests r WHERE r.sync_types LIKE '%\"' || t.sync_type_id || '\"%')" : "NULL"} AS last_req_at,
       ${reqs ? "(SELECT max(r.at) FROM cn_sync_requests r WHERE r.mode = 'reconcile' AND r.sync_types LIKE '%\"' || t.sync_type_id || '\"%')" : "NULL"} AS last_reconcile_at
     FROM cn_synced_types t ORDER BY t.created_at, t.rowid`,
  );
  const out: DueSync[] = [];
  const dayStart = now - (now % 86_400_000);
  for (const r of rows) {
    if (r.paused === 1) continue;
    if ((JSON.parse(r.schema_changes) as unknown[]).length > 0) continue;
    const conn = d.tx.get<{ state: string }>("SELECT state FROM cn_connections WHERE connection_id = ?", r.connection_id);
    if (!conn || conn.state === "needs_reconnect" || conn.state === "paused" || conn.state === "pending") continue;
    // the last turn this type had: a run the engine finished, or a run already asked for (so a slow run is not asked for again)
    const last = Math.max(r.created_at, r.last_run_at ?? 0, r.last_req_at ?? 0);
    const use = useStateOf(d.usedAt?.(r.type), now);
    const polling = JSON.parse(r.polling) as PollingRow;
    const nightlyDue = r.nightly === 1 && now >= dayStart + NIGHTLY_HOUR_UTC * 3_600_000 && (r.last_reconcile_at ?? 0) < dayStart + NIGHTLY_HOUR_UTC * 3_600_000;
    if (nightlyDue) { out.push({ syncTypeId: r.sync_type_id, type: r.type, mode: "reconcile", useState: use, slot: Math.floor(now / 86_400_000) }); continue; }
    const every = intervalMs(polling, use);
    if (now - last >= every) out.push({ syncTypeId: r.sync_type_id, type: r.type, mode: "incremental", useState: use, slot: Math.floor(now / every) });
  }
  return out;
}

/** Starts a run for each due type. The idempotency key names the type, the mode and the time slot, so a tick that runs twice (or two servers) starts one run. A refusal for one type does not stop the others. */
export async function runDue(d: CadenceDeps, call: (cap: string, input: unknown) => Promise<unknown>, log?: { warn(msg: string, attrs?: Record<string, unknown>): void }): Promise<DueSync[]> {
  const started: DueSync[] = [];
  for (const due of dueSyncs(d)) {
    try {
      await call("connectors.sync_now", { syncTypeId: due.syncTypeId, mode: due.mode, idempotencyKey: `cadence:${due.syncTypeId}:${due.mode}:${due.slot}` });
      started.push(due);
    } catch (e) {
      log?.warn("connectors: a scheduled sync could not start", { type: due.type, mode: due.mode, error: e instanceof Error ? e.message : String((e as { error?: { message?: string } })?.error?.message ?? e) });
    }
  }
  return started;
}
