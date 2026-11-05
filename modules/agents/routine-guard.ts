// A routine whose runs fail three times in a row for the same reason pauses itself (owner's Mac, 5 Nov: "Hi every minute" ran every minute for 24 hours and failed 1,448 times). It says so once in its chat, with
// the reason; the routine shows Paused and runs again when its owner resumes it, or by itself when the cause clears (a sign-in saved again).
import type { Db } from "./projections.ts";

export const ROUTINE_FAILS_TO_PAUSE = 3;
type Row = Record<string, unknown>;
const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run('CREATE TABLE IF NOT EXISTS agents_routine_streak ("routineId" TEXT PRIMARY KEY, "code" TEXT NOT NULL, "n" INTEGER NOT NULL)');
  db.run('CREATE TABLE IF NOT EXISTS agents_routine_selfpaused ("routineId" TEXT PRIMARY KEY, "reason" TEXT NOT NULL, "at" INTEGER NOT NULL)');
  ready.add(db as object);
}

/** One run of a routine ended. Returns the routine to pause with the reason, once, on the third failure in a row of one reason. */
export function noteRun(db: Db, routineId: string, ok: boolean, code: string, message: string, at: number): { title: string; threadId: string | null; reason: string } | null {
  ensure(db);
  if (ok) { db.run('DELETE FROM agents_routine_streak WHERE "routineId" = ?', routineId); return null; }
  const cur = (db.all('SELECT "code", "n" FROM agents_routine_streak WHERE "routineId" = ?', routineId) as Row[])[0];
  const n = cur && String(cur["code"]) === code ? Number(cur["n"]) + 1 : 1;
  db.run('INSERT INTO agents_routine_streak ("routineId", "code", "n") VALUES (?, ?, ?) ON CONFLICT ("routineId") DO UPDATE SET "code" = excluded."code", "n" = excluded."n"', routineId, code, n);
  if (n < ROUTINE_FAILS_TO_PAUSE) return null;
  const r = (db.all('SELECT "title", "channelId", "enabled" FROM agents_routine WHERE "id" = ?', routineId) as Row[])[0];
  if (!r || Number(r["enabled"]) !== 1) return null;
  const reason = message.replace(/\s*\[account [\w.-]+\]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || code;
  db.run('UPDATE agents_routine SET "enabled" = 0, "nextRunAt" = NULL, "updatedAt" = ? WHERE "id" = ?', at, routineId);
  db.run('INSERT OR REPLACE INTO agents_routine_selfpaused ("routineId", "reason", "at") VALUES (?, ?, ?)', routineId, reason, at);
  db.run('DELETE FROM agents_routine_streak WHERE "routineId" = ?', routineId);
  return { title: String(r["title"]), threadId: r["channelId"] ? String(r["channelId"]) : null, reason };
}

/** The cause may have cleared: every routine that paused itself starts again. Returns their ids. */
export function resumeSelfPaused(db: Db, at: number, nextRun: (cron: string, at: number) => number | null, agentId?: string): string[] {
  ensure(db);
  const ids = (agentId === undefined
    ? (db.all('SELECT "routineId" FROM agents_routine_selfpaused') as Row[])
    : (db.all('SELECT s."routineId" FROM agents_routine_selfpaused s JOIN agents_routine r ON r."id" = s."routineId" WHERE r."agentId" = ?', agentId) as Row[])).map((r) => String(r["routineId"]));
  for (const id of ids) {
    const r = (db.all('SELECT "cron" FROM agents_routine WHERE "id" = ?', id) as Row[])[0];
    if (r) db.run('UPDATE agents_routine SET "enabled" = 1, "nextRunAt" = ?, "updatedAt" = ? WHERE "id" = ?', nextRun(String(r["cron"]), at), at, id);
    db.run('DELETE FROM agents_routine_selfpaused WHERE "routineId" = ?', id);
  }
  return ids;
}

/** A person resumed or paused it by hand: it is theirs again, no longer self-paused. */
export function forgetSelfPause(db: Db, routineId: string): void { ensure(db); db.run('DELETE FROM agents_routine_selfpaused WHERE "routineId" = ?', routineId); }

export const selfPausedReason = (db: Db, routineId: string): string | undefined => { ensure(db); return ((db.all('SELECT "reason" FROM agents_routine_selfpaused WHERE "routineId" = ?', routineId) as Row[])[0]?.["reason"] as string | undefined); };
