// Files > list (spec 3.5, 2.16): a folder, Recent, Shared with me, Trash or Knowledge as one list, Finder-grade. Click selects; Cmd-click toggles; Shift-click ranges; arrows move;
// Cmd-A selects all; Space opens Quick Look; Enter opens; Delete moves to the Trash. Drag the selection onto a folder line, or onto a folder in the tree, to move it; hold a drag over a
// folder and it opens (spring-load). Every line is a ui/Row with an icon in the leading slot and the Modified, Made by, Size and Kind columns in the trailing slot; right-click opens the line's menu.
// P-L9e_01b: the header is the shared Toolbar (breadcrumb, sort button, list/grid toggle) in ../Toolbar.tsx, the column header and the grid tiles are in ../FileList.tsx. (Path mapping: the
// packet's FileList.tsx and Toolbar.tsx sit beside the list/ folder, and the wiring is here.)
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useFilesData, useFolderNodes, useLive, useOnline, useOptionalFilesData, useSource } from "../tree/data.tsx";
import {
  SORTS, SORT_LABEL, WHERE_LABEL, createSpring, crumbs, dragPayload, dropMoves, emptyText, fileLine, folderLine, kindLabel, parsePayload, tileLabel, sizeText, sortLines, sourceOf, updatedText,
} from "../tree/model.ts";
import type { Line, SortKey, Spring } from "../tree/model.ts";
import { iconOfKind } from "../tree/parts.tsx";
import { useFilesState } from "../tree/state.tsx";
import { ColumnHeader, GridRow, LIST_ROW, LineMarks, RowCells, ThumbTile, Tile, TypeTile, WIDE, chunk, gridKey, gridLayout } from "../FileList.tsx";
import { Toolbar, crumbTrail } from "../Toolbar.tsx";
import { DragWrap, dragAttrs, useDragDelegation } from "./DragWrap.tsx";
import type { DragHandlers, DragRegistry } from "./DragWrap.tsx";
import { StagedBanner } from "./StagedBanner.tsx";
import { QuickLook } from "./QuickLook.tsx";

const DOUBLE_MS = 450;
const lineKey = (l: Line): string => l.key;
/** The slot a line sits in: the list row is 38 px and the Row paints 28 inside it, 6 px in from each side. */
/** The phone shows a name and one secondary line: the Row with a note is 44 px, in the same 5 px slot. */
const PHONE_ROW = 54;
const PHONE_BELOW = 700;
const LINE_STYLE = { margin: "5px 6px", width: "calc(100% - 12px)" } as const;

/** The line's menu: open, Quick Look, share and rename where they apply, and the Trash (or Restore from it). */
export function lineMenuEntries(
  lines: readonly Line[],
  inTrash: boolean,
  h: { open(l: Line): void; quickLook(l: Line): void; share(l: Line): void; rename(l: Line): void; trash(ls: readonly Line[]): void; restore(ls: readonly Line[]): void; star?(l: Line): void; resolve?(l: Line): void },
): MenuEntry[] {
  const one = lines.length === 1 ? lines[0] : undefined;
  const out: MenuEntry[] = [];
  if (inTrash) return [{ label: lines.length === 1 ? "Restore" : `Restore ${lines.length} Items`, onSelect: () => h.restore(lines) }];
  if (one) {
    if (one.conflict === true && h.resolve) out.push({ label: "Resolve Conflict…", onSelect: () => h.resolve?.(one) }, { separator: true });
    out.push({ label: "Open", onSelect: () => h.open(one) }, { label: "Quick Look", onSelect: () => h.quickLook(one) });
    if (one.type === "file" && h.star) out.push({ label: one.starred === true ? "Remove Star" : "Star", onSelect: () => h.star?.(one) });
    if (one.type === "folder") out.push({ label: "Share…", onSelect: () => h.share(one) });
    out.push({ label: "Rename…", onSelect: () => h.rename(one) });
    out.push({ separator: true });
  }
  out.push({ label: lines.length === 1 ? "Move to Trash" : `Move ${lines.length} Items to Trash`, danger: true, onSelect: () => h.trash(lines) });
  return out;
}

/** The more menu: hidden files, Select All, and the Trash (it left the sidebar), with how many it holds. */
export function moreMenuEntries(h: { showHidden: boolean; trashCount: number; toggleHidden(): void; selectAll(): void; openTrash(): void }): MenuEntry[] {
  return [
    { label: "Show Hidden Files", checked: h.showHidden, onSelect: h.toggleHidden },
    { label: "Select All", onSelect: h.selectAll },
    { separator: true },
    { label: "Trash", ...(h.trashCount > 0 ? { count: h.trashCount } : {}), onSelect: h.openTrash },
  ];
}

/** The New menu: a folder, and an upload where the place has one. Each opens the shell's sheet for it. */
export function newMenuEntries(h: { newFolder(): void; upload?: (() => void) | undefined }): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "New Folder", onSelect: h.newFolder }];
  if (h.upload) out.push({ label: "Upload Files…", onSelect: h.upload });
  return out;
}

export function sortMenuEntries(sort: string, dir: "asc" | "desc", pick: (k: (typeof SORTS)[number]) => void, setDir: (d: "asc" | "desc") => void): MenuEntry[] {
  const out: MenuEntry[] = [{ head: "Sort by" }];
  for (const k of SORTS) out.push({ label: SORT_LABEL[k], checked: sort === k, onSelect: () => pick(k) });
  out.push({ separator: true }, { label: "Ascending", checked: dir === "asc", onSelect: () => setDir("asc") }, { label: "Descending", checked: dir === "desc", onSelect: () => setDir("desc") });
  return out;
}

/** The frame before data arrives: the header and rows of the real height, so nothing moves when the files land. */
export function ListLoading({ bare = false }: { bare?: boolean }): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 9; i++) bars.push(<View key={i} style={styles.skRow}><View style={styles.skIcon} /><View style={styles.skLines}><View style={[styles.skBar, { width: `${30 + ((i * 11) % 30)}%` }]} /><View style={[styles.skBar, styles.skSmall, { width: `${18 + ((i * 7) % 20)}%` }]} /></View></View>);
  if (bare) return <View testID="files-list-loading" accessibilityLabel="Loading">{bars}</View>;
  return (
    <View style={styles.main} testID="files-list-loading" accessibilityLabel="Loading">
      <View style={styles.head}><Text accessibilityRole="header" style={styles.h1}>Files</Text></View>
      {bars}
    </View>
  );
}

function List(): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const menu = useMenu();
  const online = useOnline();
  const nodes = useFolderNodes();
  const src = useSource(sourceOf(state.where));
  const treeRoots = useLive("files.tree", {});
  const trashCount = treeRoots.status === "ready" ? treeRoots.data.roots.find((r) => r.key === "trash")?.count ?? 0 : 0;
  const mods = useRef({ meta: false, shift: false });
  const registry = useRef<DragRegistry>(new Map());
  const box = useRef<View | null>(null);
  useDragDelegation(box, registry);
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [over, setOver] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const phone = useWindowDimensions().width < PHONE_BELOW;
  const spring = useRef<Spring | null>(null);
  if (spring.current === null) spring.current = createSpring((id) => dispatch({ type: "go", where: { kind: "folder", id } }));
  useEffect(() => () => spring.current?.cancel(), []);

  const lines = useMemo<Line[]>(() => {
    if (src.status !== "ready") return [];
    const all: Line[] = [];
    for (const f of src.data.folders ?? []) all.push(folderLine(f));
    for (const f of src.data.files) if (state.where.kind !== "starred" || f.starred === true) all.push(fileLine(f));
    return sortLines(state.showHidden ? all : all.filter((l) => !l.name.startsWith(".")), state.sort, state.dir, data.nameOf);
  }, [src, state.sort, state.dir, state.showHidden, state.where.kind, data]);
  const order = useMemo(() => lines.map((l) => l.key), [lines]);
  const byKey = useMemo(() => new Map(lines.map((l) => [l.key, l] as const)), [lines]);
  const c = data.clock();
  const grid = state.view === "grid";
  const wide = width === 0 || width >= WIDE; // 0 is "not measured yet" (the static page)
  const layout = gridLayout(width === 0 ? 900 : width);
  const inTrash = state.where.kind === "trash";

  const open = (l: Line): void => {
    if (l.type === "folder") dispatch({ type: "go", where: { kind: "folder", id: l.id } });
    else data.nav.openFile(l.id);
  };
  const toTrash = (ls: readonly Line[]): void => {
    for (const l of ls) void data.call(l.type === "file" ? "files.delete" : "folders.delete", l.type === "file" ? { fileId: l.id } : { folderId: l.id });
    dispatch({ type: "clear" });
  };
  const restore = (ls: readonly Line[]): void => {
    for (const l of ls) if (l.type === "file") void data.call("files.restore", { fileId: l.id });
    dispatch({ type: "clear" });
  };
  const selectedLines = (): Line[] => state.selection.map((k) => byKey.get(k)).filter((l): l is Line => l !== undefined);

  const lineMenu = (l: Line, x: number, y: number): void => {
    dispatch({ type: "context", key: l.key });
    const picked = state.selection.includes(l.key) ? selectedLines() : [l];
    menu.show(lineMenuEntries(picked, inTrash, {
      open, quickLook: (t) => dispatch({ type: "quicklook", key: t.key }), share: (t) => data.nav.shareFolder(t.id), rename: (t) => data.nav.renameEntry(t.type, t.id, t.name), trash: toTrash, restore,
      star: (t) => void data.call("files.star", { fileId: t.id, starred: t.starred !== true }),
      ...(data.nav.resolveConflict ? { resolve: (t: Line) => data.nav.resolveConflict?.(t.id) } : {}),
    }), x, y);
  };

  const drop = (target: Line, payload: string): void => {
    const here = (it: { type: "file" | "folder"; id: string }): string | null => byKey.get(`${it.type}:${it.id}`)?.folderId ?? null;
    for (const m of dropMoves(parsePayload(payload), target.id, here)) void data.call(m.cap, m.input);
    spring.current?.cancel();
    setOver(null);
    dispatch({ type: "clear" });
  };

  const onKeyDown = (ev: { key?: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): void => {
    const k = ev.key;
    if (k === "ArrowDown" || k === "ArrowUp" || (grid && (k === "ArrowRight" || k === "ArrowLeft"))) {
      ev.preventDefault?.();
      const dir = k === "ArrowDown" || k === "ArrowRight" ? 1 : -1;
      const step = grid && (k === "ArrowDown" || k === "ArrowUp") ? layout.per : 1;
      if (state.quickLook !== null) {
        const at = order.indexOf(state.quickLook);
        const next = order[Math.max(0, Math.min(order.length - 1, at + dir * step))];
        if (next) dispatch({ type: "quicklook", key: next });
      } else for (let i = 0; i < step; i++) dispatch({ type: "arrow", order, dir, shift: ev.shiftKey === true });
    } else if ((k === "a" || k === "A") && (ev.metaKey === true || ev.ctrlKey === true)) {
      ev.preventDefault?.();
      dispatch({ type: "all", order });
    } else if (k === "Escape") dispatch({ type: "clear" });
    else if (k === " ") {
      ev.preventDefault?.();
      const cur = state.selection[state.selection.length - 1];
      dispatch({ type: "quicklook", key: state.quickLook !== null ? null : cur ?? null });
    } else if (k === "Enter") {
      const cur = state.selection[state.selection.length - 1];
      const l = cur ? byKey.get(cur) : undefined;
      if (l) { ev.preventDefault?.(); open(l); }
    } else if ((k === "Delete" || k === "Backspace") && state.selection.length > 0 && !inTrash) {
      ev.preventDefault?.();
      toTrash(selectedLines());
    }
  };

  const press = (l: Line): void => {
    const now = Date.now();
    const dbl = last.current.key === l.key && now - last.current.at < DOUBLE_MS;
    last.current = { key: l.key, at: now };
    if (dbl) { open(l); return; }
    dispatch({ type: "click", order, key: l.key, mods: mods.current });
    mods.current = { meta: false, shift: false };
  };
  const handlersOf = (l: Line): DragHandlers => ({
    payload: () => dragPayload(state, l.key),
    folder: l.type === "folder",
    onMods: (m) => { mods.current = m; },
    onOver: () => { setOver(l.key); spring.current?.enter(l.id); },
    onLeave: () => { setOver((o) => (o === l.key ? null : o)); spring.current?.leave(l.id); },
    onDrop: (payload) => drop(l, payload),
  });
  const dragged = (l: Line, child: ReactElement): ReactElement => (
    <DragWrap fkey={l.key} registry={registry} props={menuTrigger((x, y) => lineMenu(l, x, y))} handlers={handlersOf(l)}>
      {child}
    </DragWrap>
  );
  const whenOf = (l: Line): string => updatedText(l.updatedAt, c.now, c.offsetMin);
  const byOf = (l: Line): string | null => (l.updatedBy === null ? null : data.nameOf(l.updatedBy));
  const sizeOfLine = (l: Line): string => (l.type === "folder" ? `${l.items} item${l.items === 1 ? "" : "s"}` : sizeText(l.size));
  const kindOfLine = (l: Line): string => `${kindLabel(l.kind)}${l.source ? ` \u00b7 ${l.source}` : ""}`;

  // on the web the line is the shared Row (one plain element) carrying the drag attributes and the menu trigger; the drag itself is delegated from the list's box
  const renderLine = (l: Line): ReactElement => {
    registry.current.set(l.key, handlersOf(l));
    const row = (
      <Row
        id={`line:${l.key}`}
        title={l.name}
        {...(l.starred === true || l.conflict === true ? { titleMarks: <LineMarks starred={l.starred === true} conflict={l.conflict === true} onResolve={data.nav.resolveConflict ? () => data.nav.resolveConflict?.(l.id) : undefined} /> } : {})}
        selected={state.selection.includes(l.key)}
        hovered={over === l.key}
        leading={l.type === "file" && l.thumb ? <ThumbTile fileId={l.id} label={tileLabel(l.name, l.kind)} icon={iconOfKind(l.kind)} /> : <TypeTile label={tileLabel(l.name, l.kind)} icon={iconOfKind(l.kind)} folder={l.type === "folder"} />}
        {...(phone ? { note: [whenOf(l), sizeOfLine(l)].filter((x) => x !== "").join(" \u00b7 ") } : { trailing: <RowCells wide={wide} cells={{ when: whenOf(l), by: byOf(l), size: sizeOfLine(l), kind: kindOfLine(l) }} /> })}
        onPress={() => press(l)}
        domProps={{ ...dragAttrs(l.key), ...menuTrigger((x, y) => lineMenu(l, x, y)), style: LINE_STYLE }}
      />
    );
    return Platform.OS === "web" ? row : dragged(l, <View style={styles.lineSlot}>{row}</View>);
  };
  const renderTile = (l: Line): ReactElement => dragged(l, (
    <Tile
      id={l.key} name={l.name} folder={l.type === "folder"} icon={iconOfKind(l.kind)} width={layout.tile}
      meta={l.type === "folder" ? sizeOfLine(l) : [whenOf(l), sizeText(l.size)].filter((x) => x !== "").join(" \u00b7 ")}
      selected={state.selection.includes(l.key)} hovered={over === l.key} onPress={() => press(l)}
    />
  ));
  const renderGridRow = (r: readonly Line[]): ReactElement => {
    const tiles: ReactElement[] = [];
    for (const l of r) tiles.push(<View key={l.key}>{renderTile(l)}</View>);
    return <GridRow>{tiles}</GridRow>;
  };
  const gridRows = useMemo(() => chunk(lines, layout.per), [lines, layout.per]);

  const title = state.where.kind === "folder" ? (state.where.id === null ? "Files" : crumbs(nodes.status === "ready" ? nodes.data : [], state.where.id).pop()?.name ?? "Files") : WHERE_LABEL[state.where.kind];
  const path = state.where.kind === "folder" && nodes.status === "ready" ? crumbs(nodes.data, state.where.id) : [];
  const trail = crumbTrail(state.where.kind === "folder" ? path : null, title, state.where.kind);
  const sortBy = (k: SortKey): void => dispatch({ type: "sort", key: k });
  const here = state.where.kind === "folder" ? state.where.id : undefined; // the open folder, null at the top of Files; undefined where the list is not a folder
  const scopeHere = (here ? (nodes.status === "ready" ? nodes.data.find((n) => n.id === here)?.scope : undefined) : undefined) ?? (here === null ? "personal" : "space");
  const upload = here !== undefined && data.nav.upload ? (): void => { data.nav.upload?.(here); } : undefined;
  const newMenu = here !== undefined
    ? (x: number, y: number): void => { menu.show(newMenuEntries({ newFolder: () => data.nav.newFolder(scopeHere, here), upload }), x, y); }
    : undefined;
  const moreMenu = (x: number, y: number): void => menu.show(moreMenuEntries({
    showHidden: state.showHidden, trashCount, toggleHidden: () => dispatch({ type: "hidden", on: !state.showHidden }), selectAll: () => dispatch({ type: "all", order }),
    openTrash: () => dispatch({ type: "go", where: { kind: "trash" } }),
  }), x, y);
  // On the phone the header keeps New and one "..." menu: sort, the list or grid view, upload, then the folder's own options.
  const phoneMenu = (x: number, y: number): void => menu.show([
    ...sortMenuEntries(state.sort, state.dir, sortBy, (d) => dispatch({ type: "dir", dir: d })),
    { separator: true },
    { label: "As List", checked: state.view === "list", onSelect: () => dispatch({ type: "view", view: "list" }) },
    { label: "As Grid", checked: state.view === "grid", onSelect: () => dispatch({ type: "view", view: "grid" }) },
    ...(upload ? [{ separator: true } as MenuEntry, { label: "Upload Files\u2026", onSelect: upload } as MenuEntry] : []),
    { separator: true },
    ...moreMenuEntries({
      showHidden: state.showHidden, trashCount, toggleHidden: () => dispatch({ type: "hidden", on: !state.showHidden }), selectAll: () => dispatch({ type: "all", order }),
      openTrash: () => dispatch({ type: "go", where: { kind: "trash" } }),
    }),
  ], x, y);
  const ql = state.quickLook !== null ? byKey.get(state.quickLook) : undefined;

  return (
    <View style={styles.main} testID="files-list" accessibilityLabel={title}>
      <Toolbar
        crumbs={trail}
        count={src.status === "ready" ? `${lines.length} item${lines.length === 1 ? "" : "s"}${state.selection.length > 0 ? `, ${state.selection.length} selected` : ""}` : null}
        sortLabel={SORT_LABEL[state.sort]}
        view={state.view}
        onGo={(id) => dispatch({ type: "go", where: { kind: "folder", id } })}
        onSort={(x, y) => menu.show(sortMenuEntries(state.sort, state.dir, (k) => dispatch({ type: "sort", key: k }), (d) => dispatch({ type: "dir", dir: d })), x, y)}
        onView={(view) => dispatch({ type: "view", view })}
        onBack={state.back.length > 0 ? () => dispatch({ type: "back" }) : undefined}
        onForward={state.forward.length > 0 ? () => dispatch({ type: "forward" }) : undefined}
        onUpload={upload}
        onNew={newMenu}
        onMore={phone ? phoneMenu : moreMenu}
        compact={phone}
        pane={data.pane ? { open: data.pane.open, toggle: data.pane.toggle } : undefined}
      />
      {here ? <StagedBanner folderId={here} /> : null}
      {ql ? <QuickLook line={ql} now={c.now} offsetMin={c.offsetMin} nameOf={data.nameOf} onClose={() => dispatch({ type: "quicklook", key: null })} onOpen={() => { dispatch({ type: "quicklook", key: null }); open(ql); }} /> : null}
      {online ? null : <Text style={styles.offline} accessibilityRole="alert" testID="files-offline">Offline, showing your saved copy</Text>}
      {src.status !== "ready" ? <ListLoading bare /> : lines.length === 0 ? (
        <States kind="empty" title={emptyText(state.where)} icon="files" />
      ) : (
        <View ref={box} style={styles.listBox} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} {...({ onKeyDown, tabIndex: 0 } as object)}>
          {grid ? (
            <VirtualList data={gridRows} rowHeight={layout.height} keyOf={gridKey} renderItem={renderGridRow} />
          ) : (
            <>
              {phone ? null : <ColumnHeader sort={state.sort} dir={state.dir} wide={wide} onSort={sortBy} />}
              <VirtualList data={lines} rowHeight={phone ? PHONE_ROW : LIST_ROW} keyOf={lineKey} renderItem={renderLine} />
            </>
          )}
        </View>
      )}
      {menu.element}
    </View>
  );
}

export function FilesList(): ReactElement {
  const data = useOptionalFilesData();
  if (!data) return <ListLoading />;
  return <List />;
}

const styles = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  lineSlot: { height: LIST_ROW, justifyContent: "center", paddingHorizontal: 6 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  listBox: { flex: 1 },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 10 },
  when: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 18 },
  skIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skSmall: { height: 8, opacity: 0.7 },
});
