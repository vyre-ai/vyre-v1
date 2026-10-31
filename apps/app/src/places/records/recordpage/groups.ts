// Record page: field groups as tabs, and a Journey record's stage groups. Pure, no React.
// A type's groups are the sections of its record page layout (schema.layout.set). With three or more groups the page shows them as tabs under the title, the ungrouped fields first as "Overview".
// A Journey stage's fields (the stage's `fields` in its design) form a group named after the stage: the stage the record is in leads and is lit, earlier stages show, later ones are locked.
import type { FieldDef, Section, TypeDef } from "./model.ts";

export const TAB_AT = 3;

export interface GroupTab { key: string; title: string }

/**
 * The tabs of a page, or null. Groups made in the Fields panel keep the ungrouped fields in a section called "overview"; a type with that section and three or more other groups shows them as
 * tabs, Overview first. A layout an admin wrote by hand (no "overview") keeps its sections as they are.
 */
export function tabsOf(sections: readonly Section[]): GroupTab[] | null {
  const plain = sections.filter((s) => s.stage === undefined);
  const bucket = plain.find((s) => s.key === "overview");
  if (!bucket || plain.filter((s) => s !== bucket).length < TAB_AT) return null;
  return [{ key: bucket.key, title: "Overview" }, ...plain.filter((s) => s !== bucket).map((s) => ({ key: s.key, title: s.title }))];
}

/** The sections to draw for the tab chosen: all the stage groups, and of the others only the tab's (every one when there are no tabs). */
export function visibleSections(sections: readonly Section[], tabs: readonly GroupTab[] | null, active: string): Section[] {
  if (!tabs) return [...sections];
  const on = tabs.some((t) => t.key === active) ? active : tabs[0]!.key;
  return sections.filter((s) => s.stage !== undefined || s.key === on);
}

/** The stage fields a page needs of a Journey stage. */
export interface StageGroup { key: string; title: string; order: number; fields?: readonly string[] }

/**
 * The page's sections with the stage groups in front: the current stage, then the earlier ones, then the later ones (locked, folded, "Opens at <stage>"). A field a stage holds leaves the
 * ordinary sections. A stage with no fields makes no group.
 */
export function withStages(def: Pick<TypeDef, "fields" | "titleField" | "summaryField">, sections: readonly Section[], stages: readonly StageGroup[], current: string, folded: readonly string[]): Section[] {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((s) => s.key === current);
  const by = new Map(def.fields.map((f) => [f.key, f]));
  const skip = new Set([def.titleField, ...(def.summaryField ? [def.summaryField] : [])]);
  const owned = new Set<string>();
  const made: Section[] = [];
  ordered.forEach((st, i) => {
    const fields = (st.fields ?? []).map((k) => by.get(k)).filter((f): f is FieldDef => f !== undefined && !skip.has(f.key) && !owned.has(f.key));
    if (fields.length === 0) return;
    for (const f of fields) owned.add(f.key);
    const state = at < 0 ? "past" : i === at ? "current" : i < at ? "past" : "locked";
    const key = `stage-${st.key}`;
    made.push({ key, title: st.title, fields, folded: state === "locked" ? true : folded.includes(key), stage: { state, opensAt: st.title } });
  });
  const rank = { current: 0, past: 1, locked: 2 } as const;
  made.sort((a, b) => rank[a.stage!.state] - rank[b.stage!.state]);
  const rest = sections.map((s) => ({ ...s, fields: s.fields.filter((f) => !owned.has(f.key)) })).filter((s) => s.fields.length > 0);
  return [...made, ...rest];
}
