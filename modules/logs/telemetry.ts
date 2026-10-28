import type { TelemetryBatch, TelemetryPosition } from '../../lib/telemetry.ts';
import type { ScopedDb } from '../../packages/contracts/src/ctx.ts';
import { LogWriter, readSettings } from './handlers/sink.ts';

// Host failures can carry arbitrary provider text. Only declared metadata crosses into canonical logs.
const ATTRS = new Set(['cap','status','traceId','spanId','parent','decisionId','reason','outcome','event','agent','owner','state','phase','restarts','seq','at','count','job','ms','attempts','latencyMs','bytes','version']);
function metadata(attrs: Record<string, unknown> | null | undefined): Record<string, unknown> {
 const out: Record<string, unknown> = {};
 for (const [key,value] of Object.entries(attrs ?? {})) {
  if (!ATTRS.has(key)) continue;
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') out[key] = value;
  else if (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value)) out[key] = value;
 }
 return out;
}

/** Host-generated batches enter the same validation/redaction path as all structured logs. */
export function appendTelemetry(ctx: { space: string; db: ScopedDb; now(): number; secrets(): readonly string[] }, batch: TelemetryBatch): void {
 if (batch.rows.length > 1000 || batch.spans.length > 1000) throw new Error('Telemetry batch exceeds its limit.');
 const previous = telemetryPosition(ctx, batch.source);
 if (previous.rowId >= batch.position.rowId && previous.spanId >= batch.position.spanId) return;
 if (previous.rowId > batch.position.rowId || previous.spanId > batch.position.spanId) throw new Error('Telemetry source moved behind its committed checkpoint.');
 const writer = new LogWriter({ db: ctx.db, space: ctx.space, now: ctx.now, secrets: ctx.secrets, batchMs: 1, minLevel: readSettings(ctx.db, ctx.space).level });
 for (const row of batch.rows) if (row.space === ctx.space) writer.write({ ...row, attrs: metadata(row.attrs) });
 for (const span of batch.spans) writer.span({ ...span, attrs: metadata(span.attrs) });
 writer.flush();
 ctx.db.run("INSERT INTO logs_host_checkpoint (source, row_id, span_id) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET row_id = excluded.row_id, span_id = excluded.span_id", batch.source, batch.position.rowId, batch.position.spanId);
}

export function telemetryPosition(ctx: { db: ScopedDb }, source: string): TelemetryPosition {
 const row = ctx.db.all('SELECT row_id, span_id FROM logs_host_checkpoint WHERE source = ?', source)[0] as {row_id:number;span_id:number}|undefined;
 return { rowId: row?.row_id ?? 0, spanId: row?.span_id ?? 0 };
}
