// ms.workbook.*: reading and writing the cells of an Excel workbook in OneDrive or SharePoint through Graph's workbook API (live folders L3, native editing by agents).
// The workbook stays where it is and nobody downloads it: a range is read or written in place, and Excel (and everyone with the file open) sees the change. Every call acts as one member
// like the rest of the drive calls, so the member's own access to the file decides.
//   get_range     the values of A1:C10 on a worksheet
//   update_range  write a block of cells; a single start cell ("B2") grows to the size of the values
//   append_rows   write the rows under the last used row of a worksheet
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, enc, GRAPH, int, list, obj, resolveSubject, text, userUrl } from "../projections.ts";
import type { MsCtx } from "../projections.ts";
import type { Act } from "./graph.ts";

type Cell = string | number | boolean | null;
export type Values = Cell[][];

const driveBase = (sub: string, driveId?: string): string => (driveId ? `${GRAPH}/drives/${enc(driveId)}` : userUrl(sub, "/drive"));

const call = (ctx: MsCtx, a: Act, cap: string, c: { method?: "GET" | "PATCH"; url: string; query?: Record<string, string>; body?: unknown }): Promise<Record<string, unknown>> =>
  api(ctx, { cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), ...c });

interface Target extends Act { driveId?: string; itemId: string; sheet: string }

function sheetUrl(ctx: MsCtx, a: Target): string {
  if (a.sheet === "" || /['\\/?#]/.test(a.sheet)) bad(ctx, "sheet must be a worksheet name without quotes or slashes.");
  const sub = resolveSubject(ctx, { connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}) });
  return `${driveBase(sub, a.driveId)}/items/${enc(a.itemId)}/workbook/worksheets/${enc(a.sheet)}`;
}

const ADDRESS = /^[A-Za-z]{1,3}[1-9][0-9]{0,6}(:[A-Za-z]{1,3}[1-9][0-9]{0,6})?$/;

function address(ctx: MsCtx, range: string): string {
  if (!ADDRESS.test(range)) bad(ctx, "range must be cells such as A1:C10 or B2.");
  return range.toUpperCase();
}

const colNumber = (letters: string): number => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
function colLetters(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** "B2" with 2 rows and 3 columns of values is B2:D3; a block that already names its size is kept as it is. */
export function fitRange(ctx: MsCtx, range: string, values: Values): string {
  const addr = address(ctx, range);
  const rows = values.length, cols = Math.max(0, ...values.map((r) => r.length));
  if (rows === 0 || cols === 0) bad(ctx, "values must hold at least one cell.");
  if (values.some((r) => r.length !== cols)) bad(ctx, "every row of values must have the same number of cells.");
  if (addr.includes(":")) return addr;
  const m = /^([A-Z]+)([0-9]+)$/.exec(addr) as RegExpExecArray;
  return `${addr}:${colLetters(colNumber(m[1] as string) + cols - 1)}${Number(m[2]) + rows - 1}`;
}

const cellsOf = (v: unknown): Values =>
  list(v).map((row) => list(row).map((c): Cell => (typeof c === "string" || typeof c === "number" || typeof c === "boolean" || c === null ? c : String(c ?? ""))));

export async function workbookRange(ctx: MsCtx, a: Target & { range: string }) {
  const url = sheetUrl(ctx, a);
  const r = await call(ctx, a, "ms.workbook.get_range", { url: `${url}/range(address='${address(ctx, a.range)}')`, query: { $select: "address,values" } });
  return { address: text(r.address) ?? a.range, values: cellsOf(r.values) };
}

export async function workbookUpdate(ctx: MsCtx, a: Target & { range: string; values: Values }) {
  const url = sheetUrl(ctx, a);
  const fit = fitRange(ctx, a.range, a.values);
  const r = await call(ctx, a, "ms.workbook.update_range", { method: "PATCH", url: `${url}/range(address='${fit}')`, body: { values: a.values } });
  return { address: text(r.address) ?? fit, updatedCells: a.values.reduce((n, row) => n + row.length, 0) };
}

export async function workbookAppend(ctx: MsCtx, a: Target & { values: Values }) {
  const url = sheetUrl(ctx, a);
  const cols = Math.max(0, ...a.values.map((r) => r.length));
  if (a.values.length === 0 || cols === 0) bad(ctx, "values must hold at least one cell.");
  if (a.values.some((r) => r.length !== cols)) bad(ctx, "every row of values must have the same number of cells.");
  // The last row in use, from the sheet itself. A sheet nothing was ever written to answers A1 with an empty cell: the first row is then row 1.
  const used = await call(ctx, a, "ms.workbook.append_rows", { url: `${url}/usedRange(valuesOnly=true)`, query: { $select: "address,rowCount,columnCount,values" } });
  const m = /!?([A-Za-z]+)([0-9]+)(?::([A-Za-z]+)([0-9]+))?$/.exec(text(used.address) ?? "");
  if (!m) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Microsoft answered something unexpected." });
  const empty = int(used.rowCount) === 1 && int(used.columnCount) === 1 && cellsOf(used.values)[0]?.[0] === "";
  const firstCol = (m[1] as string).toUpperCase();
  const lastRow = Number(m[4] ?? m[2]);
  const row = empty ? 1 : lastRow + 1;
  const fit = `${firstCol}${row}:${colLetters(colNumber(firstCol) + cols - 1)}${row + a.values.length - 1}`;
  const r = await call(ctx, a, "ms.workbook.append_rows", { method: "PATCH", url: `${url}/range(address='${fit}')`, body: { values: a.values } });
  return { address: text(r.address) ?? fit, updatedRows: a.values.length };
}
