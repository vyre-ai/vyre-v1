// A KitScreenDef built from a generated screen index entry, for previews, the perf run and tests. It keeps the entry's id,
// place, slot, queries, actions, permissions and perf budget, and lays the first query out as a plain list. Product screens
// come from the manifests, not from here.
import type { ScreenIndexEntry } from "../../../../generated/screens.ts";
import { isKitSlot, isScreenPlace, type CapName, type KitAction, type KitQuery, type KitScreenDef } from "../types.ts";

export function previewDef(entry: ScreenIndexEntry): KitScreenDef {
  if (!isScreenPlace(entry.place)) throw new Error(`screen ${entry.id}: unknown place ${entry.place}`);
  if (!isKitSlot(entry.slot)) throw new Error(`screen ${entry.id}: unknown slot ${entry.slot}`);
  const queries: Record<string, KitQuery> = {};
  for (const [name, q] of Object.entries(entry.queries)) queries[name] = { cap: q.cap as CapName, input: q.input, live: q.live };
  const actions: Record<string, KitAction> = {};
  for (const [name, a] of Object.entries(entry.actions)) actions[name] = { cap: a.cap as CapName, input: a.input, ...(a.confirm ? { confirm: a.confirm } : {}) };
  const first = Object.keys(queries)[0];
  return {
    id: entry.id,
    place: entry.place,
    slot: entry.slot,
    queries,
    actions,
    states: {
      empty: { line: "Nothing here yet" },
      offline: { line: "You are offline. This loads when you are back online." },
      error: { line: "This did not load.", primary: "Try again" },
    },
    layout: first
      ? {
          t: "stack",
          children: [
            { t: "text", value: entry.id, style: "heading" },
            { t: "list", bind: `/queries/${first}`, empty: "Nothing here yet", row: { t: "row", children: [{ t: "text", value: "{/row/title}" }, { t: "text", value: "{/row/note}", style: "muted" }] } },
          ],
        }
      : { t: "text", value: entry.id, style: "heading" },
    needs: entry.needs,
    ...(entry.perf ? { perf: entry.perf } : {}),
  };
}
