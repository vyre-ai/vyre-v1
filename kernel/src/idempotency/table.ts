// The idempotency table in events.db (ARCH 4.2): key -> first result, kept 30 days. Synchronous; it runs inside the db worker next to the log.
import type { DatabaseSync } from "node:sqlite";

export const IDEM_TTL_MS = 30 * 24 * 3600 * 1000;

export interface IdemRecord {
  hash: string;
  result: unknown;
}

export class IdempotencyTable {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** The stored record, or null when absent or older than 30 days. */
  get(key: string, now: number): IdemRecord | null {
    const r = this.db.prepare("SELECT result, at FROM idempotency WHERE key = ?").get(key) as
      | { result: Uint8Array; at: number }
      | undefined;
    if (!r || now - r.at > IDEM_TTL_MS) return null;
    return JSON.parse(new TextDecoder().decode(r.result)) as IdemRecord;
  }

  /** First writer wins: a second put for a live key is ignored, so two racing callers keep one result. Returns whether this call stored it. */
  put(key: string, principal: string, cap: string, rec: IdemRecord, now: number): boolean {
    this.db.prepare("DELETE FROM idempotency WHERE key = ? AND at < ?").run(key, now - IDEM_TTL_MS);
    const r = this.db
      .prepare("INSERT OR IGNORE INTO idempotency (key, principal, cap, result, at) VALUES (?, ?, ?, ?, ?)")
      .run(key, principal, cap, new TextEncoder().encode(JSON.stringify(rec)), now);
    return Number(r.changes) === 1;
  }

  /** Replace a stored hold with the finished result of the same input. A finished result is left as it is. */
  settle(key: string, principal: string, cap: string, rec: IdemRecord, now: number): boolean {
    const cur = this.get(key, now);
    const held =
      cur?.result !== null &&
      typeof cur?.result === "object" &&
      (cur.result as { status?: unknown; taskId?: unknown }).status === "held" &&
      typeof (cur.result as { taskId?: unknown }).taskId === "string";
    if (!cur || !held || cur.hash !== rec.hash) return false;
    const r = this.db
      .prepare("UPDATE idempotency SET principal = ?, cap = ?, result = ?, at = ? WHERE key = ?")
      .run(principal, cap, new TextEncoder().encode(JSON.stringify(rec)), now, key);
    return Number(r.changes) === 1;
  }

  /** Delete the kept answers that carry any of these ids at once (erasing an agent: the calls addressed to it, its chats and its routines), and scrub the freed pages. Returns how many rows went. */
  forgetText(needles: readonly string[]): number {
    const list = needles.filter((n) => n.length > 0);
    if (list.length === 0) return 0;
    this.db.exec("PRAGMA secure_delete = ON");
    let n = 0;
    for (const needle of list)
      n += Number(
        this.db
          .prepare("DELETE FROM idempotency WHERE instr(CAST(result AS TEXT), ?) > 0 OR instr(key, ?) > 0")
          .run(needle, needle).changes,
      );
    if (n > 0) {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.db.exec("VACUUM");
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    return n;
  }

  /** Drop everything older than 30 days; returns how many rows went. */
  purge(now: number): number {
    return Number(this.db.prepare("DELETE FROM idempotency WHERE at < ?").run(now - IDEM_TTL_MS).changes);
  }
}
