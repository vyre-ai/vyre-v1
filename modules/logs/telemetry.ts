import type { TelemetryBatch, TelemetryPosition } from '../../lib/telemetry.ts';
import type { ScopedDb } from '../../packages/contracts/src/ctx.ts';
import { DAY_MS, LogWriter, foldRows, holdActive, readSettings } from './handlers/sink.ts';

// Only enumerated templates cross from native logs; identifier-shaped provider output is not metadata.
const MESSAGES = new Set(['audit','invoke','live.opened','live.closed','ws.call','ws.call.failed','service.state','job.ran','events.verified','daemon.started','daemon.stopping','boot.device','access.agent_resource_reconciled','access.agent_principal_reconciled','access.sync_failed','exports.cleanup_failed','hooks.pump_failed','projections.pump_failed','runs.recover_failed','identity.space_failed','spaces.profile_failed','schema.seed_failed','restore.tombstones_reapplied','seam.no_driver','schedule.failed','relay.link','computers.fill','scheduler.job_slow','scheduler.loop_blocked','scheduler.job_failed','invoke.reads','invoke.recovered','logs.prune_failed','supervisor.report_failed','supervisor.exit','supervisor.stop_failed']);
const REASONS = new Set(['ok','no_grant','expired','wrong_space','needs_approval','limit','not_a_member','revoked','unknown_action','bad_input','not_found','not_contained','role_lacks_permission','above_clearance','on_hold','suspended','provider_label','agent_needs_actor']);
const STATES = new Set(['ok','held','denied','error','allow','deny','hold','healthy','degraded','down','idle','starting','running','stopping','backoff','failed','stopped']);
const NUMBERS = new Set(['restarts','seq','at','count','ms','attempts','latencyMs','bytes','timeoutMs','crashes']);
function metadata(attrs: Record<string, unknown> | null | undefined, capabilities: ReadonlySet<string>): Record<string, unknown> {
 const out: Record<string, unknown> = {};
 for (const [key,value] of Object.entries(attrs ?? {})) {
  if (NUMBERS.has(key) && typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  if (typeof value !== 'string') continue;
  if (key === 'cap' && capabilities.has(value) || key === 'reason' && REASONS.has(value) || ['state','status','outcome','phase'].includes(key) && STATES.has(value)) out[key] = value;
  if (key === 'traceId' && /^[a-f0-9]{32}$/.test(value) || ['spanId','parent'].includes(key) && /^[a-f0-9]{16}$/.test(value)) out[key] = value;
 }
 return out;
}

/** A routine success the host counted (a poll's job.ran, invoke.reads): a debug row carrying a count. The mirror keeps failures and changes, not these. */
const rolledUp = (row: { level: number; msg: string; attrs?: Record<string, unknown> | undefined }): boolean => row.level < 20 && typeof row.attrs?.['count'] === 'number';

/** Host-generated batches enter the same validation/redaction path as all structured logs. */
export function appendTelemetry(ctx: { space: string; db: ScopedDb; now(): number; secrets(): readonly string[]; capabilities: readonly string[] }, batch: TelemetryBatch): void {
 if (batch.rows.length > 1000 || batch.spans.length > 1000) throw new Error('Telemetry batch exceeds its limit.');
 const previous = telemetryPosition(ctx, batch.source);
 if (previous.rowId >= batch.position.rowId && previous.spanId >= batch.position.spanId) return;
 if (previous.rowId > batch.position.rowId || previous.spanId > batch.position.spanId) throw new Error('Telemetry source moved behind its committed checkpoint.');
 const capabilities = new Set(ctx.capabilities);
 const writer = new LogWriter({ db: ctx.db, space: ctx.space, now: ctx.now, secrets: ctx.secrets, batchMs: 1, minLevel: readSettings(ctx.db, ctx.space).level });
 for (const row of batch.rows) if (row.space === ctx.space && !rolledUp(row)) writer.write({ ...row, msg: MESSAGES.has(row.msg) ? row.msg : row.msg === 'handler threw' ? 'invoke.failed' : 'log.redacted', cap: row.cap && capabilities.has(row.cap) ? row.cap : undefined, attrs: metadata(row.attrs, capabilities) });
 for (const span of batch.spans) writer.span({ ...span, name: ['invoke','ws.call'].includes(span.name) ? span.name : 'host.span', attrs: metadata(span.attrs, capabilities) });
 writer.flush();
 ctx.db.run("INSERT INTO logs_host_checkpoint (source, row_id, span_id) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET row_id = excluded.row_id, span_id = excluded.span_id", batch.source, batch.position.rowId, batch.position.spanId);
}

export function telemetryPosition(ctx: { db: ScopedDb }, source: string): TelemetryPosition {
 const row = ctx.db.all('SELECT row_id, span_id FROM logs_host_checkpoint WHERE source = ?', source)[0] as {row_id:number;span_id:number}|undefined;
 return { rowId: row?.row_id ?? 0, spanId: row?.span_id ?? 0 };
}

/** The mirror's running caps: host spans for a week (or the Space's shorter full-detail window), and at most this many spans and rows. */
export const TELEMETRY_KEEP_MS = 7 * DAY_MS;
export const SPAN_CAP = 200_000;
export const ROW_CAP = 200_000;
const CAP_BATCH = 2_000;

/**
 * One small step of the caps, for the host to run in its own short transaction, again and again until it removes nothing: spans past the age go first, then the oldest spans over the span
 * cap; rows past the Space's full-detail window, then the oldest rows over the row cap, are folded into the per-day aggregates as the daily retention does. A hold on the logs stops it.
 * Returns how many spans and rows it removed.
 */
export function capTelemetry(ctx: { space: string; db: ScopedDb; now(): number; caps?: { spans: number; rows: number } }): number {
 const now = ctx.now();
 if (holdActive(ctx.db, ctx.space, now)) return 0;
 const s = readSettings(ctx.db, ctx.space);
 const spanBefore = now - Math.min(TELEMETRY_KEEP_MS, s.fullDays * DAY_MS);
 let removed = ctx.db.run('DELETE FROM logs_span WHERE rowid IN (SELECT rowid FROM logs_span WHERE at < ? AND space = ? ORDER BY at LIMIT ?)', spanBefore, ctx.space, CAP_BATCH).changes;
 if (!removed && over(ctx.db, 'logs_span', 'rowid', ctx.caps?.spans ?? SPAN_CAP)) removed = ctx.db.run('DELETE FROM logs_span WHERE rowid IN (SELECT rowid FROM logs_span WHERE space = ? ORDER BY at LIMIT ?)', ctx.space, CAP_BATCH).changes;
 if (removed) return removed;
 removed = foldRows(ctx.db, ctx.space, now - s.fullDays * DAY_MS, CAP_BATCH).deleted;
 if (!removed && over(ctx.db, 'logs_row', 'id', ctx.caps?.rows ?? ROW_CAP)) removed = foldRows(ctx.db, ctx.space, Infinity, CAP_BATCH).deleted;
 return removed;
}

/** More rows than the cap. The id range bounds the count from above, so the full count runs only when the range is past the cap. */
function over(db: ScopedDb, table: 'logs_span' | 'logs_row', key: 'rowid' | 'id', cap: number): boolean {
 const r = db.all(`SELECT MIN(${key}) AS lo, MAX(${key}) AS hi FROM ${table}`)[0] as { lo: number | null; hi: number | null } | undefined;
 if (!r || r.hi === null || r.lo === null || r.hi - r.lo + 1 <= cap) return false;
 return Number((db.all(`SELECT COUNT(*) AS n FROM ${table}`)[0] as { n: number }).n) > cap;
}
