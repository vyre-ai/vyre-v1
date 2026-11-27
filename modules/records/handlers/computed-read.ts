// The question "may this caller read this computed value?" asked of the host's decision and the side table: one helper for the places that choose or place records by a computed value on the server (a saved view, an
// export), next to the rule itself (lib/computed-fields.ts mayReadComputed), which the host's read path (record-access.ts) applies with its own memoised questions.
import { mayReadComputed } from "../../../lib/computed-fields.ts";
import type { ComputedSide } from "../../../lib/computed-fields.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";

type Authorize = (
  action: { perm: string | null; level: "view"; fields?: readonly string[] },
  resource: { type: string; id: string | null },
) => { effect: string };

/** The computed values of one record, as the side table holds them (none when the table is not there). */
export const sideRows =
  (tx: Tx) =>
  (type: string, id: string): readonly ComputedSide[] => {
    try {
      return tx.all<ComputedSide>(
        "SELECT field, value, inputs, kind, computed_at, link_ids FROM records_computed WHERE type = ? AND id = ?",
        type,
        id,
      );
    } catch {
      return [];
    }
  };

/** May the caller read the computed field `field` of this record? A record with no value for it says no. */
export function mayReadComputedField(tx: Tx, authorize: Authorize, type: string, id: string, field: string): boolean {
  const sideOf = sideRows(tx);
  const c = sideOf(type, id).find((x) => x.field === field);
  if (!c) return false;
  return mayReadComputed(
    {
      visibleOn: (t, i, fields) =>
        authorize({ perm: null, level: "view", fields: [...fields] }, { type: "record", id: i }).effect === "allow",
      sideOf,
    },
    type,
    id,
    c,
  );
}
