// Durable cursor and tick claims for one schedule. The planner stays pure. This module only remembers what it decided.
import type { Db } from "../projections.ts";

export interface ScheduleState {
  automationId: string;
  cursor: number;
  paused: boolean;
  pausedReason?: string;
  requestOpen: boolean;
}

interface StateRow {
  automation_id: string;
  cursor_ms: number;
  paused: number;
  paused_reason: string | null;
  request_open: number;
}

function fromRow(row: StateRow): ScheduleState {
  const state: ScheduleState = {
    automationId: row.automation_id,
    cursor: row.cursor_ms,
    paused: row.paused === 1,
    requestOpen: row.request_open === 1,
  };
  if (row.paused_reason) state.pausedReason = row.paused_reason;
  return state;
}

export function readState(db: Db, automationId: string): ScheduleState | undefined {
  const rows = db.all(
    `SELECT "automation_id", "cursor_ms", "paused", "paused_reason", "request_open" FROM "automations_schedule_state" WHERE "automation_id" = ?`,
    automationId,
  ) as StateRow[];
  return rows[0] ? fromRow(rows[0]) : undefined;
}

/** First time this schedule is seen, the cursor is now, so earlier history is not a backlog. `armed` is true only on that insert. */
export function armState(db: Db, automationId: string, now: number): { state: ScheduleState; armed: boolean } {
  const have = readState(db, automationId);
  if (have) return { state: have, armed: false };
  db.run(
    `INSERT INTO "automations_schedule_state" ("automation_id", "cursor_ms", "paused", "paused_reason", "request_open", "updated_at") VALUES (?, ?, 0, NULL, 0, ?)`,
    automationId, now, now,
  );
  return { state: { automationId, cursor: now, paused: false, requestOpen: false }, armed: true };
}

export function saveCursor(db: Db, automationId: string, cursor: number, now: number): void {
  db.run(
    `UPDATE "automations_schedule_state" SET "cursor_ms" = ?, "updated_at" = ? WHERE "automation_id" = ?`,
    cursor, now, automationId,
  );
}

export function savePaused(db: Db, automationId: string, paused: boolean, reason: string | undefined, now: number): void {
  db.run(
    `UPDATE "automations_schedule_state" SET "paused" = ?, "paused_reason" = ?, "updated_at" = ? WHERE "automation_id" = ?`,
    paused ? 1 : 0, reason ?? null, now, automationId,
  );
}

export function saveRequestOpen(db: Db, automationId: string, open: boolean, now: number): void {
  db.run(
    `UPDATE "automations_schedule_state" SET "request_open" = ?, "updated_at" = ? WHERE "automation_id" = ?`,
    open ? 1 : 0, now, automationId,
  );
}

export function claimedTickIds(db: Db, automationId: string): Set<string> {
  const rows = db.all(`SELECT "tick_id" FROM "automations_schedule_claims" WHERE "automation_id" = ?`, automationId) as { tick_id: string }[];
  return new Set(rows.map((row) => row.tick_id));
}

export function lastClaimedAt(db: Db, automationId: string): number | undefined {
  const rows = db.all(
    `SELECT MAX("claimed_at") AS "at" FROM "automations_schedule_claims" WHERE "automation_id" = ?`,
    automationId,
  ) as { at: number | null }[];
  const at = rows[0]?.at;
  return typeof at === "number" ? at : undefined;
}

/** Remember a tick that started. A second insert of the same tick id does nothing. */
export function claimStarted(db: Db, tick: { tickId: string; automationId: string; fireAt: number; runId: string; at: number }): void {
  db.run(
    `INSERT OR IGNORE INTO "automations_schedule_claims" ("tick_id", "automation_id", "fire_at", "run_id", "claimed_at") VALUES (?, ?, ?, ?, ?)`,
    tick.tickId, tick.automationId, tick.fireAt, tick.runId, tick.at,
  );
}
