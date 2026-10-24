// The idempotency table in events.db (ARCH 4.2): key -> first result, kept 30 days. Synchronous; it runs inside the db worker next to the log.
import type { DatabaseSync } from "node:sqlite";

export const IDEM_TTL_MS = 30 * 24 * 3600 * 1000;

export interface IdemRecord { hash: string; result: unknown }

export class IdempotencyTable {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  /** The stored record, or null when absent or older than 30 days. */
  get(key: string, now: number): IdemRecord | null {
    const r = this.db.prepare("SELECT result, at FROM idempotency WHERE key = ?").get(key) as { result: Uint8Array; at: number } | undefined;
    if (!r || now - r.at > IDEM_TTL_MS) return null;
    return JSON.parse(new TextDecoder().decode(r.result)) as IdemRecord;
  }

  /** First writer wins: a second put for a live key is ignored, so two racing callers keep one result. Returns whether this call stored it. */
  put(key: string, principal: string, cap: string, rec: IdemRecord, now: number): boolean {
    this.db.prepare("DELETE FROM idempotency WHERE key = ? AND at < ?").run(key, now - IDEM_TTL_MS);
    const r = this.db.prepare("INSERT OR IGNORE INTO idempotency (key, principal, cap, result, at) VALUES (?, ?, ?, ?, ?)")
      .run(key, principal, cap, new TextEncoder().encode(JSON.stringify(rec)), now);
    return Number(r.changes) === 1;
  }

  /** Drop everything older than 30 days; returns how many rows went. */
  purge(now: number): number {
    return Number(this.db.prepare("DELETE FROM idempotency WHERE at < ?").run(now - IDEM_TTL_MS).changes);
  }
}
