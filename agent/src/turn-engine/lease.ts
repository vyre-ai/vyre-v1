// Thread leases (ARCH 6.2). One row per thread, taken by compare-and-set.
// Heartbeat every 5 s. The row expires 20 s after the last acquire or heartbeat.
// A different holder acquires only when the row is missing or expiresAt is in the past.
// The worker releases on every exit, including a failed turn, so a thread cannot stay "sending".

export const LEASE_TTL_MS = 20_000;
export const LEASE_HEARTBEAT_MS = 5_000;

export type LeaseKind = "turn" | "wait";

export interface LeaseRow {
  threadId: string;
  holder: string;
  kind: LeaseKind;
  expiresAt: number;
  turnId: string | null;
}

export interface LeaseAcquire {
  acquired: boolean;
  expiresAt: number;
}

export class LeaseTable {
  private readonly rows = new Map<string, LeaseRow>();
  private readonly now: () => number;
  heartbeatCount = 0;

  constructor(now: () => number) {
    this.now = now;
  }

  /** Live row, or undefined when the thread is free or the row has expired. */
  current(threadId: string): LeaseRow | undefined {
    const row = this.rows.get(threadId);
    if (!row || row.expiresAt <= this.now()) return undefined;
    return row;
  }

  acquire(threadId: string, holder: string, kind: LeaseKind): LeaseAcquire {
    const now = this.now();
    const row = this.rows.get(threadId);
    const live = row !== undefined && row.expiresAt > now ? row : undefined;
    if (live && live.holder !== holder) return { acquired: false, expiresAt: live.expiresAt };
    const expiresAt = now + LEASE_TTL_MS;
    const turnId = live && live.holder === holder ? live.turnId : null;
    this.rows.set(threadId, { threadId, holder, kind, expiresAt, turnId });
    return { acquired: true, expiresAt };
  }

  heartbeat(threadId: string, holder: string): { ok: boolean; expiresAt: number } {
    const now = this.now();
    const row = this.rows.get(threadId);
    if (!row || row.expiresAt <= now || row.holder !== holder) {
      return { ok: false, expiresAt: row?.expiresAt ?? now };
    }
    row.expiresAt = now + LEASE_TTL_MS;
    this.heartbeatCount += 1;
    return { ok: true, expiresAt: row.expiresAt };
  }

  /** The holder releases. An expired row is already free, so release still succeeds. */
  release(threadId: string, holder: string): { ok: boolean } {
    const row = this.rows.get(threadId);
    if (!row) return { ok: true };
    if (row.holder !== holder && row.expiresAt > this.now()) return { ok: false };
    this.rows.delete(threadId);
    return { ok: true };
  }

  attach(threadId: string, holder: string, turnId: string): void {
    const row = this.rows.get(threadId);
    if (!row || row.holder !== holder || row.expiresAt <= this.now()) return;
    row.turnId = turnId;
  }
}
