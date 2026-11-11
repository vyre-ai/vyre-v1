// Bring in a spreadsheet: the pure part. Which fields a column can feed, how the suggested matches are changed by hand, what the preview says in words, and the limit on a file.
// The server does the reading, matching and writing (modules/import); nothing here reads a cell.

/** What one column of the file looks like, as import.parse_csv reports it. */
export interface Col { name: string; sample: readonly string[]; empty: number }
/** A field of the record type that a column can feed. */
export interface Target { key: string; title: string }

/** Field types the import can fill from text (modules/import/mapping.ts IMPORTABLE). */
export const FILLABLE = new Set(["text", "longtext", "number", "money", "datetime", "duration", "choice", "multichoice", "status", "checkbox", "rating", "person", "email", "phone", "url", "address"]);

/** A file up to this size goes in one request (the server takes 5 MB a request; the text goes inside JSON). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const TOO_BIG = "This file is too big to bring in at once. Save it in parts under 4 MB and bring each in.";
export const NOT_A_SHEET = "That is not a CSV file. Save the spreadsheet as CSV and choose it again.";

export function fillable(fields: ReadonlyArray<{ key: string; title?: string; type: string }>): Target[] {
  return fields.filter((f) => FILLABLE.has(f.type)).map((f) => ({ key: f.key, title: f.title ?? f.key }));
}

/** The file looks like a spreadsheet saved as text: a name ending .csv, .tsv or .txt, or a text type. */
export function looksLikeCsv(file: { name: string; mime?: string }): boolean {
  return /\.(csv|tsv|txt)$/i.test(file.name) || (file.mime ?? "").startsWith("text/");
}

/** Column to field key; "" is a column that stays out. */
export type Picks = Readonly<Record<string, string>>;

/** The server's suggestion as picks. A column with no suggested field stays out: the import never adds a field of its own here. */
export function picksFrom(columns: readonly Col[], suggested: ReadonlyArray<{ column: string; field?: string }>, targets: readonly Target[]): Picks {
  const ok = new Set(targets.map((t) => t.key));
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const c of columns) {
    const f = suggested.find((s) => s.column === c.name)?.field;
    if (f !== undefined && ok.has(f) && !used.has(f)) { out[c.name] = f; used.add(f); } else out[c.name] = "";
  }
  return out;
}

const squash = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Why a column that looks like a field of the type is left out: the field links to another record type, or is made by Vyre. Said on the column's row so nobody thinks they did something wrong. */
export function leftOutNotes(columns: readonly Col[], suggested: ReadonlyArray<{ column: string; field?: string }>, fields: ReadonlyArray<{ key: string; title?: string; type: string }>): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    const key = suggested.find((s) => s.column === c.name)?.field;
    // the server suggests no field it cannot fill, so a column named like such a field (Company for a link) is found by its name
    const name = squash(c.name);
    const f = key !== undefined ? fields.find((x) => x.key === key) : fields.find((x) => squash(x.title ?? x.key) === name || squash(x.key) === name);
    if (f === undefined || FILLABLE.has(f.type)) continue;
    out[c.name] = f.type === "relation" || f.type === "lookup" || f.type === "rollup" ? "Links to another record type; not brought in yet" : "Vyre fills this field in; it cannot come from a file";
  }
  return out;
}

/** One column is changed. A field feeds one column, so the column that had it before lets it go. */
export function pick(picks: Picks, column: string, field: string): Picks {
  const out: Record<string, string> = {};
  for (const [c, f] of Object.entries(picks)) out[c] = field !== "" && f === field && c !== column ? "" : f;
  out[column] = field;
  return out;
}

export const mapped = (picks: Picks): Array<{ column: string; field: string }> => Object.entries(picks).filter(([, f]) => f !== "").map(([column, field]) => ({ column, field }));

/** The fields people already in Records can be told apart by: email first when a column feeds it. */
export function defaultMatch(picks: Picks): string {
  const fed = new Set(Object.values(picks));
  return fed.has("email") ? "email" : "";
}

export interface Preview { rows: number; creates: number; updates: number; skips: number; repeats: number; errorCount: number; errors: ReadonlyArray<{ row: number; column?: string; message: string }> }

const n = (count: number, one: string, many: string): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** The rows in the file, in a sentence. */
export const fileLine = (p: Preview): string => `${n(p.rows, "row", "rows")} in the file.`;

/** The three counts of what happens to a row that is brought in or left alone, in order. With the repeats and the problems they make up the rows of the file. */
export function counts(p: Preview): Array<{ key: "new" | "updated" | "left"; value: number; label: string }> {
  return [{ key: "new", value: p.creates, label: "New" }, { key: "updated", value: p.updates, label: "Updated" }, { key: "left", value: p.skips, label: "Left alone" }];
}

/** What "left alone" means here, in one sentence; empty when none are. */
export function skipReason(p: Preview, onMatch: "update" | "skip"): string {
  if (p.skips === 0) return "";
  return onMatch === "skip" ? "Left alone: empty rows, and people already here, which you chose to leave as they are." : "Left alone: empty rows, and people already here who would not change.";
}

/** The rule for a repeat, said once. */
export function repeatsLine(p: Preview): string {
  if (p.repeats === 0) return "";
  return `${n(p.repeats, "row repeats", "rows repeat")} an earlier one in this file; the later ${p.repeats === 1 ? "row is" : "rows are"} used.`;
}

/** A row problem as a person reads it. */
export function problem(e: { row: number; column?: string; message: string }): string {
  return `Row ${e.row}${e.column ? `, ${e.column}` : ""}: ${e.message}`;
}

export function problemsLine(p: Preview): string {
  return p.errorCount === 0 ? "" : `${n(p.errorCount, "row has", "rows have")} a problem and will not be brought in.`;
}

/** The problem rows to list: the first few with their row number and reason, then how many more. */
export function problemLines(p: Preview, shown = 5): string[] {
  const out = p.errors.slice(0, shown).map(problem);
  if (p.errorCount > out.length) out.push(`and ${(p.errorCount - out.length).toLocaleString("en-US")} more`);
  return out;
}

/** What the primary button says, and whether it can be pressed: the rows that will be written (new and updated). */
export function importLabel(p: Preview): { label: string; ok: boolean } {
  const total = p.creates + p.updates;
  return total === 0 ? { label: "Nothing to bring in", ok: false } : { label: `Bring in ${n(total, "row", "rows")}`, ok: true };
}

export interface Done { created: number; updated: number; skipped: number; failed: number; state: string; repeated?: number; runId?: string }

/** The plain summary at the end: what was added and changed, and what was left. */
export function summary(d: Done, plural: string): string {
  const what = plural.toLowerCase();
  if (d.state === "failed") return `The import stopped. ${n(d.created + d.updated, "row was", "rows were")} written before it did, and the rest were not.`;
  if (d.state === "canceled") return `The import was stopped. ${n(d.created + d.updated, "row was", "rows were")} written.`;
  const parts = [`${n(d.created, "new row", "new rows")} added`];
  if (d.updated > 0) parts.push(`${n(d.updated, "row", "rows")} updated`);
  if (d.skipped > 0) parts.push(`${n(d.skipped, "row", "rows")} left alone`);
  if ((d.repeated ?? 0) > 0) parts.push(`${n(d.repeated ?? 0, "repeated row", "repeated rows")} left out for a later one`);
  if (d.failed > 0) parts.push(`${n(d.failed, "row", "rows")} left out for a problem`);
  return `${parts.join(", ")}. They are in ${what}.`;
}

export interface UndoReport { undone: ReadonlyArray<unknown>; skipped: ReadonlyArray<unknown> }

/** What Undo will do, before it is pressed. */
export function undoAsk(r: UndoReport): string {
  const keep = r.skipped.length > 0 ? ` ${n(r.skipped.length, "row", "rows")} changed since the import and ${r.skipped.length === 1 ? "stays" : "stay"} as ${r.skipped.length === 1 ? "it is" : "they are"}.` : "";
  return r.undone.length === 0 ? `Nothing can be taken back.${keep}` : `This removes the rows the import added and puts back the rows it changed: ${n(r.undone.length, "change", "changes")}.${keep}`;
}

/** What Undo did. */
export function undoneLine(r: UndoReport): string {
  const keep = r.skipped.length > 0 ? ` ${n(r.skipped.length, "row", "rows")} changed since the import and ${r.skipped.length === 1 ? "was" : "were"} left as ${r.skipped.length === 1 ? "it is" : "they are"}.` : "";
  return `The import is undone: ${n(r.undone.length, "change", "changes")} taken back.${keep}`;
}

/** How far a running import is: the rows added so far over the rows the preview said it would add. Updates are not counted by the table's size, so a run of updates shows no number. */
export function progressLine(added: number, planned: number, updatesToo: boolean): string {
  if (planned <= 0 || updatesToo) return "Bringing in your rows";
  return `${n(Math.min(added, planned), "row", "rows")} of ${planned.toLocaleString("en-US")} added`;
}
