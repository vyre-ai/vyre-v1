import type { TelemetryBatch, TelemetryPosition } from '../../../lib/telemetry.ts';
import type { RawDb } from '../ctx/db.ts';
import { scopedDb } from '../ctx/db.ts';

/** No invoke recursion or read bypass: only the loaded logs module's internal writer. */
export function createTelemetryRecorder(options: { space: string; db: RawDb & { tx<T>(run: () => T): T }; module: Record<string, unknown> | undefined; now(): number; secrets(): readonly string[]; capabilities: readonly string[] }): { write(batch: TelemetryBatch): void; position(source: string): TelemetryPosition; cap(rounds?: number): Promise<number> } | undefined {
 const append = options.module?.['appendTelemetry'] as ((ctx: { space: string; db: RawDb; now(): number; secrets(): readonly string[]; capabilities: readonly string[] }, batch: TelemetryBatch) => void) | undefined;
 const position = options.module?.['telemetryPosition'] as ((ctx: { db: RawDb }, source: string) => TelemetryPosition) | undefined;
 if (!append || !position) return undefined;
 const step = options.module?.['capTelemetry'] as ((ctx: { space: string; db: RawDb; now(): number }) => number) | undefined;
 const db = scopedDb('logs', options.db, '0'.repeat(32));
 return {
  position: source => position({ db }, source),
  write: batch => options.db.tx(() => append({ space: options.space, db, now: options.now, secrets: options.secrets, capabilities: options.capabilities }, batch)),
  /**
   * The mirror's running caps: small steps, each its own short transaction, with the daemon free to serve calls between them. modules.db is the Space's real data and is never fully
   * vacuumed here; when it was made with incremental vacuum, one bounded step gives freed pages back. Otherwise SQLite reuses them, and the file stops growing.
   */
  cap: async (rounds = CAP_ROUNDS) => {
   if (!step) return 0;
   let removed = 0;
   for (let round = 0; round < rounds; round++) {
    const n = options.db.tx(() => step({ space: options.space, db, now: options.now }));
    removed += n;
    if (!n) break;
    await new Promise<void>(resolve => setImmediate(resolve));
   }
   const pragma = (name: string): number => Number((options.db.all(`PRAGMA ${name}`)[0] as Record<string, unknown> | undefined)?.[name] ?? 0);
   if (pragma('auto_vacuum') === 2 && pragma('freelist_count') >= VACUUM_PAGES) options.db.all(`PRAGMA incremental_vacuum(${VACUUM_PAGES})`);
   return removed;
  },
 };
}

/** One cap run removes at most this many batches; a backlog drains over several runs. */
const CAP_ROUNDS = 20;
/** Pages one incremental vacuum step frees (4 MB at the default page size). */
const VACUUM_PAGES = 1024;
