// Files list parts (P-L9e_01b): the column header (Name, Modified, Made by, Size, Kind; each a sort button), the cells that go in a Row's trailing slot, and the grid (tiles in rows, so the
// grid scrolls on the same VirtualList as the list). The list itself stays in list/FilesList.tsx; this file owns what is drawn per line. Row stays the shared ui/Row (ruling 36).
import { createElement } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactElement, ReactNode } from "react";
import { Glyph } from "./tree/parts.tsx";
import type { IconName } from "./tree/parts.tsx";
import { useLive } from "./tree/data.tsx";
import type { SortKey } from "./tree/model.ts";

/** Column widths. The header and the cells use the same numbers, so they line up; the Name column takes the rest. */
export const COL = { modified: 112, by: 150, size: 84, kind: 128, gap: 12 } as const;
/** Row height of the list. Row paints 28 inside it, centred. */
export const LIST_ROW = 38;
/** Left edge of the Name column: Row padding, the icon box and its margin. Both the header and the rows start their text here. */
const NAME_LEFT = 8 + 30 + 10;
/** Below this width the Made by, Size and Kind columns hide, as the prototype does on a phone. */
export const WIDE = 720;

const HEADERS: readonly { key: SortKey; label: string; width: number | null; right?: boolean; wide?: boolean }[] = [
  { key: "name", label: "Name", width: null },
  { key: "updated", label: "Modified", width: COL.modified },
  { key: "by", label: "Made by", width: COL.by, wide: true },
  { key: "size", label: "Size", width: COL.size, right: true, wide: true },
  { key: "kind", label: "Kind", width: COL.kind, wide: true },
];

/** One column header: a button that sorts by the column, then flips; the sorted one is dark and carries an arrow. */
export function ColumnHeader({ sort, dir, wide, onSort }: { sort: SortKey; dir: "asc" | "desc"; wide: boolean; onSort(key: SortKey): void }): ReactElement {
  const cells: ReactElement[] = [];
  for (const h of HEADERS) {
    if (!wide && h.wide) continue;
    const on = sort === h.key;
    cells.push(
      <View key={h.key} style={[h.width === null ? styles.nameCol : { width: h.width, marginLeft: h.key === "updated" ? 8 : COL.gap }, h.right && styles.right]} accessibilityRole="columnheader">
        <Pressable accessibilityRole="button" accessibilityLabel={`Sort by ${h.label}`} testID={`files-col-${h.key}`} onPress={() => onSort(h.key)}
          style={({ hovered }: { hovered?: boolean }) => [styles.hbtn, hovered === true && HOVER]}>
          <Text numberOfLines={1} style={[styles.hlabel, on && SORTED]}>{h.label}</Text>
          {on ? <View testID={`files-sorted-${h.key}`} accessibilityLabel={dir === "asc" ? "Ascending" : "Descending"}><Glyph name={dir === "asc" ? "sortAsc" : "sortDesc"} size={9} color="var(--ink)" width={1.8} /></View> : null}
        </Pressable>
      </View>,
    );
  }
  return <View style={styles.headRow} testID="files-columns" accessibilityRole="row">{cells}</View>;
}

/** The person's mark: the first letter on a quiet disc (the prototype's 16 px face). */
function Face({ name }: { name: string }): ReactElement {
  return <View style={styles.face}><Text style={styles.faceText}>{name.slice(0, 1).toUpperCase()}</Text></View>;
}

export interface Cells { when: string; by: string | null; size: string; kind: string }

let cssDone = false;
/** The cells' styles, set once (a line only draws after the page is live). On the web a line is plain elements: the cells and the icon box are spans, not React Native views (P-L9e_25). */
function ensureCellCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: { getElementById(id: string): unknown; createElement(t: string): { id: string; textContent: string }; head?: { appendChild(n: unknown): void } } }).document;
  if (!d || !d.head) return;
  if (!d.getElementById("vyre-files-cells")) {
    const el = d.createElement("style");
    el.id = "vyre-files-cells";
    el.textContent = ".vfl-cs{display:flex;flex-direction:row;align-items:center;gap:" + COL.gap + "px}"
      + ".vfl-c{flex:none;white-space:nowrap;color:var(--ink-3);font-size:12.5px;font-variant-numeric:tabular-nums}.vfl-n{text-align:right}"
      + ".vfl-x{overflow:hidden;text-overflow:ellipsis}.vfl-w{flex:none;display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--ink-2);font-size:12.5px}.vfl-b{min-width:0}.vfl-b.vfl-x{flex:1}"
      + ".vfl-f{flex:none;width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--sunk);color:var(--ink-2);font-size:9px;font-weight:600}"
      + ".vfl-i{flex:none;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--sunk);margin-right:10px}"
      + ".vfl-t{flex:none;width:30px;height:30px;display:flex;align-items:center;justify-content:center;margin-right:10px}"
      + ".vfl-pg{width:22px;height:26px;border-radius:3px;border:1px solid;background:var(--win);display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px;box-sizing:border-box;overflow:hidden;font-size:6.5px;font-weight:700;line-height:1}"
      + ".vfl-th{flex:none;width:30px;height:30px;border-radius:8px;overflow:hidden;margin-right:10px;background:var(--sunk)}.vfl-th img{width:30px;height:30px;object-fit:cover;display:block}";
    d.head.appendChild(el);
  }
  cssDone = true;
}
/** A text takes the clip box and its ellipsis only when it is longer than its column holds (a little over the average glyph); the words stay whole in the page either way. */
const longer = (text: string, width: number): string => (text.length > Math.floor(width / 6.6) ? " vfl-x" : "");

/** The icon box of a line: the kind's glyph on a quiet tile. */
export function LineIcon({ icon, folder }: { icon: IconName; folder: boolean }): ReactElement {
  const glyph = Glyph({ name: icon, size: 18, color: folder ? "var(--accent)" : "var(--ink-3)" });
  if (Platform.OS !== "web") return <View style={styles.lineIcon}>{glyph}</View>;
  ensureCellCss();
  return createElement("span", { className: "vfl-i" }, glyph);
}

/** A hue per file type, so the page tiles read at a glance on every skin. */
const TILE_HUE: Readonly<Record<string, number>> = { PDF: 5, MD: 215, CSV: 145, XLSX: 145, DOCX: 215, PPTX: 25, TXT: 220, JSON: 190, ZIP: 40 };

/** The leading tile of a line: a folder or picture icon, or a small page with the file type on it (PDF, MD, CSV, DOCX), tinted by type. Sits in the shared Row's leading slot. */
export function TypeTile({ label, icon, folder }: { label: string | null; icon: IconName; folder: boolean }): ReactElement {
  if (label === null) return <LineIcon icon={icon} folder={folder} />;
  const h = TILE_HUE[label] ?? 220;
  const border = `hsla(${h}, 45%, 50%, 0.45)`, ink = `hsl(${h}, 55%, 42%)`;
  if (Platform.OS === "web") {
    ensureCellCss();
    return createElement("span", { className: "vfl-t", "data-testid": "type-tile" }, createElement("span", { className: "vfl-pg", "data-testid": "type-page", style: { borderColor: border, color: ink } }, createElement("span", { "data-testid": "type-tile-label" }, label)));
  }
  return (
    <View style={styles.typeTile} testID="type-tile">
      <View style={[styles.page, { borderColor: border as string }]} testID="type-page"><Text numberOfLines={1} style={[styles.pageText, { color: ink as string }]} testID="type-tile-label">{label}</Text></View>
    </View>
  );
}

/** A picture's own thumbnail in the leading slot: the preview the viewer shows (files.viewer_data previewUrl), 30 px, cropped to fill; the type tile until it arrives. */
export function ThumbTile({ fileId, label, icon }: { fileId: string; label: string | null; icon: IconName }): ReactElement {
  const q = useLive("files.viewer_data", { fileId });
  const url = q.status === "ready" ? q.data.previewUrl : undefined;
  if (url === undefined) return <TypeTile label={label} icon={icon} folder={false} />;
  if (Platform.OS === "web") {
    ensureCellCss();
    return createElement("span", { className: "vfl-th", "data-testid": "type-tile" }, createElement("img", { src: url, alt: "Preview", "data-testid": "thumb-image" }));
  }
  return <View style={styles.typeTile} testID="type-tile"><Image source={{ uri: url }} accessibilityLabel="Preview" testID="thumb-image" resizeMode="cover" style={styles.thumbImg} /></View>;
}

/** After the name: a star where the file is starred, and the Conflict tag where two edits wait. The tag is a button that opens the choice (prototype: "Two edits. Click to resolve."). */
export function LineMarks({ starred, conflict, onResolve }: { starred: boolean; conflict: boolean; onResolve?: (() => void) | undefined }): ReactElement | null {
  if (!starred && !conflict) return null;
  return (
    <View style={styles.marks} testID="line-marks">
      {conflict ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Conflict. Two edits. Click to resolve." testID="conflict-tag" {...(onResolve ? { onPress: onResolve } : {})}
          style={({ hovered }: { hovered?: boolean }) => [styles.warn, hovered === true && WARN_HOVER]}>
          <Text style={styles.warnText}>Conflict</Text>
        </Pressable>
      ) : null}
      {starred ? <View testID="star-mark" accessibilityLabel="Starred"><Glyph name="star" size={12} color="var(--warn)" width={1.3} /></View> : null}
    </View>
  );
}

function WebCells({ cells: c, wide }: { cells: Cells; wide: boolean }): ReactElement {
  ensureCellCss();
  const out: ReactElement[] = [createElement("span", { key: "m", className: `vfl-c${longer(c.when, COL.modified)}`, "data-testid": "cell-modified", style: { width: COL.modified } }, c.when)];
  if (wide) {
    out.push(
      createElement("span", { key: "b", className: "vfl-w", "data-testid": "cell-by", style: { width: COL.by } }, ...(c.by ? [createElement("span", { key: "f", className: "vfl-f", "aria-hidden": true }, c.by.slice(0, 1).toUpperCase()), createElement("span", { key: "n", className: `vfl-b${longer(c.by, COL.by - 23)}` }, c.by)] : [])),
      createElement("span", { key: "s", className: `vfl-c vfl-n${longer(c.size, COL.size)}`, "data-testid": "cell-size", style: { width: COL.size } }, c.size),
      createElement("span", { key: "k", className: `vfl-c${longer(c.kind, COL.kind)}`, "data-testid": "cell-kind", style: { width: COL.kind } }, c.kind),
    );
  }
  return createElement("div", { className: "vfl-cs" }, ...out);
}

/** The cells of a line, in the Row's trailing slot. */
export function RowCells({ cells, wide }: { cells: Cells; wide: boolean }): ReactElement {
  if (Platform.OS === "web") return WebCells({ cells, wide });
  return (
    <View style={styles.cells}>
      <Text numberOfLines={1} style={[styles.mut, { width: COL.modified }]} testID="cell-modified">{cells.when}</Text>
      {wide ? (
        <>
          <View style={[styles.who, { width: COL.by }]} testID="cell-by">{cells.by ? <><Face name={cells.by} /><Text numberOfLines={1} style={styles.whoText}>{cells.by}</Text></> : null}</View>
          <Text numberOfLines={1} style={[styles.mut, styles.num, { width: COL.size }]} testID="cell-size">{cells.size}</Text>
          <Text numberOfLines={1} style={[styles.mut, { width: COL.kind }]} testID="cell-kind">{cells.kind}</Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- grid

const GRID_PAD = 20;
const GRID_GAP = 12;
const TILE_MIN = 172;

/** How many tiles fit a row of this width, and how wide each is (the prototype's auto-fill, minmax(172px, 1fr)). */
export function gridLayout(width: number): { per: number; tile: number; height: number } {
  const inner = Math.max(TILE_MIN, width - GRID_PAD * 2);
  const per = Math.max(1, Math.floor((inner + GRID_GAP) / (TILE_MIN + GRID_GAP)));
  const tile = Math.floor((inner - GRID_GAP * (per - 1)) / per);
  const thumb = Math.round(((tile - 16) * 3) / 4);
  return { per, tile, height: 8 + thumb + 8 + 20 + 16 + 8 + GRID_GAP };
}

/** A grid row is keyed by its first tile: a line is in one row only. */
export function gridKey(row: readonly { key: string }[]): string {
  return row[0]?.key ?? "";
}

/** Splits lines into the rows of the grid. */
export function chunk<T>(items: readonly T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, per)) out.push(items.slice(i, i + Math.max(1, per)));
  return out;
}

export interface TileProps {
  id: string;
  name: string;
  meta: string;
  icon: IconName;
  folder: boolean;
  width: number;
  selected: boolean;
  hovered?: boolean;
  onPress(): void;
}

/** One tile of the grid: the thumbnail box with the kind's icon large, the name, and when and how big. Hover and selection paint the whole tile. */
export function Tile({ id, name, meta, icon, folder, width, selected, hovered = false, onPress }: TileProps): ReactElement {
  const thumb = Math.round(((width - 16) * 3) / 4);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected }} testID={`tile-${id}`} onPress={onPress}
      style={({ hovered: h }: { hovered?: boolean }) => [styles.tile, { width }, (hovered || h === true) && HOVER, selected && TILE_SEL]}>
      <View style={[styles.thumb, { height: thumb }]}><Glyph name={icon} size={folder ? 54 : 40} color={folder ? "var(--accent)" : "var(--ink-3)"} width={1} /></View>
      <Text numberOfLines={1} style={styles.gname}>{name}</Text>
      <Text numberOfLines={1} style={styles.gmeta}>{meta}</Text>
    </Pressable>
  );
}

/** One row of the grid: its tiles side by side. */
export function GridRow({ children }: { children: ReactNode }): ReactElement {
  return <View style={styles.gridRow}>{children}</View>;
}

// Plain objects (not StyleSheet ids), as in ui/Row, so the painted token is visible in the element's inline style.
const WARN_HOVER = { backgroundColor: "color-mix(in srgb, var(--warn) 28%, transparent)" };
const HOVER = { backgroundColor: "var(--hover)" };
const SORTED = { color: "var(--ink)" };
const TILE_SEL = { backgroundColor: "var(--accent-wash)", boxShadow: "inset 0 0 0 1.5px var(--accent-line)" };

const styles = StyleSheet.create({
  headRow: { height: 34, flexDirection: "row", alignItems: "center", paddingLeft: NAME_LEFT + 6, paddingRight: 8 + 6, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  nameCol: { flex: 1, minWidth: 0, flexDirection: "row" },
  right: { alignItems: "flex-end" },
  hbtn: { height: 24, paddingHorizontal: 4, marginLeft: -4, borderRadius: 5, flexDirection: "row", alignItems: "center", gap: 4 },
  hlabel: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  cells: { flexDirection: "row", alignItems: "center", gap: COL.gap },
  mut: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  num: { textAlign: "right" },
  who: { flexDirection: "row", alignItems: "center", gap: 7 },
  whoText: { fontSize: 12.5, color: "var(--ink-2)" as string, flexShrink: 1 },
  lineIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 10 },
  typeTile: { width: 30, minWidth: 30, height: 30, flexShrink: 0, overflow: "hidden", borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 10 },
  thumbImg: { width: 30, height: 30 },
  page: { width: 22, height: 26, borderRadius: 3, borderWidth: 1, backgroundColor: "var(--win)" as string, alignItems: "center", justifyContent: "flex-end", paddingBottom: 3, overflow: "hidden" },
  pageText: { fontSize: 6.5, fontWeight: "700", letterSpacing: 0 },
  marks: { flexDirection: "row", alignItems: "center", gap: 6 },
  warn: { height: 18, paddingHorizontal: 6, borderRadius: 5, justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--warn) 16%, transparent)" as string },
  warnText: { fontSize: 11, fontWeight: "500", color: "var(--warn)" as string },
  face: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  faceText: { fontSize: 9, fontWeight: "600", color: "var(--ink-2)" as string },
  gridRow: { flexDirection: "row", gap: GRID_GAP, paddingHorizontal: GRID_PAD, paddingTop: 0, paddingBottom: GRID_GAP },
  tile: { borderRadius: 12, padding: 8 },
  thumb: { borderRadius: 8, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", ...({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) },
  gname: { marginTop: 8, paddingHorizontal: 2, fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  gmeta: { paddingHorizontal: 2, fontSize: 11.5, color: "var(--ink-3)" as string },
});
