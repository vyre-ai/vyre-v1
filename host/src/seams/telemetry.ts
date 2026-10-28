import type { TelemetryBatch, TelemetryPosition } from '../../../lib/telemetry.ts';
import type { RawDb } from '../ctx/db.ts';
import { scopedDb } from '../ctx/db.ts';

/** No invoke recursion or read bypass: only the loaded logs module's internal writer. */
export function createTelemetryRecorder(options: { space: string; db: RawDb & { tx<T>(run: () => T): T }; module: Record<string, unknown> | undefined; now(): number; secrets(): readonly string[] }): { write(batch: TelemetryBatch): void; position(source: string): TelemetryPosition } | undefined {
 const append = options.module?.['appendTelemetry'] as ((ctx: { space: string; db: RawDb; now(): number; secrets(): readonly string[] }, batch: TelemetryBatch) => void) | undefined;
 const position = options.module?.['telemetryPosition'] as ((ctx: { db: RawDb }, source: string) => TelemetryPosition) | undefined;
 if (!append || !position) return undefined;
 const db = scopedDb('logs', options.db, '0'.repeat(32));
 return { position: source => position({ db }, source), write: batch => options.db.tx(() => append({ space: options.space, db, now: options.now, secrets: options.secrets }, batch)) };
}
