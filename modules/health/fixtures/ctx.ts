// Tiny handler context for health tests. The database throws so the in-memory store is used.
import type { HealthCtx } from '../handlers/checks.ts';

export interface Emitted { name: string; subject: string; payload: unknown }

export function healthCtx(space: string, now = 1760000000000): HealthCtx & { events: Emitted[] } {
  const events: Emitted[] = [];
  return {
    space,
    trace: { traceId: '0123456789abcdef0123456789abcdef' },
    now: () => now,
    db: {
      all(): never { throw new Error('no db'); },
      run(): never { throw new Error('no db'); },
    },
    emit(name, subject, payload) {
      events.push({ name, subject, payload });
      return { name, subject, payload };
    },
    events,
  };
}
