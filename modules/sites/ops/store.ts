// The database side of site operations (r42-sites-run): logs, samples, services, jobs, runs and backups, over the tables of migration 0010.
// Each function takes a small `OpsDb` (all and run), so the same code runs on the module's db and on a bare SQLite in a test. The rules (caps, search, states) stay in logs.ts, metrics.ts, jobs.ts,
// workers.ts and backups.ts; this file only reads and writes rows and applies those rules to them.
import { LOG_CAPS, cleanLines, levelOf, limitOf, matches, terms } from "./logs.ts";
import type { LogCaps, LogLevel, LogLine, LogQuery, LogSource, ScopeInfo } from "./logs.ts";
import { KEEP_MINUTES, MINUTE, minuteOf } from "./metrics.ts";
import type { Sample } from "./metrics.ts";
import type { Job, Run, RunState } from "./jobs.ts";
import { KEEP_RUNS } from "./jobs.ts";
import type { Service, ServiceKind, ServiceState } from "./workers.ts";
import type { Backup, BackupState } from "./backups.ts";

export interface OpsDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const opt = <T>(v: unknown, f: (x: unknown) => T): T | undefined => (v === null || v === undefined ? undefined : f(v));
const rows = (db: OpsDb, sql: string, ...a: unknown[]): Row[] => db.all(sql, ...a) as Row[];

// ---- logs

/** A site keeps at most this many lines in all, whatever the scopes: the last line of defence against a site that prints without end. */
export const SITE_LOG_LINES = 100_000;

/** Store raw text for a scope as clean lines, then trim the scope and the site to their caps. Returns the lines stored. */
export function addLogs(
  db: OpsDb,
  siteId: string,
  scope: string,
  source: LogSource,
  items: readonly { at: number; text: string }[],
  caps: LogCaps = LOG_CAPS,
): number {
  let stored = 0;
  for (const it of items)
    for (const text of cleanLines(it.text, caps.lineChars)) {
      db.run("INSERT INTO sites_log (site_id, scope, source, at, level, text) VALUES (?, ?, ?, ?, ?, ?)", siteId, scope, source, it.at, levelOf(text), text);
      stored++;
    }
  if (stored > 0) trimScope(db, siteId, scope, caps);
  return stored;
}

/** The newest `lines` and `bytes` of a scope stay; what falls off is counted in the row sites_log keeps for it (a negative id never reused: see dropped()). */
export function trimScope(db: OpsDb, siteId: string, scope: string, caps: LogCaps = LOG_CAPS): void {
  const over = rows(
    db,
    `SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) AS n, SUM(LENGTH(text) + 1) OVER (ORDER BY id DESC) AS bytes FROM sites_log WHERE site_id = ? AND scope = ?) WHERE n > ? OR bytes > ?`,
    siteId,
    scope,
    caps.lines,
    caps.bytes,
  );
  if (over.length === 0) return;
  const ids = over.map((r) => n(r["id"]));
  const hi = Math.max(...ids);
  db.run("DELETE FROM sites_log WHERE site_id = ? AND scope = ? AND id <= ?", siteId, scope, hi);
  bumpDropped(db, siteId, scope, ids.length);
}

// how many lines of a scope fell off, kept as a cursor row named "dropped:<scope>" so a read can say "N earlier lines left out"
function bumpDropped(db: OpsDb, siteId: string, scope: string, by: number): void {
  const key = `dropped:${scope}`;
  const cur = rows(db, "SELECT ns FROM sites_log_cursor WHERE site_id = ? AND scope = ?", siteId, key)[0];
  const next = n(cur?.["ns"] ?? 0) + by;
  if (cur) db.run("UPDATE sites_log_cursor SET ns = ? WHERE site_id = ? AND scope = ?", String(next), siteId, key);
  else db.run("INSERT INTO sites_log_cursor (site_id, scope, ns) VALUES (?, ?, ?)", siteId, key, String(next));
}
export function dropped(db: OpsDb, siteId: string, scope: string): number {
  return n(rows(db, "SELECT ns FROM sites_log_cursor WHERE site_id = ? AND scope = ?", siteId, `dropped:${scope}`)[0]?.["ns"] ?? 0);
}

/** Past SITE_LOG_LINES the oldest lines of the whole site go, from whichever scope holds them. */
export function trimSite(db: OpsDb, siteId: string, max: number = SITE_LOG_LINES): number {
  const cut = rows(db, "SELECT id FROM sites_log WHERE site_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?", siteId, max)[0];
  if (!cut) return 0;
  return db.run("DELETE FROM sites_log WHERE site_id = ? AND id <= ?", siteId, n(cut["id"])).changes;
}

const lineOf = (r: Row): LogLine => ({
  seq: n(r["id"]),
  at: n(r["at"]),
  source: s(r["source"]) as LogSource,
  scope: s(r["scope"]),
  text: s(r["text"]),
  level: s(r["level"]) as LogLevel,
});

/** The newest matching lines, oldest first. `seq` is the row id, so a follower asks for `after` its last one. */
export function readLogs(db: OpsDb, siteId: string, q: LogQuery = {}): { lines: LogLine[]; dropped: number; lastSeq: number } {
  const ts = terms(q.q);
  const want = limitOf(q.limit);
  const where: string[] = ["site_id = ?"];
  const args: unknown[] = [siteId];
  if (q.scope !== undefined) {
    where.push("scope = ?");
    args.push(q.scope);
  }
  if (q.after !== undefined) {
    where.push("id > ?");
    args.push(q.after);
  }
  if (q.from !== undefined) {
    where.push("at >= ?");
    args.push(q.from);
  }
  if (q.to !== undefined) {
    where.push("at <= ?");
    args.push(q.to);
  }
  if (q.level !== undefined) {
    where.push("level = ?");
    args.push(q.level);
  }
  if (q.source !== undefined) {
    const src = typeof q.source === "string" ? [q.source] : [...q.source];
    where.push(`source IN (${src.map(() => "?").join(",")})`);
    args.push(...src);
  }
  // the words are matched in code, so a search means the same here as in a ring (logs.ts); a search reads at most the newest SEARCH_ROWS rows
  const cap = ts.length > 0 ? SEARCH_ROWS : want;
  const found = rows(db, `SELECT * FROM sites_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...args, cap).map(lineOf).filter((l) => matches(l, q, ts));
  const lines = found.slice(0, want).reverse();
  const last = rows(db, "SELECT MAX(id) AS m FROM sites_log WHERE site_id = ?", siteId)[0];
  return { lines, dropped: q.scope !== undefined ? dropped(db, siteId, q.scope) : 0, lastSeq: n(last?.["m"] ?? 0) };
}
export const SEARCH_ROWS = 20_000;

export function logScopes(db: OpsDb, siteId: string): ScopeInfo[] {
  return rows(
    db,
    "SELECT scope, source, COUNT(*) AS lines, SUM(LENGTH(text) + 1) AS bytes, MAX(at) AS lastAt FROM sites_log WHERE site_id = ? GROUP BY scope, source ORDER BY lastAt DESC",
    siteId,
  ).map((r) => ({ scope: s(r["scope"]), source: s(r["source"]) as LogSource, lines: n(r["lines"]), bytes: n(r["bytes"]), dropped: dropped(db, siteId, s(r["scope"])), lastAt: n(r["lastAt"]) }));
}

/** A scope's lines go when the thing they belong to goes (a removed deploy, a deleted job). */
export function dropScope(db: OpsDb, siteId: string, scope: string): void {
  db.run("DELETE FROM sites_log WHERE site_id = ? AND scope = ?", siteId, scope);
  db.run("DELETE FROM sites_log_cursor WHERE site_id = ? AND (scope = ? OR scope = ?)", siteId, scope, `dropped:${scope}`);
}
export function dropSiteOps(db: OpsDb, siteId: string): void {
  for (const t of ["sites_log", "sites_log_cursor", "sites_metric", "sites_service", "sites_job", "sites_job_run", "sites_backup"]) db.run(`DELETE FROM ${t} WHERE site_id = ?`, siteId);
}

export const getCursor = (db: OpsDb, siteId: string, scope: string): { ns: string } | undefined => {
  const r = rows(db, "SELECT ns FROM sites_log_cursor WHERE site_id = ? AND scope = ?", siteId, scope)[0];
  return r ? { ns: s(r["ns"]) } : undefined;
};
export function setCursor(db: OpsDb, siteId: string, scope: string, ns: string): void {
  if (db.run("UPDATE sites_log_cursor SET ns = ? WHERE site_id = ? AND scope = ?", ns, siteId, scope).changes === 0)
    db.run("INSERT INTO sites_log_cursor (site_id, scope, ns) VALUES (?, ?, ?)", siteId, scope, ns);
}

// ---- samples

/** The CPU and memory of a minute. The same minute written twice keeps the newer reading and leaves its request counts alone. */
export function putUsage(db: OpsDb, siteId: string, at: number, u: { cpu: number; memMb: number }): void {
  const m = minuteOf(at);
  db.run(
    "INSERT INTO sites_metric (site_id, at, cpu, mem_mb) VALUES (?, ?, ?, ?) ON CONFLICT (site_id, at) DO UPDATE SET cpu = excluded.cpu, mem_mb = excluded.mem_mb",
    siteId,
    m,
    u.cpu,
    u.memMb,
  );
  db.run("DELETE FROM sites_metric WHERE site_id = ? AND at < ?", siteId, m - KEEP_MINUTES * MINUTE);
}
/** Add requests to a minute without touching its CPU and memory (the request meter and the stats sampler close their minutes on their own). */
export function putRequests(db: OpsDb, siteId: string, at: number, r: { requests: number; errors: number; p50: number; p95: number }): void {
  const m = minuteOf(at);
  if (db.run("UPDATE sites_metric SET requests = requests + ?, errors = errors + ?, p50 = ?, p95 = ? WHERE site_id = ? AND at = ?", r.requests, r.errors, r.p50, r.p95, siteId, m).changes === 0)
    db.run("INSERT INTO sites_metric (site_id, at, requests, errors, p50, p95) VALUES (?, ?, ?, ?, ?, ?)", siteId, m, r.requests, r.errors, r.p50, r.p95);
}
export function readSamples(db: OpsDb, siteId: string, from: number, to: number): Sample[] {
  return rows(db, "SELECT * FROM sites_metric WHERE site_id = ? AND at >= ? AND at <= ? ORDER BY at", siteId, from, to).map((r) => ({
    at: n(r["at"]),
    cpu: n(r["cpu"]),
    memMb: n(r["mem_mb"]),
    requests: n(r["requests"]),
    errors: n(r["errors"]),
    p50: n(r["p50"]),
    p95: n(r["p95"]),
  }));
}

// ---- services

const serviceOf = (r: Row): Service & { command: string[]; containerId?: string; deploymentId?: string } => ({
  id: s(r["id"]),
  siteId: s(r["site_id"]),
  name: s(r["name"]),
  kind: s(r["kind"]) as ServiceKind,
  state: s(r["state"]) as ServiceState,
  ...(opt(r["started_at"], n) !== undefined ? { startedAt: n(r["started_at"]) } : {}),
  ...(opt(r["restart_at"], n) !== undefined ? { restartAt: n(r["restart_at"]) } : {}),
  streak: n(r["streak"]),
  crashes: json<number[]>(r["crashes"], []),
  ...(r["last_exit"] ? { lastExit: json(r["last_exit"], undefined as never) } : {}),
  ...(r["note"] ? { note: s(r["note"]) } : {}),
  command: json<string[]>(r["command"], []),
  ...(r["container_id"] ? { containerId: s(r["container_id"]) } : {}),
  ...(r["deployment_id"] ? { deploymentId: s(r["deployment_id"]) } : {}),
});
function json<T>(v: unknown, fb: T): T {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}
export type ServiceRow = ReturnType<typeof serviceOf>;

export function insertService(db: OpsDb, x: { id: string; siteId: string; name: string; kind: ServiceKind; command: string[]; deploymentId?: string; at: number }): void {
  db.run(
    "INSERT INTO sites_service (id, site_id, name, kind, command, state, deployment_id, created_at) VALUES (?, ?, ?, ?, ?, 'stopped', ?, ?)",
    x.id,
    x.siteId,
    x.name,
    x.kind,
    JSON.stringify(x.command),
    x.deploymentId ?? null,
    x.at,
  );
}
export function saveService(db: OpsDb, v: Service, containerId?: string | null): void {
  db.run(
    "UPDATE sites_service SET state = ?, started_at = ?, restart_at = ?, streak = ?, crashes = ?, last_exit = ?, note = ?" + (containerId !== undefined ? ", container_id = ?" : "") + " WHERE id = ?",
    v.state,
    v.startedAt ?? null,
    v.restartAt ?? null,
    v.streak,
    JSON.stringify(v.crashes),
    v.lastExit ? JSON.stringify(v.lastExit) : null,
    v.note ?? null,
    ...(containerId !== undefined ? [containerId] : []),
    v.id,
  );
}
export const getService = (db: OpsDb, id: string): ServiceRow | undefined => {
  const r = rows(db, "SELECT * FROM sites_service WHERE id = ? AND deleted_at IS NULL", id)[0];
  return r ? serviceOf(r) : undefined;
};
export const listServices = (db: OpsDb, siteId?: string): ServiceRow[] =>
  rows(db, siteId ? "SELECT * FROM sites_service WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at" : "SELECT * FROM sites_service WHERE deleted_at IS NULL ORDER BY created_at", ...(siteId ? [siteId] : [])).map(serviceOf);
export const deleteService = (db: OpsDb, id: string, at: number): void => void db.run("UPDATE sites_service SET deleted_at = ?, state = 'stopped' WHERE id = ?", at, id);

// ---- jobs and runs

const jobOf = (r: Row): Job => ({
  id: s(r["id"]),
  siteId: s(r["site_id"]),
  name: s(r["name"]),
  schedule: s(r["schedule"]),
  command: json<string[]>(r["command"], []),
  zone: s(r["zone"]),
  enabled: n(r["enabled"]) === 1,
  timeoutSec: n(r["timeout_sec"]),
  lastSlot: n(r["last_slot"]),
});
export function insertJob(db: OpsDb, j: Job, by: string, at: number): void {
  db.run(
    "INSERT INTO sites_job (id, site_id, name, schedule, command, zone, enabled, timeout_sec, last_slot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    j.id,
    j.siteId,
    j.name,
    j.schedule,
    JSON.stringify(j.command),
    j.zone,
    j.enabled ? 1 : 0,
    j.timeoutSec,
    j.lastSlot,
    by,
    at,
  );
}
export function saveJob(db: OpsDb, j: Job): void {
  db.run("UPDATE sites_job SET name = ?, schedule = ?, command = ?, zone = ?, enabled = ?, timeout_sec = ?, last_slot = ? WHERE id = ?", j.name, j.schedule, JSON.stringify(j.command), j.zone, j.enabled ? 1 : 0, j.timeoutSec, j.lastSlot, j.id);
}
export const getJob = (db: OpsDb, id: string): Job | undefined => {
  const r = rows(db, "SELECT * FROM sites_job WHERE id = ? AND deleted_at IS NULL", id)[0];
  return r ? jobOf(r) : undefined;
};
export const listJobs = (db: OpsDb, siteId?: string): Job[] =>
  rows(db, siteId ? "SELECT * FROM sites_job WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at" : "SELECT * FROM sites_job WHERE deleted_at IS NULL ORDER BY created_at", ...(siteId ? [siteId] : [])).map(jobOf);
export const deleteJob = (db: OpsDb, id: string, at: number): void => void db.run("UPDATE sites_job SET deleted_at = ?, enabled = 0 WHERE id = ?", at, id);

const runOf = (r: Row): Run => ({
  id: s(r["id"]),
  jobId: s(r["job_id"]),
  state: s(r["state"]) as RunState,
  slot: n(r["slot"]),
  by: s(r["by"]) as Run["by"],
  queuedAt: n(r["queued_at"]),
  ...(opt(r["started_at"], n) !== undefined ? { startedAt: n(r["started_at"]) } : {}),
  ...(opt(r["ended_at"], n) !== undefined ? { endedAt: n(r["ended_at"]) } : {}),
  ...(opt(r["exit_code"], n) !== undefined ? { exitCode: n(r["exit_code"]) } : {}),
  ...(r["note"] ? { note: s(r["note"]) } : {}),
});
export function insertRun(db: OpsDb, siteId: string, r: Run): void {
  db.run(
    "INSERT INTO sites_job_run (id, job_id, site_id, state, slot, by, queued_at, started_at, ended_at, exit_code, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    r.id,
    r.jobId,
    siteId,
    r.state,
    r.slot,
    r.by,
    r.queuedAt,
    r.startedAt ?? null,
    r.endedAt ?? null,
    r.exitCode ?? null,
    r.note ?? null,
  );
}
/** Save a run only when it is still in the state it was read in, so two writers (a finish and a timeout) cannot both win. Returns whether it was saved. */
export function saveRun(db: OpsDb, r: Run, was: RunState): boolean {
  return db.run("UPDATE sites_job_run SET state = ?, started_at = ?, ended_at = ?, exit_code = ?, note = ? WHERE id = ? AND state = ?", r.state, r.startedAt ?? null, r.endedAt ?? null, r.exitCode ?? null, r.note ?? null, r.id, was).changes === 1;
}
export const getRun = (db: OpsDb, id: string): (Run & { siteId: string }) | undefined => {
  const r = rows(db, "SELECT * FROM sites_job_run WHERE id = ?", id)[0];
  return r ? { ...runOf(r), siteId: s(r["site_id"]) } : undefined;
};
export const listRuns = (db: OpsDb, jobId: string, limit = KEEP_RUNS): Run[] => rows(db, "SELECT * FROM sites_job_run WHERE job_id = ? ORDER BY queued_at DESC, id DESC LIMIT ?", jobId, limit).map(runOf);
export const openRuns = (db: OpsDb, siteId?: string): (Run & { siteId: string })[] =>
  rows(db, `SELECT * FROM sites_job_run WHERE state IN ('queued','running')${siteId ? " AND site_id = ?" : ""} ORDER BY queued_at`, ...(siteId ? [siteId] : [])).map((r) => ({ ...runOf(r), siteId: s(r["site_id"]) }));
export const deleteRuns = (db: OpsDb, ids: readonly string[]): void => {
  for (const id of ids) db.run("DELETE FROM sites_job_run WHERE id = ?", id);
};

// ---- backups

const backupOf = (r: Row): Backup => ({
  id: s(r["id"]),
  siteId: s(r["site_id"]),
  kind: "postgres",
  state: s(r["state"]) as BackupState,
  by: s(r["by"]) as Backup["by"],
  at: n(r["at"]),
  ...(opt(r["ended_at"], n) !== undefined ? { endedAt: n(r["ended_at"]) } : {}),
  ...(opt(r["bytes"], n) !== undefined ? { bytes: n(r["bytes"]) } : {}),
  ...(r["file_id"] ? { fileId: s(r["file_id"]) } : {}),
  ...(r["note"] ? { note: s(r["note"]) } : {}),
  ...(n(r["pinned"]) === 1 ? { pinned: true } : {}),
});
export function insertBackup(db: OpsDb, b: Backup): void {
  db.run("INSERT INTO sites_backup (id, site_id, kind, state, by, at, pinned) VALUES (?, ?, ?, ?, ?, ?, 0)", b.id, b.siteId, b.kind, b.state, b.by, b.at);
}
export function saveBackup(db: OpsDb, b: Backup, was: BackupState): boolean {
  return db.run("UPDATE sites_backup SET state = ?, ended_at = ?, bytes = ?, file_id = ?, note = ? WHERE id = ? AND state = ?", b.state, b.endedAt ?? null, b.bytes ?? null, b.fileId ?? null, b.note ?? null, b.id, was).changes === 1;
}
export const setPinned = (db: OpsDb, id: string, pinned: boolean): void => void db.run("UPDATE sites_backup SET pinned = ? WHERE id = ?", pinned ? 1 : 0, id);
export const getBackup = (db: OpsDb, id: string): Backup | undefined => {
  const r = rows(db, "SELECT * FROM sites_backup WHERE id = ?", id)[0];
  return r ? backupOf(r) : undefined;
};
export const listBackups = (db: OpsDb, siteId?: string): Backup[] =>
  rows(db, `SELECT * FROM sites_backup${siteId ? " WHERE site_id = ?" : ""} ORDER BY at DESC`, ...(siteId ? [siteId] : [])).map(backupOf);
export const deleteBackups = (db: OpsDb, ids: readonly string[]): void => {
  for (const id of ids) db.run("DELETE FROM sites_backup WHERE id = ?", id);
};
