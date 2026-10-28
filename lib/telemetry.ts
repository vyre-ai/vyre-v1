// Internal metadata batches only. No capability accepts this shape from a caller.
export interface TelemetryLog {
 at: number; space: string; level: number; msg: string; attrs?: Record<string, unknown> | undefined;
 trace_id?: string | undefined; span_id?: string | undefined; actor?: string | undefined;
 on_behalf?: string | undefined; cap?: string | undefined;
}
export interface TelemetrySpan {
 trace_id: string; span_id: string; parent: string | null; name: string; at: number;
 dur_us: number; attrs: Record<string, unknown> | null;
}
export interface TelemetryBatch { source: string; position: TelemetryPosition; rows: readonly TelemetryLog[]; spans: readonly TelemetrySpan[] }
export interface TelemetryPosition { rowId: number; spanId: number }
