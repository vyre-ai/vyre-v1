// Table window (ARCH 7.4, spec 2.9 speed).
// A table opens with LIMIT 200. The total is the cached count(*), never the page length.
// Columns are a second window: only the fields that fit the viewport are requested.

export const ROW_WINDOW = 200;
export const ROW_HEIGHT_PX = 36;
export const COL_WIDTH_PX = 160;
export const TABLE_OPEN_BUDGET_MS = 100;

export interface TableColumn {
  key: string;
  title: string;
}

export interface ColumnSpan {
  start: number;
  end: number;
  fit: number;
}

/** Ask for at most ROW_WINDOW rows. A missing or oversized limit becomes the window. */
export function queryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return ROW_WINDOW;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > ROW_WINDOW) return ROW_WINDOW;
  return n;
}

/** How many fixed-height rows fit in the viewport. At least one. */
export function visibleRowCount(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 1;
  return Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT_PX));
}

/** Inclusive start, exclusive end, clamped so the window stays inside the column list. */
export function columnSpan(columnCount: number, viewportWidth: number, scrollColumn: number): ColumnSpan {
  const fit = !Number.isFinite(viewportWidth) || viewportWidth <= 0
    ? 1
    : Math.max(1, Math.floor(viewportWidth / COL_WIDTH_PX));
  const count = Math.max(0, columnCount);
  const maxStart = Math.max(0, count - fit);
  const start = Math.min(Math.max(0, Math.floor(scrollColumn) || 0), maxStart);
  const end = Math.min(count, start + fit);
  return { start, end, fit };
}

export function visibleColumns(columns: readonly TableColumn[], span: ColumnSpan): TableColumn[] {
  return columns.slice(span.start, span.end);
}

/** Drop hidden fields before the column window is measured. */
export function columnsForView(columns: readonly TableColumn[], hidden: readonly string[] | undefined): TableColumn[] {
  if (!hidden || hidden.length === 0) return columns.slice();
  const drop = new Set(hidden);
  const out: TableColumn[] = [];
  for (const column of columns) {
    if (!drop.has(column.key)) out.push(column);
  }
  return out;
}

export interface SavedViewQuery {
  columns: TableColumn[];
  filter?: unknown;
  sort?: { field: string; dir: "asc" | "desc" }[];
}

/** A saved view's filter, sort and hidden fields, ready for records.query. */
export function applySavedView(
  columns: readonly TableColumn[],
  view: { filter?: unknown; sort?: unknown; hidden?: readonly string[] },
): SavedViewQuery {
  const query: SavedViewQuery = { columns: columnsForView(columns, view.hidden) };
  if (view.filter !== undefined) query.filter = view.filter;
  const sort = sortFromView(view.sort);
  if (sort) query.sort = sort;
  return query;
}

/** views.list stores sort as JSON. Only a list of {field, dir} is sent to records.query. */
export function sortFromView(value: unknown): { field: string; dir: "asc" | "desc" }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { field: string; dir: "asc" | "desc" }[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return undefined;
    const field = (item as { field?: unknown }).field;
    const dir = (item as { dir?: unknown }).dir;
    if (typeof field !== "string" || field.length === 0) return undefined;
    if (dir !== "asc" && dir !== "desc") return undefined;
    out.push({ field, dir });
  }
  return out;
}
