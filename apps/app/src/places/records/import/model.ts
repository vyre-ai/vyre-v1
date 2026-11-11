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

export interface Preview { creates: number; updates: number; skips: number; errorCount: number; errors: ReadonlyArray<{ row: number; column?: string; message: string }> }

const n = (count: number, one: string, many: string): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** The three counts, in order. */
export function counts(p: Preview): Array<{ key: "new" | "updated" | "skipped"; value: number; label: string }> {
  return [{ key: "new", value: p.creates, label: "New" }, { key: "updated", value: p.updates, label: "Updated" }, { key: "skipped", value: p.skips, label: "Skipped" }];
}

/** Why rows are skipped, in one sentence; empty when none are. */
export function skipReason(p: Preview, onMatch: "update" | "skip"): string {
  if (p.skips === 0) return "";
  return onMatch === "skip" ? "Skipped rows are empty, or already in Records and left as they are." : "Skipped rows are empty.";
}

/** A row problem as a person reads it. */
export function problem(e: { row: number; column?: string; message: string }): string {
  return `Row ${e.row}${e.column ? `, ${e.column}` : ""}: ${e.message}`;
}

export function problemsLine(p: Preview): string {
  return p.errorCount === 0 ? "" : `${n(p.errorCount, "row has", "rows have")} a problem and will not be brought in.`;
}

/** What the primary button says, and whether it can be pressed. */
export function importLabel(p: Preview): { label: string; ok: boolean } {
  const total = p.creates + p.updates;
  return total === 0 ? { label: "Nothing to bring in", ok: false } : { label: `Bring in ${n(total, "row", "rows")}`, ok: true };
}

export interface Done { created: number; updated: number; skipped: number; failed: number; state: string }

/** The plain summary at the end. */
export function summary(d: Done, plural: string): string {
  const what = plural.toLowerCase();
  if (d.state === "failed") return `The import stopped. ${n(d.created + d.updated, "row was", "rows were")} written before it did, and the rest were not.`;
  if (d.state === "canceled") return `The import was stopped. ${n(d.created + d.updated, "row was", "rows were")} written.`;
  const parts = [`${n(d.created, "new row", "new rows")} added`];
  if (d.updated > 0) parts.push(`${n(d.updated, "row", "rows")} updated`);
  if (d.skipped > 0) parts.push(`${n(d.skipped, "row", "rows")} skipped`);
  if (d.failed > 0) parts.push(`${n(d.failed, "row", "rows")} left out for a problem`);
  return `${parts.join(", ")}. They are in ${what}.`;
}

/** How far a running import is: the rows added so far over the rows the preview said it would add. Updates are not counted by the table's size, so a run of updates shows no number. */
export function progressLine(added: number, planned: number, updatesToo: boolean): string {
  if (planned <= 0 || updatesToo) return "Bringing in your rows";
  return `${n(Math.min(added, planned), "row", "rows")} of ${planned.toLocaleString("en-US")} added`;
}
