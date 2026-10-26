// The Filter menu's rows (prototype Records): each choice field with its options, then each person field with the people in the loaded rows. A count sits in the Menu's count column, never in the
// label; a status or choice has a dot in its colour and a person has their face, both as svg strings ui/Menu draws. Pure: the caller says how to count and what to do with a choice.
import { marbleInner } from "../../../../../../ui/src/Avatar/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { chosen, clearClauses, hasOptions, hueOf, optionValue, optionsOf, toggleOption } from "./model.ts";
import type { FieldDef, RecordRow, TableViewState, TypeDef } from "./model.ts";

export const dotIcon = (hue: number): string => `<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="4" fill="hsl(${hue}, 65%, 52%)"/></svg>`;
export const faceIcon = (name: string): string => `<svg viewBox="0 0 80 80" width="15" height="15">${marbleInner(name)}</svg>`;

export function filterMenuEntries(o: {
  def: TypeDef;
  cur: TableViewState;
  /** The rows in hand: the people they name are the owners the menu lists. */
  rows: readonly RecordRow[];
  nameOf: (id: string) => string;
  countOf: (field: FieldDef, key: string) => number | null;
  set: (next: TableViewState) => void;
}): MenuEntry[] {
  const { def, cur, rows, nameOf, countOf, set } = o;
  const out: MenuEntry[] = [];
  for (const f of def.fields.filter(hasOptions)) {
    if (out.length) out.push({ separator: true });
    out.push({ head: f.title });
    for (const opt of optionsOf(f)) {
      const n = countOf(f, opt.key);
      const hue = opt.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(opt.key);
      out.push({ label: opt.title, icon: dotIcon(hue), ...(n === null ? {} : { count: n }), checked: chosen(cur, f.key).includes(optionValue(f, opt.key)), onSelect: () => set(toggleOption(cur, f.key, optionValue(f, opt.key))) });
    }
  }
  for (const f of def.fields.filter((x) => x.type === "person")) {
    const ids = [...new Set(rows.map((r) => r.fields[f.key]).filter((x): x is string => typeof x === "string" && x !== ""))];
    if (ids.length === 0) continue;
    if (out.length) out.push({ separator: true });
    out.push({ head: f.title });
    for (const id of ids.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
      const n = countOf(f, id);
      out.push({ label: nameOf(id), icon: faceIcon(nameOf(id)), ...(n === null ? {} : { count: n }), checked: chosen(cur, f.key).includes(id), onSelect: () => set(toggleOption(cur, f.key, id)) });
    }
  }
  if (out.length === 0) out.push({ head: "Filter" }, { label: "No fields to filter by" });
  if (cur.clauses.length > 0) out.push({ separator: true }, { label: "Clear filters", onSelect: () => set(clearClauses(cur)) });
  return out;
}
