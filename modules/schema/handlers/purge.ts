// When the restore window of a dropped field (or type) ends, its values are taken out of every copy for good. A drop keeps the values in Trash for 30 days (sc_trash.payload) so the field can be restored; nothing
// removed them after that, and the Space log, the record store's own log, the change feed and the field history kept them as well. This job takes one expired Trash entry at a time (a slice of its own: the cleaning
// reads the log), runs the same cleaning a seal runs (cleanField: the old events lose their payloads and the rows are written again, the change feed and field history lose the field, the host scrubs the Space log,
// kept answers and the search index), and removes the entry. A field that is back in the type (restored, or added again under the same key) is not cleaned: its values are live; only the old Trash entry goes.
import { nowOf, allDefs } from "../projections.ts";
import type { SchemaDeps } from "../projections.ts";
import { cleanField } from "./seal.ts";

interface TrashRow {
  id: number;
  type: string;
  field: string | null;
  payload: string;
}

/** Purge one expired Trash entry. Answers how many were purged (0 or 1); call again until 0. */
export async function purgeExpiredTrash(deps: SchemaDeps): Promise<number> {
  const { tx } = deps;
  const now = nowOf(deps);
  const row = tx.get<TrashRow>(
    "SELECT id, type, field, payload FROM sc_trash WHERE restored_at IS NULL AND expires_at <= ? ORDER BY id LIMIT 1",
    now,
  );
  if (!row) return 0;
  const defs = await allDefs(deps);
  const current = defs.get(row.type);
  const fields: string[] = [];
  if (row.field !== null) {
    // the field is in the type again, or another Trash entry of it is still inside its window: its values are not the ones to remove
    const back = current?.fields.some((f) => f.key === row.field) ?? false;
    const other =
      (tx.get<{ n: number }>(
        "SELECT count(*) AS n FROM sc_trash WHERE type = ? AND field = ? AND id <> ? AND restored_at IS NULL AND expires_at > ?",
        row.type,
        row.field,
        row.id,
        now,
      )?.n ?? 0) > 0;
    if (!back && !other) fields.push(row.field);
  } else if (!current) {
    // a dropped type: every field it had
    try {
      const p = JSON.parse(row.payload) as { def?: { fields?: Array<{ key?: unknown }> } };
      for (const f of p.def?.fields ?? []) if (typeof f.key === "string") fields.push(f.key);
    } catch {
      /* a payload that does not parse names no field */
    }
  }
  for (const f of fields) await cleanField(deps, row.type, f);
  // cleanField removes the Trash entries of a field; a type's entry, and one kept for a field that is live again, go here
  tx.run("DELETE FROM sc_trash WHERE id = ?", row.id);
  return 1;
}

/** Every expired entry, one after the other. */
export async function purgeAllExpired(deps: SchemaDeps): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    if ((await purgeExpiredTrash(deps)) === 0) break;
    n++;
  }
  return n;
}
