// Stages on any record type, the pure part. A type has stages when its status field says so (`options.stagesOn`). Each stage is { key, title } and may carry `fields` (the fields shown at that stage
// instead of always), `needToEnter` and `needToLeave` (fields that must be filled to move there and to move on). Everything lives on the status field's options, so one field.update saves it, and
// the schema module hands the gates to the records module, which refuses a stage change for every caller.
import { freeKey, slugOf } from "./model.ts";
import type { FieldDef, SchemaOp } from "./model.ts";

export interface StageEntry { key: string; title: string; fields?: string[]; needToEnter?: string[]; needToLeave?: string[] }
export type StageList = "fields" | "needToEnter" | "needToLeave";

const asList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

/** The status field that holds a type's stages, if it has one. */
export function stageFieldOf(type: { statusField?: string | undefined; fields: readonly FieldDef[] }): FieldDef | undefined {
  const f = type.fields.find((x) => x.key === (type.statusField ?? "stage"));
  return f && f.type === "status" ? f : undefined;
}

export function stagesOf(f: FieldDef | undefined): StageEntry[] {
  const raw = (f?.options as { stages?: unknown } | undefined)?.stages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): StageEntry[] => {
    const o = x as { key?: unknown; title?: unknown } & Record<string, unknown>;
    if (!o || typeof o.key !== "string") return [];
    const e: StageEntry = { key: o.key, title: typeof o.title === "string" ? o.title : o.key };
    for (const l of ["fields", "needToEnter", "needToLeave"] as const) { const v = asList(o[l]); if (v && v.length) e[l] = v; }
    return [e];
  });
}

/** Stages are on for the type. */
export const stagesOn = (type: { statusField?: string | undefined; fields: readonly FieldDef[] }): boolean => (stageFieldOf(type)?.options as { stagesOn?: unknown } | undefined)?.stagesOn === true;

const DEFAULT_STAGES: StageEntry[] = [{ key: "todo", title: "To do" }, { key: "doing", title: "Doing" }, { key: "done", title: "Done" }];

const optionsWith = (f: FieldDef | undefined, patch: Record<string, unknown>): Record<string, unknown> => ({ ...((f?.options as Record<string, unknown> | undefined) ?? {}), ...patch });

/** Turn stages on: the type's status field becomes its stages (a new "Stage" field when it has none). */
export function stagesOnOps(type: { key: string; statusField?: string | undefined; fields: readonly FieldDef[] }): SchemaOp[] {
  const f = stageFieldOf(type);
  if (f) return [{ op: "field.update", type: type.key, field: f.key, def: { options: optionsWith(f, { stagesOn: true, stages: stagesOf(f).length ? (f.options as { stages: unknown }).stages : DEFAULT_STAGES }) } }];
  const key = freeKey("stage", type.fields.map((x) => x.key));
  return [
    { op: "field.add", type: type.key, field: key, def: { title: "Stage", type: "status", options: { stagesOn: true, stages: DEFAULT_STAGES } } },
    { op: "type.update", type: type.key, def: { statusField: key } },
  ];
}

/** Turn stages off. The field and its values stay; the page and the gates stop treating it as stages. */
export function stagesOffOps(type: { key: string; statusField?: string | undefined; fields: readonly FieldDef[] }): SchemaOp[] {
  const f = stageFieldOf(type);
  if (!f) return [];
  const { stagesOn: _off, ...rest } = optionsWith(f, {});
  const stages = stagesOf(f).map(({ key, title }) => ({ key, title }));
  return [{ op: "field.update", type: type.key, field: f.key, def: { options: { ...rest, stages } } }];
}

/** Save a new stage list on the status field. */
export const setStagesOps = (type: string, f: FieldDef, stages: readonly StageEntry[]): SchemaOp[] => [{ op: "field.update", type, field: f.key, def: { options: optionsWith(f, { stages: [...stages] }) } }];

export function addStage(stages: readonly StageEntry[], title: string): StageEntry[] {
  const t = title.trim();
  const key = freeKey(slugOf(t, "s") || "stage", stages.map((s) => s.key));
  return t ? [...stages, { key, title: t }] : [...stages];
}
export const renameStage = (stages: readonly StageEntry[], key: string, title: string): StageEntry[] => stages.map((s) => (s.key === key && title.trim() ? { ...s, title: title.trim() } : s));
/** A stage can go while it is not the last one; the fields and gates that named it go with it. */
export const removeStage = (stages: readonly StageEntry[], key: string): StageEntry[] => (stages.length > 1 ? stages.filter((s) => s.key !== key) : [...stages]);
export function moveStage(stages: readonly StageEntry[], key: string, dir: -1 | 1): StageEntry[] {
  const i = stages.findIndex((s) => s.key === key), j = i + dir;
  if (i < 0 || j < 0 || j >= stages.length) return [...stages];
  const out = [...stages];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function withList(s: StageEntry, list: StageList, keys: readonly string[]): StageEntry {
  const { [list]: _drop, ...rest } = s;
  return keys.length ? { ...rest, [list]: [...keys] } : rest;
}
/** A gate field in or out of one stage's list. */
export function toggleGate(stages: readonly StageEntry[], stageKey: string, list: "needToEnter" | "needToLeave", field: string): StageEntry[] {
  return stages.map((s) => {
    if (s.key !== stageKey) return s;
    const have = s[list] ?? [];
    return withList(s, list, have.includes(field) ? have.filter((k) => k !== field) : [...have, field]);
  });
}
/** Where a field shows: at one stage (its stage group), or always (null). A field shows at one stage at most. */
export function showAt(stages: readonly StageEntry[], field: string, stageKey: string | null): StageEntry[] {
  return stages.map((s) => {
    const rest = (s.fields ?? []).filter((k) => k !== field);
    return withList(s, "fields", s.key === stageKey ? [...rest, field] : rest);
  });
}
export const stageOfField = (stages: readonly StageEntry[], field: string): StageEntry | undefined => stages.find((s) => (s.fields ?? []).includes(field));
