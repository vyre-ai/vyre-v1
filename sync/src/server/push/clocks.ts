// Field clocks from the sync lane's own row index (`sync_rows`, kept by the sync.changes projection): the value, hlc, actor and seq of every field of a row.
// This is the `field_meta` of ARCH 5.4 for every entity at once, so push needs nothing from another module's tables.
import type { Tx } from "../../../../kernel/src/store/projection.ts";
import type { FieldState } from "./merge.ts";

export function syncRowClocks(db: Tx): (entity: string, id: string) => Record<string, FieldState> {
  return (entity, id) => {
    const row = db.get<{ fields: string }>("SELECT fields FROM sync_rows WHERE entity = ? AND id = ?", entity, id);
    if (!row) return {};
    const cells = JSON.parse(row.fields) as Record<string, { v: unknown; hlc: string; actor: string; seq: number }>;
    const out: Record<string, FieldState> = {};
    for (const [k, c] of Object.entries(cells)) out[k] = { v: c.v, hlc: c.hlc, actor: c.actor, seq: c.seq };
    return out;
  };
}
