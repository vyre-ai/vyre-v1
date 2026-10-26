// records.purge and records.purge_trashed (governance; P-CC_39): hard-delete a record, which records.delete (Trash) does not.
// What goes: the row in its rt_<type> projection table and its field clocks, the change-feed rows (rs_changes keeps before and after values), and this module's own rows for it (field history with every old value,
// holds, version notes, row meta). Relations to it in other records are left to the records that hold them.
// DECISION (a gap, said on the packet): the record's events stay in the append-only kernel log. Erasing their payloads (LogStore.erase) is right, but the projections that read them cannot yet replay an erased
// payload, so erasing them now would break the next rebuild. Until the kernel reducers skip erased events and the log erase is exposed to modules, a restore or rebuild brings the row back and
// governance's tombstone replay purges it again. Nothing here pretends otherwise.
// DECISION: purge_trashed removes only records in Trash since before the cutoff, oldest first, a batch per call, and skips any record with a hold (records_holds), counting it.
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { Store } from "../../../kernel/src/store/types.ts";
import { fieldMetaTable } from "../projections.ts";
import type { WriteCtx } from "./write.ts";

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const DEFAULT_LIMIT = 500;

export interface PurgeHandlers {
  "records.purge"(ctx: WriteCtx, input: { type: string; recordId: string; idempotencyKey: string }): Promise<{ erased: boolean }>;
  "records.purge_trashed"(ctx: WriteCtx, input: { before: number; limit?: number; idempotencyKey: string }): Promise<{ removed: number; more: boolean; skippedOnHold?: number }>;
}

function hasTable(tx: Tx, name: string): boolean {
  return tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", name)?.n === 1;
}

/** Delete everything of one record this module and its projections keep. Returns false when no such row existed. */
function purgeRow(tx: Tx, type: string, id: string): boolean {
  const table = `rt_${type}`;
  if (!NAME.test(type) || !hasTable(tx, table)) return false;
  if (!tx.get<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, id)) return false;
  tx.run(`DELETE FROM ${table} WHERE id = ?`, id);
  const fm = fieldMetaTable(type);
  if (hasTable(tx, fm)) tx.run(`DELETE FROM ${fm} WHERE id = ?`, id);
  tx.run("DELETE FROM rs_changes WHERE type = ? AND id = ?", type, id);
  for (const t of ["records_field_history", "records_row_meta", "records_holds", "records_version_notes"]) if (hasTable(tx, t)) tx.run(`DELETE FROM ${t} WHERE type = ? AND id = ?`, type, id);
  return true;
}

export function createPurgeHandlers(deps: { store: Store; tx: Tx }): PurgeHandlers {
  const { tx } = deps;
  return {
    async "records.purge"(ctx, input) {
      if (!purgeRow(tx, input.type, input.recordId)) return { erased: false };
      ctx.emit("record.purged", `record/${input.recordId}`, { type: input.type, recordId: input.recordId });
      return { erased: true };
    },
    async "records.purge_trashed"(ctx, input) {
      const limit = input.limit ?? DEFAULT_LIMIT;
      const due: { type: string; id: string; at: number }[] = [];
      for (const def of await deps.store.types()) {
        if (!NAME.test(def.name) || !hasTable(tx, `rt_${def.name}`)) continue;
        for (const r of tx.all<{ id: string; deleted_at: number }>(`SELECT id, deleted_at FROM rt_${def.name} WHERE deleted_at IS NOT NULL AND deleted_at < ?`, input.before)) due.push({ type: def.name, id: r.id, at: r.deleted_at });
      }
      due.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
      let removed = 0, skipped = 0, scanned = 0;
      for (const r of due) {
        if (removed >= limit) break;
        scanned++;
        const held = hasTable(tx, "records_holds") && tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM records_holds WHERE type = ? AND id = ?", r.type, r.id)?.n;
        if (held) { skipped++; continue; }
        if (purgeRow(tx, r.type, r.id)) removed++;
      }
      const more = due.slice(scanned).length > 0;
      ctx.emit("records.trash_purged", `record/${removed}`, { removed });
      return { removed, more, ...(skipped ? { skippedOnHold: skipped } : {}) };
    },
  };
}
