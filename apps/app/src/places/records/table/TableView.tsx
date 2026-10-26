// Records > table (spec 3.4, 2.9): a type's records as a sheet. 100,000 rows open under 100 ms because the table never holds more than a window: it asks the local copy for 200 rows at
// a time and draws only the rows and the columns that meet the screen, with the title column and the row numbers held at the left. The count in the foot is the cached count(*).
// Filter, Sort, Group, Fields and Colour are quiet buttons in the header; each opens a menu with checkmarks and counts. Click a header to sort; Enter or Space opens the record.
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { marbleSpec } from "../../../../../../ui/src/Avatar/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useLive, useOnline, useOptionalRecordsData, useRecordsData, useScreenQuery } from "../sidebar/data.tsx";
import { SCREENS, effectiveType, typeGroups } from "../sidebar/model.ts";
import type { ViewRow as SavedView } from "../sidebar/model.ts";
import { Face, Glyph, HeadButton, pointOf, typeIcon } from "../sidebar/parts.tsx";
import { useRecordsState } from "../sidebar/state.tsx";
import { Scroller } from "./Scroller.tsx";
import type { ScrollHandle } from "./Scroller.tsx";
import {
  FLING_OVERSCAN, GROUP_LIMIT, GUTTER, HEAD_H, ROW_H, chosen, cellText, clearClauses, colourOf, columnWindow, columnsOf, countSpec, cycleSort, filterOf, fromSaved, groupItems, groupable, hasOptions,
  hueOf, isEdited, isNumeric, optionValue, optionsOf, queryOffset, querySpec, rowWindow, setSort, sortable, toSaved, toggleHidden, toggleOption, totalWidth,
} from "./model.ts";
import { allIds, eachId, recordsWord } from "./bulk.ts";
import { NO_PICK, isPickedRow, pickCount, toggleHeader, togglePick } from "./model.ts";
import type { Column, FieldDef, RowPick, RecordRow, TableViewState, TypeDef } from "./model.ts";

type TypesOut = CapMap["schema.types.list"]["out"];
type ViewsOut = CapMap["views.list"]["out"];

const STICKY = (left: number): ViewStyle => (Platform.OS === "web" ? ({ position: "sticky", left, zIndex: 2 } as unknown as ViewStyle) : {});

// ---------------------------------------------------------------- cells

function Tag({ field, value }: { field: FieldDef; value: string }): ReactElement {
  const opt = optionsOf(field).find((o) => o.key === value);
  const hue = opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(value);
  return (
    <View style={[styles.tag, { backgroundColor: `hsla(${hue}, 65%, 52%, 0.16)` }]}>
      <Text numberOfLines={1} style={[styles.tagText, { color: `hsl(${hue}, 55%, 40%)` }]}>{opt?.title ?? value}</Text>
    </View>
  );
}

function Cell({ field, row, names }: { field: FieldDef; row: RecordRow; names: (id: string) => string }): ReactElement | null {
  const v = row.fields[field.key];
  if (v === undefined || v === null || v === "") return null;
  if ((field.type === "choice" || field.type === "status") && typeof v === "string") return <Tag field={field} value={v} />;
  if (field.type === "checkbox") return v === true ? <Glyph name="check" size={14} color="var(--ink-2)" width={1.8} /> : null;
  if (field.type === "person") return <View style={styles.person}><Face name={names(String(v))} size={18} /><Text numberOfLines={1} style={styles.cellText}>{names(String(v))}</Text></View>;
  if (field.type === "rating" && typeof v === "number") return <Text style={styles.stars} accessibilityLabel={`${v} of 5`}>{"★".repeat(Math.max(0, Math.min(5, v)))}</Text>;
  return <Text numberOfLines={1} style={[styles.cellText, isNumeric(field) && styles.num, field.type === "sealed" && styles.sealed]}>{cellText(field, v, names)}</Text>;
}

interface RowProps {
  row: RecordRow | null;
  n: number;
  y: number;
  width: number;
  cols: readonly Column[];
  from: number;
  to: number;
  pad: number;
  selected: boolean;
  tint: string | null;
  names: (id: string) => string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

const TableRow = memo(function TableRow({ row, n, y, width, cols, from, to, pad, selected, tint, names, onSelect, onOpen }: RowProps): ReactElement {
  const [over, setOver] = useState(false);
  const last = useRef(0);
  const bg = selected ? "var(--sel)" : over ? "var(--hover)" : tint ?? "var(--win)";
  const primary = cols[0];
  const cells: ReactElement[] = [];
  for (let i = from; i < to; i++) {
    const c = cols[i]!;
    cells.push(<View key={c.field.key} style={[styles.td, { width: c.width }, isNumeric(c.field) && styles.tdNum]}>{row ? <Cell field={c.field} row={row} names={names} /> : <View style={styles.ghostBar} />}</View>);
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row ? String(row.fields[primary?.field.key ?? ""] ?? row.id) : "Loading"}
      accessibilityState={{ selected }}
      testID={row ? `rec-${row.id}` : `rec-pending-${n}`}
      onPress={() => {
        if (!row) return;
        onSelect(row.id);
        const now = Date.now();
        if (now - last.current < 450) { last.current = 0; onOpen(row.id); } else last.current = now;
      }}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.tr, { top: y, width, backgroundColor: bg }]}
    >
      <View style={[styles.rn, STICKY(0), { backgroundColor: bg }]}><Text style={styles.rnText}>{n}</Text></View>
      {primary ? (
        <View style={[styles.td, styles.tdFirst, STICKY(GUTTER), { width: primary.width, backgroundColor: bg }]}>
          {row ? (
            <>
              <Text numberOfLines={1} style={[styles.cellText, styles.title]}>{cellText(primary.field, row.fields[primary.field.key], names) || "Untitled"}</Text>
              {over || selected ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Open record" testID={`open-${row.id}`} onPress={() => onOpen(row.id)} style={styles.xopen}><Glyph name="expand" size={13} color="var(--ink-2)" /></Pressable>
              ) : null}
            </>
          ) : <View style={styles.ghostBar} />}
        </View>
      ) : null}
      {pad > 0 ? <View style={{ width: pad }} /> : null}
      {cells}
    </Pressable>
  );
});


// On the web a row is two pieces: the frozen left (row number and title) drawn in one sticky layer, and the scrolling rest. One sticky element for the whole table instead of two per row keeps a
// scroll from re-resolving hundreds of sticky offsets every frame (that cost frames and shifted layout). The pieces hold no state of their own: hover and clicks come down from the grid.
interface PieceProps {
  row: RecordRow | null;
  n: number;
  y: number;
  selected: boolean;
  hot: boolean;
  tint: string | null;
  names: (id: string) => string;
  onTap: (id: string, meta?: boolean) => void;
  onOpen: (id: string) => void;
  onHot: (id: string | null) => void;
  onMenu: (row: RecordRow, x: number, y: number) => void;
}

const bgOf = (p: { selected: boolean; hot: boolean; tint: string | null }): string => (p.selected ? "var(--sel)" : p.hot ? "var(--hover)" : p.tint ?? "var(--win)");

/**
 * A new query window hands back new row objects (a clone each time), so a plain memo re-rendered every drawn row, 13 cells each, whenever the window moved by a hundred rows: that was the
 * long frames of the 100,000-row scroll. A row is the same row when it has the same id, version and update time.
 */
const sameRow = (a: RecordRow | null, b: RecordRow | null): boolean => a === b || (a !== null && b !== null && a.id === b.id && a.version === b.version && a.updatedAt === b.updatedAt);
function samePiece<T extends PieceProps>(a: T, b: T): boolean {
  if (!sameRow(a.row, b.row)) return false;
  const ka = Object.keys(a) as (keyof T)[];
  for (const k of ka) if (k !== "row" && a[k] !== b[k]) return false;
  return ka.length === Object.keys(b).length;
}

const RowFrozen = memo(function RowFrozen(p: PieceProps & { primary: Column }): ReactElement {
  const { row, n, y, selected, hot, primary, names, onTap, onOpen, onHot, onMenu } = p;
  ensureRowCss();
  const bg = bgOf(p);
  const title = row ? cellText(primary.field, row.fields[primary.field.key], names) || "Untitled" : "";
  // plain elements, like the scrolling cells: this piece is mounted for every row that scrolls in
  return createElement(
    "div",
    {
      role: "button", "aria-label": row ? String(row.fields[primary.field.key] ?? row.id) : "Loading", "aria-selected": selected, "data-testid": row ? `rec-${row.id}` : `rec-pending-${n}`,
      onClick: (e: { metaKey?: boolean; ctrlKey?: boolean }) => { if (row) onTap(row.id, e.metaKey === true || e.ctrlKey === true); },
      ...menuTrigger((x, y) => { if (row) onMenu(row, x, y); }),
      onMouseEnter: () => onHot(row ? row.id : null), onMouseLeave: () => onHot(null),
      className: "vrt-r", style: { left: 0, top: y, width: GUTTER + primary.width, backgroundColor: bg },
    },
    createElement("div", { className: "vrt-g", style: { backgroundColor: bg } }, String(n)),
    createElement("div", { style: { width: primary.width, height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, boxSizing: "border-box", padding: "0 10px", overflow: "hidden", flex: "none", backgroundColor: bg } },
      row ? createElement("span", { style: { ...CELL_TEXT, fontWeight: 500 } }, title) : createElement("div", { style: GHOST }),
      row && (hot || selected) ? <Pressable accessibilityRole="button" accessibilityLabel="Open record" testID={`open-${row.id}`} onPress={() => onOpen(row.id)} style={styles.xopen}><Glyph name="expand" size={13} color="var(--ink-2)" /></Pressable> : null,
    ),
  );
}, samePiece);

// The scrolling cells are plain elements, not React Native views and texts: a scroll mounts a few rows a frame, and 13 cells of a row as View and Text each cost several times a plain div. The
// 100,000-row scroll probe was 66.7 ms at p95 with every column and 16.8 ms with the name column alone, so the cost is the cells. Same looks as the cell styles below.
// No overflow or contain on a cell: each one is a clip in the paint property tree, and 13 of them a row put Layerize at 5.9 ms a frame in the perf trace (run 40219986248, 3.6 s over 606 frames).
// The text inside clips itself with its own ellipsis and the row clips what is left.
const CELL_BOX = { boxSizing: "border-box", display: "flex", alignItems: "center", flex: "none", height: "100%", padding: "0 10px", minWidth: 0 } as const;
const CELL_TEXT = { fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } as const;
const CELL_NUM = { ...CELL_TEXT, fontVariantNumeric: "tabular-nums", textAlign: "right" } as const;
const CELL_SEALED = { ...CELL_TEXT, color: "var(--ink-3)", letterSpacing: 1 } as const;
const CELL_STARS = { fontSize: 12, color: "var(--warn)", letterSpacing: 1, whiteSpace: "nowrap" } as const;
const CELL_PERSON = { display: "flex", alignItems: "center", gap: 7, minWidth: 0 } as const;
const GHOST = { height: 9, width: "55%", borderRadius: 5, backgroundColor: "var(--hover)" } as const;

/**
 * The scrolling rows are styled by classes from one stylesheet, set once: an inline style of ten properties on each of the 500 elements a fling mounts was a good part of the scroll cost. Only
 * what changes per element (position, width, background) stays inline. Rows are only drawn after the page is live, so the static export needs none of it.
 */
/**
 * The scroll position the table redraws at, in rows. A hard fling is 3.5 rows a frame: at 8 rows a redraw came every second or third frame and mounted 8 rows at once, and those frames were the
 * p95 (33 ms, two vsyncs). At 2 rows the redraws are smaller and steadier, so no frame carries the whole block.
 */
const ROW_STEP = 2;
const CSS_ID = "vyre-records-rows";
let cssDone = false;
function ensureRowCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: { getElementById(id: string): unknown; createElement(t: string): { id: string; textContent: string }; head?: { appendChild(n: unknown): void } } }).document;
  if (!d || !d.head || d.getElementById(CSS_ID)) return;
  const el = d.createElement("style");
  el.id = CSS_ID;
  el.textContent = `.vrt-r{position:absolute;box-sizing:border-box;display:flex;align-items:center;height:${ROW_H}px;border-bottom:1px solid var(--line);contain:layout style paint}`
    + ".vrt-c{box-sizing:border-box;flex:none;padding:0 10px;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + ".vrt-n{font-variant-numeric:tabular-nums;text-align:right}.vrt-s{color:var(--ink-3);letter-spacing:1px}"
    + ".vrt-g{width:" + GUTTER + "px;height:100%;display:flex;align-items:center;box-sizing:border-box;padding-left:10px;flex:none;font-size:11.5px;color:var(--ink-4);font-variant-numeric:tabular-nums}";
  d.head.appendChild(el);
  cssDone = true;
}

/** The field types webCell draws as plain text (everything but chips, ticks, faces and stars). */
function isPlainText(f: FieldDef): boolean {
  return f.type !== "choice" && f.type !== "status" && f.type !== "checkbox" && f.type !== "person" && f.type !== "rating";
}

const dots = new Map<string, Record<string, string | number>>();
/** A person's face in a cell: a plain disc in the colours of the shared marble (marbleSpec), one cached style per name. The shared Avatar draws a blurred svg, too dear for thirteen cells a row. */
function dot(name: string): ReactElement {
  let st = dots.get(name);
  if (!st) {
    const m = marbleSpec(name);
    st = { width: 18, height: 18, flex: "none", borderRadius: 9, background: `radial-gradient(circle at 30% 25%, ${m.c1}, transparent 60%), radial-gradient(circle at 75% 80%, ${m.c2}, transparent 55%), ${m.base}` };
    dots.set(name, st);
  }
  return createElement("span", { "aria-hidden": true, "data-testid": `face-${name}`, style: st });
}

function webCell(field: FieldDef, row: RecordRow, names: (id: string) => string): ReactElement | null {
  const v = row.fields[field.key];
  if (v === undefined || v === null || v === "") return null;
  if ((field.type === "choice" || field.type === "status") && typeof v === "string") {
    const opt = optionsOf(field).find((o) => o.key === v);
    const hue = opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(v);
    return createElement("span", { style: { boxSizing: "border-box", display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 6, maxWidth: "100%", overflow: "hidden", backgroundColor: `hsla(${hue}, 65%, 52%, 0.16)` } },
      createElement("span", { style: { fontSize: 12, fontWeight: 500, color: `hsl(${hue}, 55%, 40%)`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, opt?.title ?? v));
  }
  if (field.type === "checkbox") return v === true ? <Glyph name="check" size={14} color="var(--ink-2)" width={1.8} /> : null;
  if (field.type === "person") return createElement("span", { style: CELL_PERSON }, dot(names(String(v))), createElement("span", { style: CELL_TEXT }, names(String(v))));
  if (field.type === "rating" && typeof v === "number") return createElement("span", { style: CELL_STARS, "aria-label": `${v} of 5` }, "\u2605".repeat(Math.max(0, Math.min(5, v))));
  return createElement("span", { style: field.type === "sealed" ? CELL_SEALED : isNumeric(field) ? CELL_NUM : CELL_TEXT }, cellText(field, v, names));
}

const RowBody = memo(function RowBody(p: PieceProps & { left: number; width: number; cols: readonly Column[]; from: number; to: number; pad: number }): ReactElement {
  const { row, n, y, left, width, cols, from, to, pad, names, onTap, onHot, onMenu } = p;
  ensureRowCss();
  const bg = bgOf(p);
  const cells: ReactElement[] = [];
  for (let i = from; i < to; i++) {
    const c = cols[i]!;
    // a plain text cell is one element, not a box with a span in it: the scroll trace (run 40232405129) had the whole cost in the cells, 33.4 ms p95 with them and 16.8 ms without
    if (row && isPlainText(c.field)) {
      const v = row.fields[c.field.key];
      cells.push(createElement("div", { key: c.field.key, className: isNumeric(c.field) ? "vrt-c vrt-n" : c.field.type === "sealed" ? "vrt-c vrt-s" : "vrt-c", style: { width: c.width } }, v === undefined || v === null || v === "" ? null : cellText(c.field, v, names)));
      continue;
    }
    cells.push(createElement("div", { key: c.field.key, style: isNumeric(c.field) ? { ...CELL_BOX, width: c.width, justifyContent: "flex-end" } : { ...CELL_BOX, width: c.width } }, row ? webCell(c.field, row, names) : createElement("div", { style: GHOST })));
  }
  return createElement(
    "div",
    {
      "data-testid": row ? `recb-${row.id}` : `recb-pending-${n}`,
      onClick: (e: { metaKey?: boolean; ctrlKey?: boolean }) => { if (row) onTap(row.id, e.metaKey === true || e.ctrlKey === true); }, ...menuTrigger((x, y) => { if (row) onMenu(row, x, y); }),
      onMouseEnter: () => onHot(row ? row.id : null), onMouseLeave: () => onHot(null),
      className: "vrt-r", style: { top: y, left, width, backgroundColor: bg },
    },
    pad > 0 ? createElement("div", { key: "pad", style: { width: pad, flex: "none" } }) : null,
    ...cells,
  );
}, samePiece);

// ---------------------------------------------------------------- the grid

export interface TableViewProps {
  /** The shell may force a type (a deep link); otherwise the sidebar's open type shows. */
  type?: string;
  /** A starting view on top of the saved one (a deep link to a filtered table). */
  view?: Partial<TableViewState>;
  /** What the Records place adds to the header, before New: the switch between the table and the other kinds of view. */
  headerExtra?: ReactNode;
}

function Grid({ type, def, views, base, saved, headerExtra }: { type: string; def: TypeDef; views: readonly SavedView[]; base: TableViewState; saved: SavedView | undefined; headerExtra: ReactNode }): ReactElement {
  const data = useRecordsData();
  const { state, dispatch } = useRecordsState();
  const menu = useMenu();
  const online = useOnline();
  const phone = useWindowDimensions().width;
  const slim = phone > 0 && phone < 720;
  const [v, setV] = useState<TableViewState>(base);
  const [folded, setFolded] = useState<readonly string[]>([]);
  const [finding, setFinding] = useState(base.find !== "");
  const [selected, setSelected] = useState<string | null>(null);
  /** The picked rows: the ids ticked by Cmd-click or the header checkbox, or every row of the table (Select all N). */
  const [sel, setSel] = useState<RowPick>(NO_PICK);
  const picked: "none" | "page" | "every" = sel.every ? "every" : sel.ids.size > 1 ? "page" : "none";
  const isPicked = (id: string): boolean => isPickedRow(sel, id);
  const clearPick = (): void => setSel(NO_PICK);
  const [hot, setHot] = useState<string | null>(null);
  const tapped = useRef({ id: "", at: 0 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [box, setBox] = useState({ w: 1000, h: 640 });
  const [reopen, setReopen] = useState<{ kind: "filter" | "fields" | "colour"; x: number; y: number } | null>(null);

  const cols = useMemo(() => columnsOf(def, v.hidden), [def, v.hidden]);
  const width = totalWidth(cols);
  const groupField = v.group ? def.fields.find((f) => f.key === v.group) : undefined;
  const colourField = v.colour ? def.fields.find((f) => f.key === v.colour) : undefined;
  const counts = useLive("records.counts", countSpec(type, v, def.titleField));
  const count = counts.status === "ready" ? counts.data.count : null;

  // the window of rows the screen meets, and the 200 the query is asked for
  const total0 = count ?? 0;
  const vis = rowWindow(scroll.top, Math.max(0, box.h - HEAD_H), v.group ? GROUP_LIMIT : total0);
  const offset = v.group ? 0 : queryOffset(vis.first, total0);
  const q = useLive("records.query", querySpec(type, v, def.titleField, offset));
  const kept = useRef<{ offset: number; rows: RecordRow[] } | null>(null);
  if (q.status === "ready") kept.current = { offset: v.group ? 0 : offset, rows: q.data.rows };
  const loaded = kept.current;

  const items = useMemo(() => (groupField && loaded ? groupItems(loaded.rows, groupField, folded, data.nameOf) : null), [groupField, loaded, folded, data]);
  const total = items ? items.length : count ?? loaded?.rows.length ?? 0;
  const win = rowWindow(scroll.top, Math.max(0, box.h - HEAD_H), total, FLING_OVERSCAN);
  const colWin = columnWindow(cols, scroll.left, box.w);

  const edited = isEdited(v, base);
  const set = (next: TableViewState): void => { setV(next); setSelected(null); };

  // ---- menus
  const countOf = (field: FieldDef, key: string): number | null => {
    const probe: TableViewState = { ...v, clauses: [...v.clauses.filter((c) => c.field !== field.key), { field: field.key, op: "eq", value: optionValue(field, key) }] };
    const snap = data.live("records.counts", countSpec(type, probe, def.titleField)).getSnapshot();
    return snap.status === "ready" ? snap.data.count : null;
  };
  const filterEntries = (cur: TableViewState): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const f of def.fields.filter(hasOptions)) {
      if (out.length) out.push({ separator: true });
      out.push({ head: f.title });
      for (const o of optionsOf(f)) {
        const n = countOf(f, o.key);
        out.push({ label: n === null ? o.title : `${o.title} (${n})`, checked: chosen(cur, f.key).includes(optionValue(f, o.key)), onSelect: () => set(toggleOption(cur, f.key, optionValue(f, o.key))) });
      }
    }
    if (out.length === 0) out.push({ head: "Filter" }, { label: "No fields to filter by" });
    if (cur.clauses.length > 0) out.push({ separator: true }, { label: "Clear filters", onSelect: () => set(clearClauses(cur)) });
    return out;
  };
  const sortEntries = (): MenuEntry[] => {
    const cur = v.sort[0];
    return [
      { head: "Sort by" },
      ...def.fields.filter(sortable).map((f): MenuEntry => ({ label: f.title, checked: cur?.field === f.key, onSelect: () => set(setSort(v, f.key, cur?.field === f.key && cur.dir === "asc" ? "desc" : "asc")) })),
      { separator: true },
      { label: "Ascending", checked: cur?.dir === "asc", onSelect: () => { if (cur) set(setSort(v, cur.field, "asc")); } },
      { label: "Descending", checked: cur?.dir === "desc", onSelect: () => { if (cur) set(setSort(v, cur.field, "desc")); } },
      { separator: true },
      { label: "Clear sort", onSelect: () => set({ ...v, sort: [] }) },
    ];
  };
  const groupEntries = (): MenuEntry[] => [
    { head: "Group by" },
    { label: "None", checked: v.group === null, onSelect: () => set({ ...v, group: null }) },
    ...def.fields.filter(groupable).map((f): MenuEntry => ({ label: f.title, checked: v.group === f.key, onSelect: () => set({ ...v, group: f.key }) })),
  ];
  const fieldEntries = (cur: TableViewState): MenuEntry[] => [
    { head: "Fields" },
    ...def.fields.filter((f) => f.key !== def.titleField).map((f): MenuEntry => ({ label: f.title, checked: !cur.hidden.includes(f.key), onSelect: () => set(toggleHidden(cur, f.key)) })),
  ];
  const colourEntries = (cur: TableViewState): MenuEntry[] => [
    { head: "Colour rows by" },
    { label: "None", checked: cur.colour === null, onSelect: () => set({ ...cur, colour: null }) },
    ...def.fields.filter(hasOptions).map((f): MenuEntry => ({ label: f.title, checked: cur.colour === f.key, onSelect: () => set({ ...cur, colour: f.key }) })),
  ];
  const viewEntries = (): MenuEntry[] => [
    { head: "Saved views" },
    { label: `All ${def.plural.toLowerCase()}`, checked: state.viewId === null, onSelect: () => dispatch({ type: "view", viewId: null }) },
    ...views.map((sv): MenuEntry => ({ label: sv.title, checked: state.viewId === sv.viewId, onSelect: () => dispatch({ type: "view", viewId: sv.viewId }) })),
  ];

  const keep = (kind: "filter" | "fields" | "colour") => (x: number, y: number): void => {
    const build = kind === "filter" ? filterEntries : kind === "fields" ? fieldEntries : colourEntries;
    const again = (e: MenuEntry): MenuEntry => ("onSelect" in e && e.onSelect ? { ...e, onSelect: () => { e.onSelect?.(); setReopen({ kind, x, y }); } } : e);
    menu.show(build(v).map(again), x, y);
  };
  // the menus that take several choices open again on the new view after each click
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (reopen) { const r = reopen; setReopen(null); keep(r.kind)(r.x, r.y); } }, [reopen]);

  const saveView = (): void => {
    void data.call("views.save", { type, ...(saved ? { viewId: saved.viewId } : {}), kind: "table", title: saved?.title ?? `${def.plural} view`, ...toSaved(v), idempotencyKey: `view-${type}-${Date.now()}` });
  };
  const newRecord = (): void => {
    void data.call("records.create", { type, fields: {}, idempotencyKey: `new-${type}-${Date.now()}` }).then((out) => {
      const id = (out as { record?: { id?: string } } | undefined)?.record?.id;
      if (id) data.nav.openRecord(id);
    });
  };
  const nPicked = pickCount(sel, count ?? 0);
  /** The bulk work in flight or just done: a confirm to answer, a progress line, then what was deleted with Undo. */
  const [work, setWork] = useState<{ kind: "confirm"; ids: readonly string[]; every: boolean; n: number } | { kind: "busy"; text: string } | { kind: "done"; ids: readonly string[]; failed: number } | null>(null);
  const viewFilter = filterOf(v, def.titleField);
  const deleteNow = async (ids: readonly string[], every: boolean): Promise<void> => {
    let all = ids;
    if (every) {
      setWork({ kind: "busy", text: "Finding the records…" });
      all = await allIds(data.call, { type, ...(viewFilter === undefined ? {} : { filter: viewFilter }), ...(v.sort.length ? { sort: v.sort } : {}) }, count ?? 0, (n) => setWork({ kind: "busy", text: `Finding the records… ${n.toLocaleString("en-US")}` }));
    }
    const r = await eachId(data.call, "records.delete", type, all, (done, failed) => setWork({ kind: "busy", text: `Deleting ${(done + failed).toLocaleString("en-US")} of ${all.length.toLocaleString("en-US")}…` }));
    clearPick(); setSelected(null);
    setWork({ kind: "done", ids: all, failed: r.failed });
  };
  const undoDelete = async (ids: readonly string[]): Promise<void> => {
    await eachId(data.call, "records.restore", type, ids, (done, failed) => setWork({ kind: "busy", text: `Restoring ${(done + failed).toLocaleString("en-US")} of ${ids.length.toLocaleString("en-US")}…` }));
    setWork(null);
  };
  /** What the right-click menu and the selection bar both offer. `ids` are the picked rows; `every` means the whole table. */
  const actionEntries = (ids: readonly string[], every: boolean): MenuEntry[] => {
    const n = every ? (count ?? 0) : ids.length;
    const out: MenuEntry[] = [];
    if (!every && ids.length === 1) out.push({ label: "Open", onSelect: () => data.nav.openRecord(ids[0] as string) });
    // records.query and records.export take a filter that is opaque JSON over the type's own fields: there is no "id in [...]" form in manifests/records.ts, so a hand-picked set cannot be
    // exported yet (contract request to the lead). Everything else exports the view's rows: Select all N, and a menu opened with nothing picked.
    if (every || ids.length === 0) {
      out.push({
        label: "Export as CSV",
        onSelect: () => { void data.call("records.export", { type, format: "csv", ...(viewFilter === undefined ? {} : { filter: viewFilter }), ...(v.sort.length ? { sort: v.sort.map((x) => ({ ...x })) } : {}) }); },
      });
    }
    out.push({ separator: true });
    out.push({ label: n === 1 ? "Delete" : `Delete ${n.toLocaleString("en-US")} records`, danger: true, onSelect: () => setWork({ kind: "confirm", ids, every, n }) });
    return out;
  };
  const rowMenu = (r: RecordRow, x: number, y: number): void => {
    const inPick = isPicked(r.id) && nPicked > 1;
    if (!inPick) { setSelected(r.id); clearPick(); }
    menu.show(actionEntries(inPick ? (sel.every ? [r.id] : [...sel.ids]) : [r.id], inPick && sel.every), x, y, "context", { label: inPick ? `${nPicked.toLocaleString("en-US")} selected` : "Record" });
  };

  const menuRef = useRef(rowMenu);
  menuRef.current = rowMenu;
  /** Stable, so a memoised row never re-renders because the menu closure changed. */
  const onRowMenu = useCallback((r: RecordRow, x: number, y: number): void => menuRef.current(r, x, y), []);
  const rowAt = (i: number): RecordRow | null => (loaded ? loaded.rows[i - loaded.offset] ?? null : null);
  const orderIds = useMemo(() => (items ? items.flatMap((it) => (it.g ? [] : [it.row.id])) : loaded ? loaded.rows.map((r) => r.id) : []), [items, loaded]);
  const scroller = useRef<ScrollHandle | null>(null);
  const [jump, setJump] = useState<string | null>(null);
  const goTo = (row: number): void => {
    const i = Math.max(0, Math.min(Math.max(0, total - 1), row));
    scroller.current?.to(Math.max(0, i * ROW_H - ROW_H * 2));
  };
  const move = (dir: 1 | -1): void => {
    const at = selected ? orderIds.indexOf(selected) : -1;
    const next = orderIds[Math.max(0, Math.min(orderIds.length - 1, at + dir))];
    if (next) setSelected(next);
  };
  const onKeyDown = (ev: { key?: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): void => {
    const cmd = ev.metaKey === true || ev.ctrlKey === true;
    if (cmd && ev.key === "ArrowUp") { ev.preventDefault?.(); goTo(0); const first = orderIds[0]; if (first && win.first === 0) setSelected(first); }
    else if (cmd && ev.key === "ArrowDown") { ev.preventDefault?.(); goTo(total - 1); }
    else if (cmd && (ev.key === "g" || ev.key === "G")) { ev.preventDefault?.(); setJump(""); }
    else if (ev.key === "Escape" && picked !== "none") clearPick();
    else if (ev.key === "ArrowDown") { ev.preventDefault?.(); move(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault?.(); move(-1); }
    else if ((ev.key === "Enter" || ev.key === " ") && selected) { ev.preventDefault?.(); data.nav.openRecord(selected); }
  };

  const onTap = useCallback((id: string, meta?: boolean): void => {
    setSelected(id);
    if (meta === true) { setSel((cur) => togglePick(cur, id)); return; }
    setSel((cur) => (cur.every || cur.ids.size > 0 ? NO_PICK : cur));
    const now = Date.now();
    if (tapped.current.id === id && now - tapped.current.at < 450) { tapped.current = { id: "", at: 0 }; data.nav.openRecord(id); } else tapped.current = { id, at: now };
  }, [data]);
  const onOpen = data.nav.openRecord;

  const onScroll = (pos: { top: number; left: number }): void => {
    const top = Math.floor(pos.top / (ROW_H * ROW_STEP)) * ROW_H * ROW_STEP;
    const left = Math.floor(pos.left / 40) * 40;
    setScroll((s) => (s.top === top && s.left === left ? s : { top, left }));
  };

  // ---- rows
  const rows: ReactElement[] = [];
  const frozen: ReactElement[] = [];
  const web = Platform.OS === "web";
  const primary = cols[0];
  const fw = GUTTER + (primary?.width ?? 0);
  for (let i = win.first; i < win.last; i++) {
    const y = i * ROW_H;
    if (items) {
      const it = items[i];
      if (!it) continue;
      if (it.g) {
        rows.push(
          <Pressable key={`g:${it.key}`} accessibilityRole="button" accessibilityState={{ expanded: !it.closed }} testID={`group-${it.key || "none"}`}
            onPress={() => setFolded((f) => (f.includes(it.key) ? f.filter((k) => k !== it.key) : [...f, it.key]))} style={[styles.tr, styles.group, { top: y, width }]}>
            <View style={[styles.groupIn, STICKY(12)]}>
              <View style={it.closed ? styles.chevShut : undefined}><Glyph name="chevd" size={10} /></View>
              <Text style={styles.groupText}>{it.label}</Text>
              <Text style={styles.groupCount}>{it.n}</Text>
            </View>
          </Pressable>,
        );
        continue;
      }
      const tint = colourOf(colourField, it.row);
      if (web && primary) {
        const piece = { row: it.row, n: it.n, y, selected: selected === it.row.id || isPicked(it.row.id), hot: hot === it.row.id, tint, names: data.nameOf, onTap, onOpen, onHot: setHot };
        frozen.push(<RowFrozen key={it.row.id} {...piece} primary={primary} />);
        rows.push(<RowBody key={it.row.id} {...piece} left={fw} width={width - fw} cols={cols} from={colWin.from} to={colWin.to} pad={colWin.pad} />);
      } else rows.push(<TableRow key={it.row.id} row={it.row} n={it.n} y={y} width={width} cols={cols} from={colWin.from} to={colWin.to} pad={colWin.pad} selected={selected === it.row.id || isPicked(it.row.id)} tint={tint} names={data.nameOf} onSelect={setSelected} onOpen={data.nav.openRecord} />);
      continue;
    }
    const r = rowAt(i);
    if (web && primary) {
      const piece = { row: r, n: i + 1, y, selected: r !== null && (selected === r.id || isPicked(r.id)), hot: r !== null && hot === r.id, tint: r ? colourOf(colourField, r) : null, names: data.nameOf, onTap, onOpen, onHot: setHot };
      frozen.push(<RowFrozen key={r ? r.id : `p${i}`} {...piece} primary={primary} />);
      rows.push(<RowBody key={r ? r.id : `p${i}`} {...piece} left={fw} width={width - fw} cols={cols} from={colWin.from} to={colWin.to} pad={colWin.pad} />);
      continue;
    }
    rows.push(<TableRow key={r ? r.id : `p${i}`} row={r} n={i + 1} y={y} width={width} cols={cols} from={colWin.from} to={colWin.to} pad={colWin.pad} selected={r !== null && (selected === r.id || isPicked(r.id))} tint={r ? colourOf(colourField, r) : null} names={data.nameOf} onSelect={setSelected} onOpen={data.nav.openRecord} />);
  }

  const sortKey = v.sort[0];
  const headCells: ReactElement[] = [];
  for (let i = colWin.from; i < colWin.to; i++) {
    const c = cols[i]!;
    headCells.push(<HeadCell key={c.field.key} col={c} dir={sortKey?.field === c.field.key ? sortKey.dir : null} onSort={() => set(cycleSort(v, c.field.key))} onMenu={(x, y) => colMenu(c.field, x, y)} />);
  }
  function colMenu(f: FieldDef, x: number, y: number): void {
    const entries: MenuEntry[] = [];
    if (sortable(f)) entries.push({ label: "Sort ascending", onSelect: () => set(setSort(v, f.key, "asc")) }, { label: "Sort descending", onSelect: () => set(setSort(v, f.key, "desc")) });
    if (groupable(f)) entries.push({ label: "Group by this field", onSelect: () => set({ ...v, group: f.key }) });
    if (f.key !== def.titleField) entries.push({ separator: true }, { label: "Hide field", onSelect: () => set(toggleHidden(v, f.key)) });
    menu.show(entries, x, y);
  }

  const lit = (b: boolean): boolean => b;
  return (
    <View style={styles.main} testID="records-table" accessibilityLabel={`${def.plural} table`}>
      <View style={styles.head} testID="records-head">
        <View style={styles.crumb}>
          {slim ? null : <Glyph name={typeIcon(def.icon)} size={18} color="var(--ink-2)" />}
          <Text accessibilityRole="header" aria-level={1} style={styles.h1} numberOfLines={1}>{def.plural}</Text>
          {slim ? null : <Text style={styles.slash}>/</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Saved views" testID="records-views" onPress={(e) => { const p = pointOf(e); menu.show(viewEntries(), p.x, p.y); }}
            style={({ hovered }: { hovered?: boolean }) => [styles.pick, hovered === true && styles.pickOver]}>
            <Text style={styles.pickText} numberOfLines={1}>{saved ? saved.title : `All ${def.plural.toLowerCase()}`}</Text>
            {edited ? <Text style={styles.dirty}>{"·"}</Text> : null}
            <Glyph name="chevd" size={9} />
          </Pressable>
          {edited ? (
            <View style={styles.modline} testID="records-edited">
              <Text style={styles.modText}>Edited</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Save view" testID="records-save" onPress={saveView}><Text style={styles.modLink}>Save</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Reset view" testID="records-reset" onPress={() => set(base)}><Text style={styles.modLink}>Reset</Text></Pressable>
            </View>
          ) : null}
        </View>
        <View style={styles.grow} />
        {finding ? (
          <TextInput
            value={v.find} onChangeText={(t) => set({ ...v, find: t })} placeholder={`Find in ${def.plural.toLowerCase()}`} placeholderTextColor="var(--ink-3)" accessibilityLabel="Find" testID="records-find"
            autoFocus onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") { set({ ...v, find: "" }); setFinding(false); } }} style={styles.find}
          />
        ) : <HeadButton icon="find" label="Find" bare testID="records-find-btn" onPress={() => setFinding(true)} />}
        <HeadButton icon="filter" label="Filter" detail={v.clauses.length ? String(v.clauses.length) : undefined} on={lit(v.clauses.length > 0)} bare={slim} testID="records-filter" onPress={keep("filter")} />
        <HeadButton icon="sort" label="Sort" detail={sortKey ? def.fields.find((f) => f.key === sortKey.field)?.title : undefined} on={lit(sortKey !== undefined)} bare={slim} testID="records-sort" onPress={(x, y) => menu.show(sortEntries(), x, y)} />
        <HeadButton icon="group" label="Group" detail={groupField?.title} on={lit(groupField !== undefined)} bare={slim} testID="records-group" onPress={(x, y) => menu.show(groupEntries(), x, y)} />
        <HeadButton icon="eye" label="Fields" detail={v.hidden.length ? `${v.hidden.length} hidden` : undefined} bare={slim} testID="records-fields" onPress={keep("fields")} />
        <HeadButton icon="colour" label="Colour" detail={colourField?.title} on={lit(colourField !== undefined)} bare={slim} testID="records-colour" onPress={keep("colour")} />
        {headerExtra}
        <HeadButton icon="plus" label="New" bare={slim} testID="records-new" onPress={newRecord} />
      </View>
      {online ? null : <Text style={styles.offline} accessibilityRole="alert" testID="records-offline">Offline, showing your saved copy</Text>}
      {work ? (
        <View style={styles.pickBar} accessibilityRole="alert" testID="records-work">
          {work.kind === "confirm" ? (
            <>
              <Text style={styles.pickBarText} testID="records-confirm-text">{`Delete ${recordsWord(work.n, def.title.toLowerCase(), def.plural.toLowerCase())}?`}</Text>
              <View style={styles.grow} />
              <Pressable accessibilityRole="button" testID="records-confirm-delete" onPress={() => void deleteNow(work.ids, work.every)} style={styles.pickLink}><Text style={[styles.pickLinkText, styles.pickDanger]}>Delete</Text></Pressable>
              <Pressable accessibilityRole="button" testID="records-confirm-cancel" onPress={() => setWork(null)} style={styles.pickLink}><Text style={styles.pickLinkText}>Cancel</Text></Pressable>
            </>
          ) : work.kind === "busy" ? (
            <Text style={styles.pickBarText} testID="records-work-text">{work.text}</Text>
          ) : (
            <>
              <Text style={styles.pickBarText} testID="records-work-text">{`Deleted ${recordsWord(work.ids.length - work.failed, def.title.toLowerCase(), def.plural.toLowerCase())}.${work.failed > 0 ? ` ${work.failed.toLocaleString("en-US")} could not be deleted.` : ""} They are in the Trash.`}</Text>
              <View style={styles.grow} />
              <Pressable accessibilityRole="button" testID="records-undo" onPress={() => void undoDelete(work.ids)} style={styles.pickLink}><Text style={styles.pickLinkText}>Undo</Text></Pressable>
              <Pressable accessibilityRole="button" testID="records-work-close" onPress={() => setWork(null)} style={styles.pickLink}><Text style={styles.pickLinkText}>Dismiss</Text></Pressable>
            </>
          )}
        </View>
      ) : null}
      {work === null && (picked !== "none" || sel.ids.size > 0) ? (
        <View style={styles.pickBar} accessibilityRole="toolbar" testID="records-pick-bar">
          <Text style={styles.pickBarText} testID="records-pick-text">
            {sel.every ? `All ${(count ?? 0).toLocaleString("en-US")} ${def.plural.toLowerCase()} are selected.` : `${sel.ids.size.toLocaleString("en-US")} ${sel.ids.size === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()} selected.`}
          </Text>
          {!sel.every && count !== null && count > sel.ids.size ? (
            <Pressable accessibilityRole="button" testID="records-select-every" onPress={() => setSel({ ids: new Set(), every: true })} style={styles.pickLink}><Text style={styles.pickLinkText}>{`Select all ${count.toLocaleString("en-US")}`}</Text></Pressable>
          ) : null}
          <View style={styles.grow} />
          {/* ui-rows-lint: not a list (the bulk action buttons of the selection bar) */}
          {actionEntries(sel.every ? [] : [...sel.ids], sel.every).filter((e) => "label" in e).map((e) => {
            const it = e as { label: string; onSelect?: () => void; danger?: boolean };
            const off = false;
            return (
              <Pressable key={it.label} accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off} testID={`records-pick-${it.label.split(" ")[0]!.toLowerCase()}`} onPress={() => it.onSelect?.()} style={({ hovered }: { hovered?: boolean }) => [styles.pickLink, hovered === true && styles.pickLinkOver]}>
                <Text style={[styles.pickLinkText, it.danger === true && styles.pickDanger, off && styles.pickOff]}>{it.label}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" testID="records-pick-clear" onPress={clearPick} style={styles.pickLink}><Text style={styles.pickLinkText}>Clear</Text></Pressable>
        </View>
      ) : null}
      <View style={styles.sheet} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...({ onKeyDown } as object)}>
        {count === 0 && !items?.length ? (
          <States kind="empty" title={v.clauses.length > 0 || v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet.`} icon="records" {...(v.clauses.length > 0 || v.find ? { action: { label: "Clear filters", onPress: () => set(clearClauses(v)) } } : { action: { label: `New ${def.title.toLowerCase()}`, onPress: newRecord } })} />
        ) : (
          <Scroller
            handle={scroller} width={width} height={total * ROW_H} onScroll={onScroll}
            header={(
              <View style={[styles.thr, { width }]}>
                <View style={[styles.rn, STICKY(0), styles.headBg]}><Pressable accessibilityRole="checkbox" accessibilityLabel="Select all" aria-checked={picked !== "none" || sel.ids.size > 0} accessibilityState={{ checked: picked !== "none" || sel.ids.size > 0 }} testID="records-select-all" onPress={() => setSel((cur) => toggleHeader(cur, orderIds))} style={[styles.cb, (picked !== "none" || sel.ids.size > 0) && styles.cbOn]} /></View>
                {primary ? <HeadCell col={primary} dir={sortKey?.field === primary.field.key ? sortKey.dir : null} first onSort={() => set(cycleSort(v, primary.field.key))} onMenu={(x, y) => colMenu(primary.field, x, y)} /> : null}
                {colWin.pad > 0 ? <View style={{ width: colWin.pad }} /> : null}
                {headCells}
              </View>
            )}
            footer={(
              <View style={[styles.tf, { width }]} testID="records-foot">
                <View style={[styles.rn, STICKY(0), styles.headBg]} />
                <View style={[styles.td, STICKY(GUTTER), styles.headBg, { width: primary?.width ?? 280 }]}>
                  <Text style={styles.footText} testID="records-count">{count === null ? "" : `${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text>
                  {jump === null ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Go to row" testID="records-goto" onPress={() => setJump("")} style={styles.goto}><Text style={styles.footText}>Go to row</Text></Pressable>
                  ) : (
                    <TextInput
                      value={jump} onChangeText={(t) => setJump(t.replace(/\D/g, ""))} placeholder="Row number" placeholderTextColor="var(--ink-3)" accessibilityLabel="Go to row" testID="records-goto-input" autoFocus keyboardType="number-pad"
                      onSubmitEditing={() => { if (jump) goTo(Number(jump) - 1); setJump(null); }} onBlur={() => setJump(null)}
                      onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") setJump(null); if (e.nativeEvent.key === "Enter" && jump) { goTo(Number(jump) - 1); setJump(null); } }} style={styles.gotoInput}
                    />
                  )}
                </View>
              </View>
            )}
          >
            <View style={{ height: total * ROW_H, width }} testID="records-body" accessibilityLabel={`${total} rows`}>{rows}{web ? <View testID="records-frozen" style={styles.frozenLayer}>{frozen}</View> : null}</View>
          </Scroller>
        )}
      </View>
      {menu.element}
    </View>
  );
}

function HeadCell({ col, dir, first = false, onSort, onMenu }: { col: Column; dir: "asc" | "desc" | null; first?: boolean; onSort: () => void; onMenu: (x: number, y: number) => void }): ReactElement {
  const trig = menuTrigger(onMenu);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${col.field.title}${dir ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}`} testID={`th-${col.field.key}`} onPress={onSort}
      {...trig}
      style={({ hovered }: { hovered?: boolean }) => [styles.th, first && STICKY(GUTTER), styles.headBg, { width: col.width }, isNumeric(col.field) && styles.tdNum, hovered === true && styles.thOver]}
    >
      <Text numberOfLines={1} style={styles.thText}>{col.field.title}</Text>
      {dir ? <Glyph name={dir === "asc" ? "asc" : "desc"} size={11} color="var(--ink-2)" /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${col.field.title} menu`} testID={`thm-${col.field.key}`} onPress={(e) => { const p = pointOf(e); onMenu(p.x, p.y); }} style={styles.thMore}><Glyph name="chevd" size={9} /></Pressable>
    </Pressable>
  );
}

/** The frame before data arrives: the header and rows of the real height, so nothing moves when the records land. */
export function TableLoading(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 14; i++) bars.push(<View key={i} style={styles.skRow}><View style={[styles.skBar, { width: 40 }]} /><View style={[styles.skBar, { width: `${18 + ((i * 11) % 22)}%` }]} /><View style={[styles.skBar, { width: "12%" }]} /><View style={[styles.skBar, { width: "10%" }]} /></View>);
  return (
    <View style={styles.main} testID="records-table-loading" accessibilityLabel="Loading">
      <View style={styles.head}><Text accessibilityRole="header" style={styles.h1}>Records</Text></View>
      {bars}
    </View>
  );
}

function TypeTable({ type, view, headerExtra }: { type: string; view: Partial<TableViewState> | undefined; headerExtra: ReactNode }): ReactElement {
  const { state } = useRecordsState();
  const describe = useLive("schema.describe", { type });
  const views = useScreenQuery<ViewsOut>(SCREENS.views, "views", { type });
  const list = views.status === "ready" ? views.data.views : [];
  const saved = state.viewId ? list.find((x) => x.viewId === state.viewId) : undefined;
  const def = describe.status === "ready" ? describe.data.types.find((t) => t.key === type) : undefined;
  if (!def) return <TableLoading />;
  const base: TableViewState = { ...fromSaved(saved), ...view };
  return <Grid key={`${type}:${saved?.viewId ?? ""}`} type={type} def={def} views={list} base={base} saved={saved} headerExtra={headerExtra} />;
}

export function TableView({ type, view, headerExtra }: TableViewProps): ReactElement {
  const data = useOptionalRecordsData();
  if (!data) return <TableLoading />;
  return <Open type={type} view={view} headerExtra={headerExtra} />;
}

function Open({ type, view, headerExtra }: TableViewProps): ReactElement {
  const { state } = useRecordsState();
  const types = useScreenQuery<TypesOut>(SCREENS.types, "types");
  if (types.status !== "ready") return <TableLoading />;
  const open = type ?? effectiveType(state, typeGroups(types.data.types));
  if (!open) return <States kind="empty" title="No record types yet." icon="records" />;
  return <TypeTable type={open} view={view} headerExtra={headerExtra} />;
}

const styles = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, zIndex: 10 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1, overflow: "hidden" },
  h1: { margin: 0, flexShrink: 1, minWidth: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  slash: { fontSize: 14, color: "var(--ink-4)" as string },
  pick: { height: 26, flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6 },
  pickOver: { backgroundColor: "var(--hover)" as string },
  pickText: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
  dirty: { fontSize: 16, lineHeight: 16, color: "var(--accent)" as string },
  modline: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 6 },
  modText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  modLink: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  grow: { flex: 1 },
  find: { width: 190, height: 26, paddingHorizontal: 9, borderRadius: 7, backgroundColor: "var(--sunk)" as string, fontSize: 13, color: "var(--ink)" as string },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  sheet: { flex: 1, minHeight: 0 },
  xs: { flex: 1 },
  col: { flex: 1, minHeight: 0 },
  ys: { flex: 1 },
  thr: { height: HEAD_H, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  headBg: { backgroundColor: "var(--win)" as string },
  th: { height: HEAD_H, flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 10, paddingRight: 4 },
  thOver: { backgroundColor: "var(--hover)" as string },
  thText: { flexShrink: 1, fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  thMore: { marginLeft: "auto", width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 5 },
  cbOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  goto: { marginLeft: 14, paddingHorizontal: 6, height: 22, justifyContent: "center", borderRadius: 5 },
  gotoInput: { marginLeft: 14, width: 96, height: 22, paddingHorizontal: 6, fontSize: 12, color: "var(--ink)" as string, borderRadius: 5, borderWidth: 1, borderColor: "var(--line)" as string },
  pickBar: { height: 34, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, backgroundColor: "var(--accent-wash)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  pickBarText: { fontSize: 12.5, color: "var(--ink)" as string },
  pickLink: { height: 24, justifyContent: "center", paddingHorizontal: 4 },
  pickLinkOver: { backgroundColor: "var(--hover)" as string },
  pickDanger: { color: "var(--danger)" as string },
  pickOff: { color: "var(--ink-4)" as string },
  pickLinkText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  cb: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.4, borderColor: "var(--ink-4)" as string },
  frozenLayer: { position: "sticky", left: 0, width: 0, height: 0, zIndex: 3, overflow: "visible" } as unknown as ViewStyle,
  tr: { position: "absolute", left: 0, height: ROW_H, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  rn: { width: GUTTER, height: "100%", justifyContent: "center", paddingLeft: 10, zIndex: 3 },
  rnText: { fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  td: { height: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: 10, overflow: "hidden" },
  tdFirst: { gap: 8, justifyContent: "space-between" },
  tdNum: { justifyContent: "flex-end" },
  cellText: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  title: { fontWeight: "500" },
  num: { fontVariant: ["tabular-nums"], textAlign: "right" },
  sealed: { color: "var(--ink-3)" as string, letterSpacing: 1 },
  stars: { fontSize: 12, color: "var(--warn)" as string, letterSpacing: 1 },
  person: { flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 },
  tag: { height: 20, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center", maxWidth: "100%" },
  tagText: { fontSize: 12, fontWeight: "500" },
  xopen: { width: 22, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  ghostBar: { height: 9, width: "55%", borderRadius: 5, backgroundColor: "var(--hover)" as string },
  group: { backgroundColor: "var(--sunk)" as string },
  groupIn: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  groupCount: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  chevShut: { transform: [{ rotate: "-90deg" }] },
  tf: { height: 32, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  skRow: { flexDirection: "row", alignItems: "center", gap: 18, height: ROW_H, paddingHorizontal: 18 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
