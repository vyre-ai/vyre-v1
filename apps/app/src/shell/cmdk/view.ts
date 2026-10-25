// Small view helpers for the Cmd-K sheet, kept out of the .tsx so the sheet's only lists are its Rows.
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { FILTERS } from "./model.ts";

export function filterLabels(selected: readonly string[]): string {
  const out: string[] = [];
  for (const id of selected) out.push(FILTERS.find((f) => f.id === id)?.label ?? id);
  return out.join(", ");
}

/** The type-filter menu: one checkmarked line per kind, with how many results it holds. */
export function filterEntries(counts: Readonly<Record<string, number>>, selected: readonly string[], toggle: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const f of FILTERS) {
    const n = counts[f.id];
    out.push({ label: n ? `${f.label}  ${n}` : f.label, checked: selected.includes(f.id), onSelect: () => toggle(f.id) });
  }
  return out;
}
