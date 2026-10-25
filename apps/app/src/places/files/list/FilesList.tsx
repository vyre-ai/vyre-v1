// Files > list (spec 3.5, 2.16): a folder, Recent, Shared with me, Trash or Knowledge as one list, Finder-grade. Click selects; Cmd-click toggles; Shift-click ranges; arrows move;
// Cmd-A selects all; Space opens Quick Look; Enter opens; Delete moves to the Trash. Drag the selection onto a folder line, or onto a folder in the tree, to move it; hold a drag over a
// folder and it opens (spring-load). Every line is a ui/Row with an icon in the leading slot and the date in the trailing slot; right-click opens the line's menu.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useFilesData, useFolderNodes, useOnline, useOptionalFilesData, useSource } from "../tree/data.tsx";
import {
  SORTS, SORT_LABEL, WHERE_LABEL, createSpring, crumbs, dragPayload, dropMoves, emptyText, fileLine, folderLine, kindLabel, parsePayload, sizeText, sortLines, sourceOf, updatedText,
} from "../tree/model.ts";
import type { Line, Spring } from "../tree/model.ts";
import { Glyph, IconButton, iconOfKind, pointOf } from "../tree/parts.tsx";
import { useFilesState } from "../tree/state.tsx";
import { QuickLook } from "./QuickLook.tsx";

const DOUBLE_MS = 450;

/** The line's menu: open, Quick Look, share and rename where they apply, and the Trash (or Restore from it). */
export function lineMenuEntries(
  lines: readonly Line[],
  inTrash: boolean,
  h: { open(l: Line): void; quickLook(l: Line): void; share(l: Line): void; rename(l: Line): void; trash(ls: readonly Line[]): void; restore(ls: readonly Line[]): void },
): MenuEntry[] {
  const one = lines.length === 1 ? lines[0] : undefined;
  const out: MenuEntry[] = [];
  if (inTrash) return [{ label: lines.length === 1 ? "Restore" : `Restore ${lines.length} Items`, onSelect: () => h.restore(lines) }];
  if (one) {
    out.push({ label: "Open", onSelect: () => h.open(one) }, { label: "Quick Look", onSelect: () => h.quickLook(one) });
    if (one.type === "folder") out.push({ label: "Share…", onSelect: () => h.share(one) });
    out.push({ label: "Rename…", onSelect: () => h.rename(one) });
    out.push({ separator: true });
  }
  out.push({ label: lines.length === 1 ? "Move to Trash" : `Move ${lines.length} Items to Trash`, danger: true, onSelect: () => h.trash(lines) });
  return out;
}

function pathOf(path: readonly { name: string }[]): string {
  let out = "";
  for (const p of path.slice(0, -1)) out += `${p.name} / `;
  return out.trimEnd();
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
  const mods = useRef({ meta: false, shift: false });
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [over, setOver] = useState<string | null>(null);
  const spring = useRef<Spring | null>(null);
  if (spring.current === null) spring.current = createSpring((id) => dispatch({ type: "go", where: { kind: "folder", id } }));
  useEffect(() => () => spring.current?.cancel(), []);

  const lines = useMemo<Line[]>(() => {
    if (src.status !== "ready") return [];
    const all: Line[] = [];
    for (const f of src.data.folders ?? []) all.push(folderLine(f));
    for (const f of src.data.files) all.push(fileLine(f));
    return sortLines(all, state.sort, state.dir);
  }, [src, state.sort, state.dir]);
  const order = useMemo(() => lines.map((l) => l.key), [lines]);
  const byKey = useMemo(() => new Map(lines.map((l) => [l.key, l] as const)), [lines]);
  const c = data.clock();
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
    if (k === "ArrowDown" || k === "ArrowUp") {
      ev.preventDefault?.();
      if (state.quickLook !== null) {
        const at = order.indexOf(state.quickLook);
        const next = order[Math.max(0, Math.min(order.length - 1, at + (k === "ArrowDown" ? 1 : -1)))];
        if (next) dispatch({ type: "quicklook", key: next });
      } else dispatch({ type: "arrow", order, dir: k === "ArrowDown" ? 1 : -1, shift: ev.shiftKey === true });
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

  const renderLine = (l: Line): ReactElement => {
    const trig = menuTrigger((x, y) => lineMenu(l, x, y));
    const dnd: Record<string, unknown> = {
      draggable: true,
      onDragStart: (e: { dataTransfer?: { setData?: (t: string, v: string) => void; effectAllowed?: string } }) => {
        e.dataTransfer?.setData?.("text/plain", dragPayload(state, l.key));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      },
      ...(l.type === "folder" ? {
        onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); setOver(l.key); spring.current?.enter(l.id); },
        onDragLeave: () => { setOver((o) => (o === l.key ? null : o)); spring.current?.leave(l.id); },
        onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); drop(l, e.dataTransfer?.getData?.("text/plain") ?? ""); },
      } : {}),
    };
    return (
      <View
        {...trig}
        {...dnd}
        {...({ onClickCapture: (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => { mods.current = { meta: e.metaKey === true || e.ctrlKey === true, shift: e.shiftKey === true }; } } as object)}
      >
        <Row
          id={`line:${l.key}`}
          title={l.name}
          note={l.type === "folder" ? `${l.items} item${l.items === 1 ? "" : "s"}` : `${kindLabel(l.kind)} · ${sizeText(l.size)}${l.source ? ` · ${l.source}` : ""}`}
          selected={state.selection.includes(l.key)}
          hovered={over === l.key}
          leading={<View style={styles.icon}><Glyph name={iconOfKind(l.kind)} size={18} color={l.type === "folder" ? "var(--accent)" : "var(--ink-3)"} /></View>}
          trailing={<Text style={styles.when}>{updatedText(l.updatedAt, c.now, c.offsetMin)}</Text>}
          onPress={() => {
            const now = Date.now();
            const dbl = last.current.key === l.key && now - last.current.at < DOUBLE_MS;
            last.current = { key: l.key, at: now };
            if (dbl) { open(l); return; }
            dispatch({ type: "click", order, key: l.key, mods: mods.current });
            mods.current = { meta: false, shift: false };
          }}
        />
      </View>
    );
  };

  const title = state.where.kind === "folder" ? (state.where.id === null ? "Files" : crumbs(nodes.status === "ready" ? nodes.data : [], state.where.id).pop()?.name ?? "Files") : WHERE_LABEL[state.where.kind];
  const path = state.where.kind === "folder" && nodes.status === "ready" ? crumbs(nodes.data, state.where.id) : [];
  const pathText = pathOf(path);
  const ql = state.quickLook !== null ? byKey.get(state.quickLook) : undefined;

  return (
    <View style={styles.main} testID="files-list" accessibilityLabel={title}>
      <View style={styles.head} testID="files-head">
        <View style={styles.tt}>
          {path.length > 1 ? <Text style={styles.path} numberOfLines={1} testID="files-path">{pathText}</Text> : null}
          <Text accessibilityRole="header" aria-level={1} style={styles.h1} numberOfLines={1}>{title}</Text>
          {src.status === "ready" ? <Text style={styles.meta} testID="files-count">{`${lines.length} item${lines.length === 1 ? "" : "s"}${state.selection.length > 0 ? `, ${state.selection.length} selected` : ""}`}</Text> : null}
        </View>
        <View style={styles.grow} />
        <IconButton icon="sort" label="Sort" testID="files-sort" onPress={(x, y) => menu.show(sortMenuEntries(state.sort, state.dir, (k) => dispatch({ type: "sort", key: k }), (d) => dispatch({ type: "dir", dir: d })), x, y)} />
      </View>
      {ql ? <QuickLook line={ql} now={c.now} offsetMin={c.offsetMin} nameOf={data.nameOf} onClose={() => dispatch({ type: "quicklook", key: null })} onOpen={() => { dispatch({ type: "quicklook", key: null }); open(ql); }} /> : null}
      {online ? null : <Text style={styles.offline} accessibilityRole="alert" testID="files-offline">Offline, showing your saved copy</Text>}
      {src.status !== "ready" ? <ListLoading bare /> : lines.length === 0 ? (
        <States kind="empty" title={emptyText(state.where)} icon="files" />
      ) : (
        <View style={styles.listBox} {...({ onKeyDown, tabIndex: 0 } as object)}>
          <VirtualList data={lines} rowHeight={44} keyOf={(l) => l.key} renderItem={renderLine} />
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
  tt: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  path: { fontSize: 13, color: "var(--ink-3)" as string, flexShrink: 1 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  listBox: { flex: 1, paddingHorizontal: 6, paddingTop: 4 },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string, marginRight: 10 },
  when: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 18 },
  skIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skSmall: { height: 8, opacity: 0.7 },
});
