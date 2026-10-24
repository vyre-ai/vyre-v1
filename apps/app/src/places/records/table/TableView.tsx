// Records table (spec 3.4, 2.9, ARCH 7.4).
// Opens a LIMIT window of 200 rows and a column window that fits the viewport.
// The count on screen is records.counts, the cached count(*), not the page length.
// manifests/records.ts has no records.view screen. That file is outside this packet.

import { liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import { StatesPlaceholder } from "../../../../../../ui/src/States/Placeholder.tsx";
import { VirtualListPlaceholder } from "../../../../../../ui/src/VirtualList/Placeholder.tsx";
import { tokensOf } from "../../../../../../ui/src/tokens/skins.ts";
import type { Mode } from "../../../../../../ui/src/tokens/skins.ts";
import {
  COL_WIDTH_PX,
  ROW_HEIGHT_PX,
  ROW_WINDOW,
  columnSpan,
  queryLimit,
  visibleColumns,
  visibleRowCount,
} from "./window.ts";
import type { TableColumn } from "./window.ts";

export interface TableSessionInit {
  replica: FakeReplica;
  spaceId: string;
  spaceName: string;
  kit: string;
  skinId: string;
  mode: Mode;
  type: string;
  columns: readonly TableColumn[];
  viewportWidth: number;
  viewportHeight: number;
  filter?: unknown;
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  offline?: boolean;
}

interface LoadedWindow {
  offset: number;
  fieldsKey: string;
  rows: QueryRow[];
}

interface QueryRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface TableSession {
  replica: FakeReplica;
  spaceId: string;
  spaceName: string;
  kit: string;
  skinId: string;
  mode: Mode;
  type: string;
  columns: readonly TableColumn[];
  viewportWidth: number;
  viewportHeight: number;
  filter?: unknown;
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  offline: boolean;
  scrollRow: number;
  scrollColumn: number;
  loaded: LoadedWindow | null;
  fetches: number;
  rowsRead: number;
}

export interface TableFrame {
  screen: "records.view";
  spaceId: string;
  spaceName: string;
  kit: string;
  skinId: string;
  mode: Mode;
  type: string;
  total: number | null;
  countSource: "cached-count" | "loading";
  offset: number;
  limit: number;
  fetchedRows: number;
  painted: number;
  columnStart: number;
  columnEnd: number;
  fields: string[];
  viewportWidth: number;
  viewportHeight: number;
  status: "ready" | "loading" | "empty" | "offline" | "error";
  fetches: number;
  rowsRead: number;
}

export interface RenderedTable {
  html: string;
  openMs: number;
  frame: TableFrame;
}

/** Northwind uses the default Kit. Paper is the day skin (system: Paper by day). Harbor Studio shots use Mist. */
export const TABLE_SHOTS = [
  { spaceId: "spc_northwind", spaceName: "Northwind", kit: "default", skinId: "paper", mode: "light" as const, width: 1280, height: 720 },
  { spaceId: "spc_northwind", spaceName: "Northwind", kit: "default", skinId: "paper", mode: "light" as const, width: 390, height: 360 },
  { spaceId: "spc_harbor", spaceName: "Harbor Studio", kit: "harbor-studio", skinId: "mist", mode: "light" as const, width: 1280, height: 720 },
  { spaceId: "spc_harbor", spaceName: "Harbor Studio", kit: "harbor-studio", skinId: "mist", mode: "light" as const, width: 390, height: 360 },
] as const;

export function createTableSession(init: TableSessionInit): TableSession {
  const session: TableSession = {
    replica: init.replica,
    spaceId: init.spaceId,
    spaceName: init.spaceName,
    kit: init.kit,
    skinId: init.skinId,
    mode: init.mode,
    type: init.type,
    columns: init.columns,
    viewportWidth: init.viewportWidth,
    viewportHeight: init.viewportHeight,
    offline: init.offline ?? false,
    scrollRow: 0,
    scrollColumn: 0,
    loaded: null,
    fetches: 0,
    rowsRead: 0,
  };
  if (init.filter !== undefined) session.filter = init.filter;
  if (init.sort !== undefined) session.sort = init.sort;
  return session;
}

export function renderTable(session: TableSession): RenderedTable {
  const started = performance.now();
  const frame = loadFrame(session);
  const html = paint(session, frame);
  return { html, openMs: performance.now() - started, frame };
}

function loadFrame(session: TableSession): TableFrame {
  const span = columnSpan(session.columns.length, session.viewportWidth, session.scrollColumn);
  const columns = visibleColumns(session.columns, span);
  const fields = columns.map((column) => column.key);
  const fieldsKey = fields.join(",");
  const visible = visibleRowCount(session.viewportHeight);
  const limit = queryLimit(ROW_WINDOW);

  if (session.offline) {
    session.loaded = null;
    return frameOf(session, {
      total: null,
      countSource: "loading",
      offset: 0,
      limit,
      fetchedRows: 0,
      painted: 0,
      columnStart: span.start,
      columnEnd: span.end,
      fields,
      status: "offline",
    });
  }

  const total = readCount(session);
  if (total === "error") {
    return frameOf(session, {
      total: null,
      countSource: "loading",
      offset: 0,
      limit,
      fetchedRows: 0,
      painted: 0,
      columnStart: span.start,
      columnEnd: span.end,
      fields,
      status: "error",
    });
  }

  if (total !== null && total <= 0) {
    session.loaded = null;
    session.scrollRow = 0;
    return frameOf(session, {
      total: 0,
      countSource: "cached-count",
      offset: 0,
      limit,
      fetchedRows: 0,
      painted: 0,
      columnStart: span.start,
      columnEnd: span.end,
      fields,
      status: "empty",
    });
  }

  if (total !== null) {
    const maxStart = Math.max(0, total - 1);
    if (session.scrollRow > maxStart) session.scrollRow = maxStart;
    if (session.scrollRow < 0) session.scrollRow = 0;
  } else if (session.scrollRow < 0) {
    session.scrollRow = 0;
  }

  const covered = session.loaded !== null && covers(session.loaded, session.scrollRow, visible, fieldsKey, total);
  if (!covered) {
    const loaded = readWindow(session, fields, limit);
    if (loaded === "error") {
      return frameOf(session, {
        total,
        countSource: total === null ? "loading" : "cached-count",
        offset: session.scrollRow,
        limit,
        fetchedRows: 0,
        painted: 0,
        columnStart: span.start,
        columnEnd: span.end,
        fields,
        status: "error",
      });
    }
    if (loaded === null) {
      session.loaded = null;
      return frameOf(session, {
        total,
        countSource: total === null ? "loading" : "cached-count",
        offset: session.scrollRow,
        limit,
        fetchedRows: 0,
        painted: 0,
        columnStart: span.start,
        columnEnd: span.end,
        fields,
        status: "loading",
      });
    }
    session.loaded = { offset: session.scrollRow, fieldsKey, rows: loaded };
    session.fetches += 1;
    session.rowsRead += loaded.length;
  }

  const loaded = session.loaded;
  const painted = loaded ? sliceRows(loaded, session.scrollRow, visible, total).length : 0;
  const status = loaded ? "ready" : "loading";
  return frameOf(session, {
    total,
    countSource: total === null ? "loading" : "cached-count",
    offset: loaded ? loaded.offset : session.scrollRow,
    limit,
    fetchedRows: loaded ? loaded.rows.length : 0,
    painted,
    columnStart: span.start,
    columnEnd: span.end,
    fields,
    status,
  });
}

function frameOf(session: TableSession, part: Omit<TableFrame, "screen" | "spaceId" | "spaceName" | "kit" | "skinId" | "mode" | "type" | "viewportWidth" | "viewportHeight" | "fetches" | "rowsRead">): TableFrame {
  return {
    screen: "records.view",
    spaceId: session.spaceId,
    spaceName: session.spaceName,
    kit: session.kit,
    skinId: session.skinId,
    mode: session.mode,
    type: session.type,
    viewportWidth: session.viewportWidth,
    viewportHeight: session.viewportHeight,
    fetches: session.fetches,
    rowsRead: session.rowsRead,
    ...part,
  };
}

function covers(loaded: LoadedWindow, scrollRow: number, visible: number, fieldsKey: string, total: number | null): boolean {
  if (loaded.fieldsKey !== fieldsKey) return false;
  const start = scrollRow;
  let end = scrollRow + visible;
  if (total !== null) end = Math.min(end, total);
  if (end < start) return false;
  return start >= loaded.offset && end <= loaded.offset + loaded.rows.length;
}

function sliceRows(loaded: LoadedWindow, scrollRow: number, visible: number, total: number | null): QueryRow[] {
  const start = scrollRow - loaded.offset;
  if (start < 0) return [];
  let end = start + visible;
  if (total !== null) end = Math.min(end, total - loaded.offset);
  end = Math.min(end, loaded.rows.length);
  if (end <= start) return [];
  return loaded.rows.slice(start, end);
}

function readCount(session: TableSession): number | null | "error" {
  try {
    const snap = liveQuery(session.replica, "records.counts", countsInput(session)).getSnapshot();
    if (snap.status !== "ready") return null;
    return snap.data.count;
  } catch {
    return "error";
  }
}

function countsInput(session: TableSession): { type: string; filter?: unknown } {
  const input: { type: string; filter?: unknown } = { type: session.type };
  if (session.filter !== undefined) input.filter = session.filter;
  return input;
}

function readWindow(session: TableSession, fields: string[], limit: number): QueryRow[] | null | "error" {
  try {
    const snap = liveQuery(session.replica, "records.query", queryInput(session, fields, limit)).getSnapshot();
    if (snap.status !== "ready") return null;
    const rows: QueryRow[] = [];
    for (const row of snap.data.rows) rows.push({ id: row.id, fields: row.fields });
    return rows;
  } catch {
    return "error";
  }
}

function queryInput(session: TableSession, fields: string[], limit: number): {
  type: string;
  offset: number;
  limit: number;
  fields: string[];
  filter?: unknown;
  sort?: { field: string; dir: "asc" | "desc" }[];
} {
  const input: {
    type: string;
    offset: number;
    limit: number;
    fields: string[];
    filter?: unknown;
    sort?: { field: string; dir: "asc" | "desc" }[];
  } = {
    type: session.type,
    offset: session.scrollRow,
    limit: queryLimit(limit),
    fields,
  };
  if (session.filter !== undefined) input.filter = session.filter;
  if (session.sort !== undefined) input.sort = session.sort.map((item) => ({ field: item.field, dir: item.dir }));
  return input;
}

function paint(session: TableSession, frame: TableFrame): string {
  const style = `${skinStyle(session.skinId, session.mode)};width:${frame.viewportWidth}px;height:${frame.viewportHeight}px`;
  const head = columnsHead(session, frame);
  let body = "";
  if (frame.status === "offline") {
    body = StatesPlaceholder({ kind: "offline", title: "Offline. Records open from the copy on this device.", icon: "offline" });
  } else if (frame.status === "error") {
    body = StatesPlaceholder({ kind: "error", message: "Could not open the table", next: "Try again", retryable: true });
  } else if (frame.status === "empty") {
    body = StatesPlaceholder({ kind: "empty", title: "No records yet", icon: "records" });
  } else if (frame.status === "loading" || session.loaded === null) {
    body = skeleton(visibleRowCount(session.viewportHeight));
  } else {
    body = readyBody(session, frame);
  }
  return `<section data-screen="records.view" data-view="table" data-space="${esc(frame.spaceName)}" data-space-id="${esc(frame.spaceId)}" data-kit="${esc(frame.kit)}" data-skin="${esc(frame.skinId)}" data-mode="${esc(frame.mode)}" data-type="${esc(frame.type)}" data-status="${frame.status}" data-viewport="${frame.viewportWidth}" data-viewport-height="${frame.viewportHeight}" data-row-window="${ROW_WINDOW}" data-row-height="${ROW_HEIGHT_PX}" data-col-width="${COL_WIDTH_PX}" data-limit="${frame.limit}" data-offset="${frame.offset}" data-fetched-rows="${frame.fetchedRows}" data-painted="${frame.painted}" data-fetches="${frame.fetches}" data-rows-read="${frame.rowsRead}" data-column-start="${frame.columnStart}" data-column-end="${frame.columnEnd}" data-fields="${esc(frame.fields.join(","))}" ${totalAttrs(frame)} style="${esc(style)}">${countLine(frame)}${head}${body}</section>`;
}

function totalAttrs(frame: TableFrame): string {
  if (frame.countSource !== "cached-count" || frame.total === null) return `data-count-source="loading"`;
  return `data-count-source="cached-count" data-total="${frame.total}"`;
}

function countLine(frame: TableFrame): string {
  if (frame.countSource !== "cached-count" || frame.total === null) {
    return `<span data-total-slot data-total-state="loading" style="display:inline-block;min-width:8ch;height:1em"></span>`;
  }
  return `<span data-total-slot data-total-state="ready" data-count-source="cached-count" style="display:inline-block;min-width:8ch;height:1em">${frame.total}</span>`;
}

function columnsHead(session: TableSession, frame: TableFrame): string {
  const columns = session.columns.slice(frame.columnStart, frame.columnEnd);
  const cells: string[] = [];
  for (const column of columns) {
    cells.push(`<div data-col="${esc(column.key)}" style="width:${COL_WIDTH_PX}px;height:${ROW_HEIGHT_PX}px">${esc(column.title)}</div>`);
  }
  return `<div data-columns="${esc(frame.fields.join(","))}" data-column-start="${frame.columnStart}" data-column-end="${frame.columnEnd}">${cells.join("")}</div>`;
}

function readyBody(session: TableSession, frame: TableFrame): string {
  const loaded = session.loaded;
  if (!loaded) return skeleton(visibleRowCount(session.viewportHeight));
  const visible = visibleRowCount(session.viewportHeight);
  const rows = sliceRows(loaded, session.scrollRow, visible, frame.total);
  const columns = session.columns.slice(frame.columnStart, frame.columnEnd);
  const items: { title: string; id: string }[] = [];
  const sheet: string[] = [];
  for (const row of rows) {
    items.push({ title: row.id, id: row.id });
    sheet.push(paintRow(row, columns));
  }
  const list = VirtualListPlaceholder({
    data: items,
    renderItem: rowMarkup,
    rowHeight: ROW_HEIGHT_PX,
    window: { start: 0, end: items.length },
    keyOf: rowKey,
  });
  const height = rows.length * ROW_HEIGHT_PX;
  return `<div data-viewport-box style="width:${frame.viewportWidth}px;height:${frame.viewportHeight}px;overflow:hidden"><div data-virtual>${list}</div><div data-sheet style="height:${height}px">${sheet.join("")}</div></div>`;
}

function rowMarkup(item: { title: string; id: string }): string {
  return item.title;
}

function rowKey(item: { title: string; id: string }): string {
  return item.id;
}

function paintRow(row: QueryRow, columns: readonly TableColumn[]): string {
  const cells: string[] = [];
  for (const column of columns) {
    cells.push(`<div data-cell="${esc(column.key)}" style="width:${COL_WIDTH_PX}px;height:${ROW_HEIGHT_PX}px">${esc(cellText(row.fields[column.key]))}</div>`);
  }
  const title = RowPlaceholder({ id: row.id, title: row.id });
  return `<div data-paint-row="${esc(row.id)}" style="height:${ROW_HEIGHT_PX}px;width:100%">${title}${cells.join("")}</div>`;
}

function skeleton(rows: number): string {
  const items: string[] = [];
  for (let i = 0; i < rows; i++) {
    items.push(`<div data-skeleton="row" style="height:${ROW_HEIGHT_PX}px;width:100%"></div>`);
  }
  return `<div data-skeleton="table" style="height:${rows * ROW_HEIGHT_PX}px">${items.join("")}</div>`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "sealed" in value && (value as { sealed?: unknown }).sealed === true) return "Sealed";
  return "";
}

function skinStyle(skinId: string, mode: Mode): string {
  const tokens = tokensOf(skinId, mode) ?? tokensOf("paper", "light");
  if (!tokens) return "";
  const parts: string[] = [];
  for (const name of Object.keys(tokens) as (keyof typeof tokens)[]) {
    const value = tokens[name];
    if (value === undefined) continue;
    parts.push(`${name}:${value}`);
  }
  return parts.join(";");
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
