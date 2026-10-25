// Spreadsheet steps (spec 2.16, 2.12): Create, Add rows, Find rows, Update rows, Delete rows and Read all rows, as calls to the files module's sheets.* capabilities.
// DECISION: a sheet step only ever adds, changes or removes rows. No step replaces a file or a sheet, so two Runs working on one sheet never overwrite each other; every write is a file version
// labelled with the Automation and the Run, which is what lets "Undo this run" and the row trigger work.
import { stepError } from "../projections.ts";
import type { StepsCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SheetEnv { ctx: StepsCtx; run: { id: string; label?: string } }
const MAX_ROWS = 10_000;

/** The version label of a write: who did it, so history and Undo can find it. */
export const labelOf = (env: SheetEnv): string => `${env.run.label ?? "Automation"} (run ${env.run.id})`;

const call = async (env: SheetEnv, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!env.ctx.call) throw stepError("internal.unavailable", "Spreadsheets are not available right now.", true);
  return env.ctx.call(cap, input);
};
const withSheet = (i: In): Record<string, unknown> => (typeof i.sheet === "string" && i.sheet ? { sheet: i.sheet } : {});
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Read every page of a sheet (up to 10,000 rows) so a step sees the whole table or fails loudly instead of acting on part of it. */
async function readAll(env: SheetEnv, base: Record<string, unknown>): Promise<{ rowId: string; values: Record<string, unknown> }[]> {
  const rows: { rowId: string; values: Record<string, unknown> }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 1000; i++) {
    const r = await call(env, "sheets.read_rows", { ...base, limit: 500, ...(cursor ? { cursor } : {}) });
    rows.push(...((r?.rows ?? []) as typeof rows));
    if (rows.length > MAX_ROWS) throw stepError("validation.too_large", `The sheet has more than ${MAX_ROWS} matching rows. Narrow the search.`);
    if (!r?.next) return rows;
    cursor = r.next as string;
  }
  throw stepError("validation.too_large", "The sheet is too long to read in one step.");
}

export const SHEET_STEPS: Record<string, (env: SheetEnv, i: In, key: string) => Promise<unknown>> = {
  "sheet.create": async (env, i, key) => {
    const r = await call(env, "sheets.create", { folderId: i.folderId, name: i.name, format: i.format, columns: i.columns, ...withSheet(i), idempotencyKey: key });
    return { fileId: r?.file?.id ?? r?.fileId };
  },
  "sheet.add_rows": async (env, i, key) => {
    if (!Array.isArray(i.rows) || i.rows.length === 0 || !i.rows.every(isRecord)) throw stepError("validation.bad_input", "Add rows needs a list of rows, each with column values.");
    const r = await call(env, "sheets.append_rows", { fileId: i.fileId, ...withSheet(i), rows: i.rows, label: labelOf(env), idempotencyKey: key });
    return { appended: r?.appended ?? 0, rowIds: r?.rowIds ?? [] };
  },
  "sheet.find_rows": async (env, i) => ({
    rows: await readAll(env, { fileId: i.fileId, ...withSheet(i), ...(i.where !== undefined ? { where: i.where } : {}), ...(Array.isArray(i.columns) ? { columns: i.columns } : {}) }),
  }),
  "sheet.read_all": async (env, i) => ({ rows: await readAll(env, { fileId: i.fileId, ...withSheet(i) }) }),
  "sheet.update_rows": async (env, i) => {
    const hasId = typeof i.rowId === "string" && i.rowId.length > 0;
    const hasKey = isRecord(i.key) && typeof i.key.column === "string";
    if (hasId === hasKey) throw stepError("validation.precondition_failed", "Say which row to update: a row id, or a key column and its value.");
    if (!isRecord(i.values) || Object.keys(i.values).length === 0) throw stepError("validation.bad_input", "Update rows needs the column values to change.");
    // only the columns named here are sent: the other cells of the row, and every other row, stay as they are
    const r = await call(env, "sheets.update_row", { fileId: i.fileId, ...withSheet(i), ...(hasId ? { rowId: i.rowId } : { key: i.key }), values: i.values, label: labelOf(env) });
    return { rowId: r?.rowId, ...(r?.versionId ? { versionId: r.versionId } : {}) };
  },
  "sheet.delete_rows": async (env, i) => {
    if (typeof i.rowId !== "string" || !i.rowId) throw stepError("validation.bad_input", "Delete rows needs the id of the row.");
    const r = await call(env, "sheets.delete_row", { fileId: i.fileId, ...withSheet(i), rowId: i.rowId, label: labelOf(env) });
    return { deleted: r?.deleted === true };
  },
};
