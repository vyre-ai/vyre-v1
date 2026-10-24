// thread_lease (ARCH 6.1, 6.2): compare-and-set per thread. The holder heartbeats every 5 s; a lease expires 20 s after its last beat.
// Holder strings: 'host:<space>' | 'device:<id>'. A different holder gets a thread only once the lease expired or was released.
export const LEASE_TTL_MS = 20_000;
export const HEARTBEAT_MS = 5_000;

export interface LeaseRow { threadId: string; holder: string; expiresAt: number; turnId: string | null }

export interface LeaseStore {
  /** Take the lease if it is free, expired, or already ours. Returns the row, or null when someone else holds it. */
  acquire(threadId: string, holder: string, now: number, turnId?: string | null): LeaseRow | null;
  /** Extend our lease. False when it expired and someone took it, or was released: the holder must stop. */
  renew(threadId: string, holder: string, now: number): boolean;
  setTurn(threadId: string, holder: string, turnId: string | null): void;
  release(threadId: string, holder: string): boolean;
  get(threadId: string, now: number): LeaseRow | null;
}

export function createMemoryLeases(ttlMs: number = LEASE_TTL_MS): LeaseStore {
  const rows = new Map<string, LeaseRow>();
  const live = (r: LeaseRow | undefined, now: number): r is LeaseRow => r !== undefined && r.expiresAt > now;
  return {
    acquire(threadId, holder, now, turnId = null) {
      const cur = rows.get(threadId);
      if (live(cur, now) && cur.holder !== holder) return null;
      const next: LeaseRow = { threadId, holder, expiresAt: now + ttlMs, turnId: turnId ?? (live(cur, now) ? cur.turnId : null) };
      rows.set(threadId, next);
      return { ...next };
    },
    renew(threadId, holder, now) {
      const cur = rows.get(threadId);
      if (!live(cur, now) || cur.holder !== holder) return false;
      cur.expiresAt = now + ttlMs;
      return true;
    },
    setTurn(threadId, holder, turnId) {
      const cur = rows.get(threadId);
      if (cur && cur.holder === holder) cur.turnId = turnId;
    },
    release(threadId, holder) {
      const cur = rows.get(threadId);
      if (!cur || cur.holder !== holder) return false;
      rows.delete(threadId);
      return true;
    },
    get(threadId, now) {
      const cur = rows.get(threadId);
      return live(cur, now) ? { ...cur } : null;
    },
  };
}
