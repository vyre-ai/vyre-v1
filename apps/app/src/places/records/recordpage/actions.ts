// The writes of the record page. A field edited in place is one records.update of that field with the version the person was looking at; undo is one more update that puts the old value back.
// Folds and the fields a person keeps visible are their own page prefs, never the type's layout.
import type { RecordPageData } from "./data.tsx";
import { parseInput, patchFor } from "./model.ts";
import type { FieldDef, RecordRow, Undo } from "./model.ts";

export type SaveResult = { kind: "same" } | { kind: "bad"; message: string } | { kind: "saved"; record: RecordRow; undo: Undo };

/** Saves typed text into a field. Nothing changed writes nothing; a bad value writes nothing and says why; a good one is exactly one records.update. */
export async function saveField(data: RecordPageData, type: string, row: RecordRow, f: FieldDef, text: string): Promise<SaveResult> {
  const parsed = parseInput(f, text, row.fields[f.key]);
  if (!parsed.ok) return { kind: "bad", message: parsed.message };
  return saveValue(data, type, row, f, parsed.value);
}

/** Saves a value that is already typed (a choice, a checkbox, a rating, a relation). */
export async function saveValue(data: RecordPageData, type: string, row: RecordRow, f: FieldDef, value: unknown): Promise<SaveResult> {
  const change = patchFor(f, value, row);
  if (!change) return { kind: "same" };
  const out = (await data.call("records.update", { type, recordId: row.id, patch: change.patch, baseVersion: row.version })) as { record: RecordRow };
  return { kind: "saved", record: out.record, undo: change.undo };
}

/** Puts the value back that Undo remembers. */
export async function undoSave(data: RecordPageData, type: string, row: RecordRow, undo: Undo): Promise<void> {
  await data.call("records.update", { type, recordId: row.id, patch: { [undo.field]: undo.was }, baseVersion: row.version });
}

/** Folds or keeps fields for this person. */
export async function savePrefs(data: RecordPageData, type: string, prefs: { folded?: readonly string[]; keepVisible?: readonly string[] }): Promise<void> {
  await data.call("records.page_prefs.set", { type, ...(prefs.folded ? { folded: [...prefs.folded] } : {}), ...(prefs.keepVisible ? { keepVisible: [...prefs.keepVisible] } : {}) });
}

export async function sourceOf(data: RecordPageData, type: string, recordId: string, field: string): Promise<unknown> {
  return ((await data.call("records.value_source", { type, recordId, field })) as { source: unknown }).source;
}

export function errorText(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `${what}: ${msg}` : `${what}.`;
}
