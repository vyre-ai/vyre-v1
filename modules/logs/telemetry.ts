import type { TelemetryBatch, TelemetryPosition } from '../../lib/telemetry.ts';
import type { ScopedDb } from '../../packages/contracts/src/ctx.ts';
import { LogWriter, readSettings } from './handlers/sink.ts';

// Only enumerated templates cross from native logs; identifier-shaped provider output is not metadata.
const MESSAGES = new Set(['audit','invoke','live.opened','live.closed','ws.call','ws.call.failed','service.state','job.ran','events.verified','daemon.started','daemon.stopping','boot.device','access.agent_resource_reconciled','access.agent_principal_reconciled','access.sync_failed','exports.cleanup_failed','hooks.pump_failed','projections.pump_failed','runs.recover_failed','identity.space_failed','spaces.profile_failed','schema.seed_failed','restore.tombstones_reapplied','seam.no_driver','schedule.failed','relay.link','computers.fill','scheduler.job_slow','scheduler.job_failed','supervisor.report_failed','supervisor.exit','supervisor.stop_failed']);
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

/** Host-generated batches enter the same validation/redaction path as all structured logs. */
export function appendTelemetry(ctx: { space: string; db: ScopedDb; now(): number; secrets(): readonly string[]; capabilities: readonly string[] }, batch: TelemetryBatch): void {
 if (batch.rows.length > 1000 || batch.spans.length > 1000) throw new Error('Telemetry batch exceeds its limit.');
 const previous = telemetryPosition(ctx, batch.source);
 if (previous.rowId >= batch.position.rowId && previous.spanId >= batch.position.spanId) return;
 if (previous.rowId > batch.position.rowId || previous.spanId > batch.position.spanId) throw new Error('Telemetry source moved behind its committed checkpoint.');
 const capabilities = new Set(ctx.capabilities);
 const writer = new LogWriter({ db: ctx.db, space: ctx.space, now: ctx.now, secrets: ctx.secrets, batchMs: 1, minLevel: readSettings(ctx.db, ctx.space).level });
 for (const row of batch.rows) if (row.space === ctx.space) writer.write({ ...row, msg: MESSAGES.has(row.msg) ? row.msg : row.msg === 'handler threw' ? 'invoke.failed' : 'log.redacted', cap: row.cap && capabilities.has(row.cap) ? row.cap : undefined, attrs: metadata(row.attrs, capabilities) });
 for (const span of batch.spans) writer.span({ ...span, name: ['invoke','ws.call'].includes(span.name) ? span.name : 'host.span', attrs: metadata(span.attrs, capabilities) });
 writer.flush();
 ctx.db.run("INSERT INTO logs_host_checkpoint (source, row_id, span_id) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET row_id = excluded.row_id, span_id = excluded.span_id", batch.source, batch.position.rowId, batch.position.spanId);
}

export function telemetryPosition(ctx: { db: ScopedDb }, source: string): TelemetryPosition {
 const row = ctx.db.all('SELECT row_id, span_id FROM logs_host_checkpoint WHERE source = ?', source)[0] as {row_id:number;span_id:number}|undefined;
 return { rowId: row?.row_id ?? 0, spanId: row?.span_id ?? 0 };
}
