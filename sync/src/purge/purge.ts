// Client purge (ARCH 5.7): the server revoked this device, removed or suspended the person, or the person left the Space. Everything the replica holds goes: row tables and their field clocks,
// the FTS index, saved and open Yjs documents, the file cache, the outbox, conflicts and sync state. Keychain entries and the local Space folder go with them (leaving a Space and revocation take the same path).
// The outbox is kept as a "Rejected" archive only when the person is still active (they can copy their unsent words out); otherwise it is deleted too.
// Every step runs even if an earlier one failed, and a failure is reported at the end, because data left behind is worse than a loud error.
import { loadReplicaSql } from "../replica/ddl.ts";
import { quoteIdent } from "../replica/sql.ts";
import type { ReplicaStore, SqlDriver } from "../replica/types.ts";
import type { FolderPort, KeychainPort, OpenDocs, PurgeReason, PurgeStatus } from "./ports.ts";

/** Client-only tables (CLIENT_SQL) that hold anything about the Space. `rejected` is the archive and is spared for an active person. */
const CLIENT_TABLES = ["pending_ops", "conflicts_local", "doc_local", "fts", "blob_cache", "hide_seq", "replica_keep", "rejected"] as const;
const HASH_KEY = "registry_hash";

export interface PurgeOpts {
  driver: SqlDriver;
  /** The open store: closed at the end so its read cache cannot answer after the data is gone. */
  store?: ReplicaStore;
  reason: PurgeReason;
  /** The epoch that caused the purge (the server's, from the frame or the pull). */
  epoch: number;
  /** True when the person can still use Vyre: their unsent ops are kept as a Rejected archive. */
  personActive: boolean;
  now?: () => number;
  docs?: OpenDocs;
  keychain?: KeychainPort;
  folder?: FolderPort;
  status?: (s: PurgeStatus) => void;
}

export interface PurgeReport {
  reason: PurgeReason;
  epoch: number;
  personActive: boolean;
  /** Tables emptied. */
  tables: number;
  /** Unsent ops kept in Rejected. Null when the driver cannot count synchronously. */
  archived: number | null;
  docsClosed: boolean;
  keychain: boolean;
  folder: boolean;
  errors: string[];
}

export class PurgeError extends Error {
  readonly code = "purge_incomplete";
  readonly report: PurgeReport;
  constructor(report: PurgeReport) {
    super(`purge left work undone: ${report.errors.join("; ")}`);
    this.name = "PurgeError";
    this.report = report;
  }
}

/** Every table the replica owns: generated row tables and field clocks, plus the client tables. */
export function replicaTables(): string[] {
  return [...loadReplicaSql().tables.map((t) => t.name), ...CLIENT_TABLES];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function purgeReplica(o: PurgeOpts): Promise<PurgeReport> {
  const now = (o.now ?? Date.now)();
  const report: PurgeReport = {
    reason: o.reason, epoch: o.epoch, personActive: o.personActive, tables: 0, archived: null,
    docsClosed: false, keychain: false, folder: false, errors: [],
  };
  o.status?.({ state: "purging", reason: o.reason, epoch: o.epoch });
  const attempt = async (name: string, run: () => void | Promise<void>): Promise<boolean> => {
    try { await run(); return true; } catch (e) { report.errors.push(`${name}: ${message(e)}`); return false; }
  };

  await attempt("open documents", () => { o.docs?.closeAll(); report.docsClosed = o.docs !== undefined; });

  await attempt("replica", async () => {
    const d = o.driver;
    try { d.exec("PRAGMA secure_delete = ON"); } catch { /* an engine without the pragma still deletes */ }
    if (o.personActive && d.sync) report.archived = Number(d.prepare("SELECT count(*) AS n FROM pending_ops").get([])?.n ?? 0);
    const tables = replicaTables().filter((t) => !(o.personActive && t === "rejected"));
    d.transaction(() => {
      if (o.personActive) {
        d.prepare(
          `INSERT INTO rejected (op_id, error, copy_out, at)
           SELECT op_id, json_object('code', 'sync.purged', 'message', ?), json_object('cap', cap, 'entity', entity, 'id', id, 'hlc', hlc, 'input', CAST(input AS TEXT)), ?
           FROM pending_ops WHERE 1 = 1
           ON CONFLICT(op_id) DO UPDATE SET error = excluded.error, copy_out = excluded.copy_out, at = excluded.at`,
        ).run(["This device was signed out of the Space before the change was sent.", now]);
      }
      for (const t of tables) d.prepare(`DELETE FROM ${quoteIdent(t)}`).run([]);
      report.tables = tables.length;
      d.prepare("DELETE FROM sync_state WHERE k <> ?").run([HASH_KEY]);
      const put = d.prepare("INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
      put.run(["needs_snapshot", "1"]);
      put.run(["purged_epoch", String(o.epoch)]);
      put.run(["purged_reason", o.reason]);
      put.run(["purged_at", String(now)]);
    });
    await d.flush();
    // Free pages so deleted rows do not stay readable in the file (best effort: an engine that refuses still has the rows deleted).
    try { d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* not a WAL file */ }
    if (d.kind !== "wa") { try { d.exec("VACUUM"); } catch { /* inside an outer transaction or read-only */ } }
    await d.flush();
  });

  if (o.keychain) { const k = o.keychain; report.keychain = await attempt("keychain", () => k.removeAll()); }
  if (o.folder) { const f = o.folder; report.folder = await attempt("local folder", () => f.wipe()); }
  if (o.store) { const s = o.store; await attempt("close", () => s.close()); }

  if (report.errors.length) {
    o.status?.({ state: "failed", reason: o.reason, epoch: o.epoch, errors: report.errors });
    throw new PurgeError(report);
  }
  o.status?.({ state: "purged", reason: o.reason, epoch: o.epoch, personActive: o.personActive, archived: report.archived });
  return report;
}
