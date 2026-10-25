// connectors.get and connectors.list carry the connector's per-object action names (P-CC_19, P-L3_REC3). A connector spec may name its own actions per object,
// `objects: { contact: { list, listAfter, create, update, delete } }`; a name left out keeps the convention list_<objects>, create_<object>, ... The sync engine reads this map from the
// connector row (host/src/daemon/syncengine.ts objectsOf) so an override on a real row changes which actions a sync calls.
// Path mapping: the row is built in handlers/runtime.ts (rowOf), which calls objectsOf from here; ConnectorDef and ConnectorRow gained the optional `objects` field.
import type { ConnectorDef } from "../projections.ts";

export const OBJECT_ACTION_KEYS = ["list", "listAfter", "create", "update", "delete"] as const;
export type ObjectActions = Partial<Record<(typeof OBJECT_ACTION_KEYS)[number], string>>;

/** The per-object action names of a definition, keeping only the five known keys with non-empty string values. Undefined when the connector names none. */
export function objectsOf(def: Pick<ConnectorDef, "objects">): Record<string, ObjectActions> | undefined {
  const raw = def.objects;
  if (raw === null || typeof raw !== "object") return undefined;
  const out: Record<string, ObjectActions> = {};
  for (const [object, names] of Object.entries(raw)) {
    if (names === null || typeof names !== "object") continue;
    const kept: ObjectActions = {};
    for (const k of OBJECT_ACTION_KEYS) {
      const v = (names as ObjectActions)[k];
      if (typeof v === "string" && v !== "") kept[k] = v;
    }
    if (Object.keys(kept).length > 0) out[object] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
