// Field groups of a record type, the pure part. A group is a section of the type's record page layout (schema.layout.set): the page draws each as a section, and as tabs under the title once
// there are three. The fields no group holds live in the "overview" section, which always comes first. Every function returns the whole layout to save; none touches the schema itself.
import type { CapMap } from "../../../../../../generated/types.ts";
import { freeKey, slugOf } from "./model.ts";

export type LayoutSection = CapMap["schema.layout.get"]["out"]["sections"][number];
export const OVERVIEW = "overview";
export const OVERVIEW_TITLE = "Overview";

/** The layout with an Overview first that holds every field no group has. A layout nobody grouped yet (one "details" section) becomes the Overview. */
export function normalize(sections: readonly LayoutSection[], fieldKeys: readonly string[]): LayoutSection[] {
  const known = new Set(fieldKeys);
  const bucket = sections.find((s) => s.key === OVERVIEW) ?? (sections.length === 1 && sections[0]!.key === "details" ? sections[0] : undefined);
  const groups: LayoutSection[] = [];
  const placed = new Set<string>();
  for (const s of sections) {
    if (s === bucket) continue;
    const fields = s.fields.filter((k) => known.has(k) && !placed.has(k));
    for (const k of fields) placed.add(k);
    groups.push({ ...s, fields });
  }
  const fromBucket = (bucket?.fields ?? []).filter((k) => known.has(k) && !placed.has(k));
  const seen = new Set(fromBucket);
  const rest = fieldKeys.filter((k) => !placed.has(k) && !seen.has(k));
  return [{ key: OVERVIEW, title: OVERVIEW_TITLE, fields: [...fromBucket, ...rest] }, ...groups];
}

/** The groups a person made: every section but the Overview. */
export const groupsIn = (sections: readonly LayoutSection[], fieldKeys: readonly string[]): LayoutSection[] => normalize(sections, fieldKeys).slice(1);

/** The group a field is in, or null when it is ungrouped. */
export function groupOf(sections: readonly LayoutSection[], fieldKeys: readonly string[], field: string): LayoutSection | null {
  return groupsIn(sections, fieldKeys).find((g) => g.fields.includes(field)) ?? null;
}

export function addGroup(sections: readonly LayoutSection[], fieldKeys: readonly string[], title: string): { key: string; sections: LayoutSection[] } {
  const base = normalize(sections, fieldKeys);
  const key = freeKey(slugOf(title.trim(), "g") || "group", [...base.map((s) => s.key), "details"]);
  return { key, sections: [...base, { key, title: title.trim(), fields: [] }] };
}

export function renameGroup(sections: readonly LayoutSection[], fieldKeys: readonly string[], key: string, title: string): LayoutSection[] {
  return normalize(sections, fieldKeys).map((s) => (s.key === key && key !== OVERVIEW ? { ...s, title: title.trim() } : s));
}

/** Deleting a group keeps its fields: they go back to the Overview. */
export function deleteGroup(sections: readonly LayoutSection[], fieldKeys: readonly string[], key: string): LayoutSection[] {
  const base = normalize(sections, fieldKeys);
  const gone = base.find((s) => s.key === key);
  if (!gone || key === OVERVIEW) return base;
  return base.filter((s) => s !== gone).map((s) => (s.key === OVERVIEW ? { ...s, fields: [...s.fields, ...gone.fields] } : s));
}

/** Puts a field in a group (a key) or back with the ungrouped ones (null). */
export function moveField(sections: readonly LayoutSection[], fieldKeys: readonly string[], field: string, to: string | null): LayoutSection[] {
  const base = normalize(sections, fieldKeys);
  const target = to === null ? OVERVIEW : to;
  if (!base.some((s) => s.key === target)) return base;
  return base.map((s) => {
    const without = s.fields.filter((k) => k !== field);
    return s.key === target ? { ...s, fields: [...without, field] } : { ...s, fields: without };
  });
}
