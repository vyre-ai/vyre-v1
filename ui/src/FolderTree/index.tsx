// ui/FolderTree: one tree for every list of things, in three sections: Personal, Shared with me, Space (spec 2.4, 4.9, ARCH 4.12).
// Folders show counts; a folder's sharing covers everything placed in it. Every folder row is a ui/Row, so hover and selection paint the whole row.
// Right-click (or the row's menu key) opens the folder menu; the menu ends with Report a problem, added by ui/Menu.
// Keyboard: Up and Down move, Right opens, Left closes, Enter selects, F2 renames, Delete removes. Drop an item on a folder to move it there.
// SlotRow puts a leading and a trailing control on top of a Row without breaking whole-row hover; ShareSheet reuses it.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { FOLDER_SECTIONS } from "./props.ts";
import type { FolderNode, FolderScope, FolderSectionId, FolderTreeProps } from "./props.ts";

export type { AccessVia, Density, FolderNode, FolderScope, FolderSectionId, FolderTreeProps } from "./props.ts";
export { FOLDER_SECTIONS, frozenFolderTreeProps } from "./props.ts";

/* ---------- tree logic ---------- */

export interface VisibleFolder {
  node: FolderNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

export interface VisibleSection {
  id: FolderSectionId;
  label: string;
  rows: VisibleFolder[];
  /** Folders in the section, open or not. */
  total: number;
}

/** Sections in the fixed order. Children follow their parent; a closed folder hides its children. A node whose parent is not in the list is a root. */
export function visibleSections(nodes: readonly FolderNode[], openOverride: Readonly<Record<string, boolean>> = {}): VisibleSection[] {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string | null, FolderNode[]>();
  for (const n of nodes) {
    const parent = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
    const list = kids.get(parent) ?? [];
    list.push(n);
    kids.set(parent, list);
  }
  const isOpen = (n: FolderNode): boolean => openOverride[n.id] ?? n.open;
  const out: VisibleSection[] = [];
  for (const section of FOLDER_SECTIONS) {
    const rows: VisibleFolder[] = [];
    const walk = (parent: string | null, depth: number): void => {
      for (const n of kids.get(parent) ?? []) {
        if (n.section !== section.id) continue;
        const childCount = (kids.get(n.id) ?? []).length;
        const open = isOpen(n);
        rows.push({ node: n, depth, hasChildren: childCount > 0, open });
        if (open && childCount > 0) walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    // A child that sits in a different section than its parent is still shown, at the top of its own section.
    for (const n of nodes) {
      if (n.section !== section.id || rows.some((r) => r.node.id === n.id)) continue;
      const parent = n.parentId !== null && ids.has(n.parentId) ? nodes.find((p) => p.id === n.parentId) : undefined;
      if (parent !== undefined && parent.section === section.id) continue;
      const childCount = (kids.get(n.id) ?? []).length;
      rows.push({ node: n, depth: 0, hasChildren: childCount > 0, open: isOpen(n) });
    }
    out.push({ id: section.id, label: section.label, rows, total: nodes.filter((n) => n.section === section.id).length });
  }
  return out;
}

export type TreeKey = "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" | "Home" | "End";

/** The folder the cursor lands on for a key, and whether a folder opens or closes. */
export function moveCursor(rows: readonly VisibleFolder[], from: string | null, key: TreeKey): { id: string | null; open?: boolean } {
  if (rows.length === 0) return { id: null };
  const at = rows.findIndex((r) => r.node.id === from);
  const cur = at < 0 ? undefined : rows[at];
  if (key === "Home") return { id: rows[0]?.node.id ?? null };
  if (key === "End") return { id: rows[rows.length - 1]?.node.id ?? null };
  if (key === "ArrowDown") return { id: rows[at < 0 ? 0 : Math.min(rows.length - 1, at + 1)]?.node.id ?? null };
  if (key === "ArrowUp") return { id: rows[at < 0 ? 0 : Math.max(0, at - 1)]?.node.id ?? null };
  if (cur === undefined) return { id: rows[0]?.node.id ?? null };
  if (key === "ArrowRight") {
    if (cur.hasChildren && !cur.open) return { id: cur.node.id, open: true };
    const next = rows[at + 1];
    return { id: next !== undefined && next.depth > cur.depth ? next.node.id : cur.node.id };
  }
  if (cur.hasChildren && cur.open) return { id: cur.node.id, open: false };
  for (let i = at - 1; i >= 0; i--) {
    const r = rows[i];
    if (r !== undefined && r.depth < cur.depth) return { id: r.node.id };
  }
  return { id: cur.node.id };
}

export interface FolderHandlers {
  onSelect?: (id: string) => void;
  onToggle?: (id: string, open: boolean) => void;
  onNewFolder?: (scope: FolderScope, parentId: string | null) => void;
  onShare?: (node: FolderNode) => void;
  onRename?: (node: FolderNode) => void;
  onMove?: (node: FolderNode) => void;
  onDelete?: (node: FolderNode) => void;
  /** An item was dropped on a folder (or on a section head: folderId null). */
  onDropItem?: (itemId: string, folderId: string | null, scope: FolderScope) => void;
}

/** You can rename, move and delete folders you own or that live in the Space. Shared folders can be shared on or opened. */
export function canManageFolder(node: FolderNode): boolean {
  return node.via === "owner" || node.via === "space";
}

/** The folder menu. Items you cannot use are left out, so icons stay all or none. ui/Menu appends Report a problem. */
export function folderMenu(node: FolderNode, open: boolean, hasChildren: boolean, h: FolderHandlers): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (hasChildren) items.push({ label: open ? "Close" : "Open", icon: "open", ...(h.onToggle === undefined ? {} : { onSelect: () => h.onToggle?.(node.id, !open) }) });
  if (canManageFolder(node)) items.push({ label: "New Folder…", icon: "plus", onSelect: () => h.onNewFolder?.(node.scope, node.id) });
  if (items.length > 0) items.push({ separator: true });
  items.push({ label: "Share…", icon: "link", onSelect: () => h.onShare?.(node) });
  if (canManageFolder(node)) {
    items.push({ label: "Rename…", icon: "edit", onSelect: () => h.onRename?.(node) });
    items.push({ label: "Move…", icon: "pane", onSelect: () => h.onMove?.(node) });
    items.push({ separator: true });
    items.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => h.onDelete?.(node) });
  }
  return items;
}

/* ---------- SlotRow: a Row with a leading and a trailing control ---------- */

/** Leading figure spaces that push the Row's title past a leading control of this width. */
export function indentFor(px: number): string {
  return " ".repeat(Math.max(0, Math.ceil(px / 7.5)));
}

export interface SlotRowProps {
  id: string;
  title: string;
  note?: string;
  selected?: boolean;
  /** Painted like a hover (a keyboard cursor). */
  cursor?: boolean;
  /** Width of the leading slot in px. The title is indented past it. */
  leadWidth?: number;
  lead?: ReactNode;
  trail?: ReactNode;
  /** Drop highlight. */
  over?: boolean;
  onPress?: () => void;
  onMenu?: (x: number, y: number) => void;
  /** Extra DOM handlers (web): drag and drop. */
  dom?: Record<string, unknown>;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const OVER = { backgroundColor: "var(--accent-wash)" };

/** The whole wrapper tracks hover, so the highlight stays on while the pointer is over the trailing controls. */
export function SlotRow(props: SlotRowProps): ReactElement {
  const [hover, setHover] = useState(false);
  const note = props.note;
  const height = note ? 44 : 28;
  const menu = props.onMenu === undefined ? {} : menuTrigger(props.onMenu);
  return (
    <View
      style={[styles.slot, { height }, props.over === true && OVER]}
      {...menu}
      {...webProps({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), ...(props.dom ?? {}) })}
    >
      <Row
        id={props.id}
        title={`${indentFor(props.leadWidth ?? 0)}${props.title}`}
        {...(note === undefined ? {} : { note: `${indentFor(props.leadWidth ?? 0)}${note}` })}
        selected={props.selected === true}
        hovered={hover || props.cursor === true}
        {...(props.onPress === undefined ? {} : { onPress: props.onPress })}
      />
      {props.lead ? <View pointerEvents="box-none" style={styles.lead}>{props.lead}</View> : null}
      {props.trail ? <View pointerEvents="box-none" style={styles.trail}>{props.trail}</View> : null}
    </View>
  );
}

/* ---------- component ---------- */

export interface FolderTreeViewProps extends FolderTreeProps, FolderHandlers {
  testID?: string;
}

const CHEVRON = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.500l4.500 4.500L6 12.500"/></svg>';

function Chevron({ open }: { open: boolean }): ReactElement {
  if (Platform.OS !== "web") return <Text style={styles.nativeChevron}>{open ? "▾" : "▸"}</Text>;
  return createElement("span", { style: { display: "inline-flex", color: "var(--ink-4)", transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms" }, dangerouslySetInnerHTML: { __html: CHEVRON } });
}

const DEPTH_PX = 14;
const CHEVRON_PX = 18;
const ICON_PX = 16;
/** Chevron, a gap, the folder icon, a gap: the title starts after this much. */
const LEAD_PX = CHEVRON_PX + 5 + ICON_PX + 7;
const FOLDER = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1z"/></svg>';

function FolderIcon(): ReactElement {
  if (Platform.OS !== "web") return <Text style={styles.nativeChevron}>{"\u25a4"}</Text>;
  return createElement("span", { style: { display: "inline-flex", color: "var(--ink-3)" }, dangerouslySetInnerHTML: { __html: FOLDER } });
}

export function FolderTree(props: FolderTreeViewProps): ReactElement {
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const menu = useMenu();
  const compact = props.density === "compact";
  const sections = useMemo(() => visibleSections(props.nodes, openOverride), [props.nodes, openOverride]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const toggle = (id: string, open: boolean): void => {
    setOpenOverride((o) => ({ ...o, [id]: open }));
    props.onToggle?.(id, open);
  };
  const handlers: FolderHandlers = { ...props, onToggle: toggle };

  const onKeyDown = (event: { key: string; preventDefault?: () => void }): void => {
    const k = event.key;
    if (k === "ArrowDown" || k === "ArrowUp" || k === "ArrowRight" || k === "ArrowLeft" || k === "Home" || k === "End") {
      event.preventDefault?.();
      const step = moveCursor(flat, cursor ?? props.selectedId, k);
      if (step.id !== null) setCursor(step.id);
      if (step.id !== null && step.open !== undefined) toggle(step.id, step.open);
      return;
    }
    const at = flat.find((r) => r.node.id === (cursor ?? props.selectedId));
    if (at === undefined) return;
    if (k === "Enter") {
      event.preventDefault?.();
      props.onSelect?.(at.node.id);
    } else if (k === "F2" && canManageFolder(at.node)) {
      event.preventDefault?.();
      props.onRename?.(at.node);
    } else if ((k === "Delete" || k === "Backspace") && canManageFolder(at.node)) {
      event.preventDefault?.();
      props.onDelete?.(at.node);
    }
  };

  const dropProps = (folderId: string | null, scope: FolderScope, key: string): Record<string, unknown> => ({
    onDragOver: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => {
      e.preventDefault();
      setOver(null);
      const item = e.dataTransfer?.getData?.("text/plain") ?? "";
      if (item.length > 0) props.onDropItem?.(item, folderId, scope);
    },
  });

  const parts: ReactElement[] = [];
  for (const section of sections) {
    const scope: FolderScope = section.id === "space" ? "space" : "personal";
    const mayCreate = section.id !== "shared";
    const rowNodes: ReactElement[] = [];
    const closed = shut[section.id] === true;
    for (const r of closed ? [] : section.rows) {
      const n = r.node;
      const lead = (
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: r.depth * DEPTH_PX }}>
          {r.hasChildren ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${r.open ? "Close" : "Open"} ${n.name}`} onPress={() => toggle(n.id, !r.open)} testID={`folder-toggle-${n.id}`} style={({ hovered }: { hovered?: boolean }) => [styles.chev, hovered === true && styles.chevHover]}>
              <Chevron open={r.open} />
            </Pressable>
          ) : <View style={styles.chev} />}
          <View style={styles.folderIcon}><FolderIcon /></View>
        </View>
      );
      const trail = <Text style={styles.count} testID={`folder-count-${n.id}`}>{n.count}</Text>;
      rowNodes.push(
        <SlotRow
          key={n.id}
          id={`folder-${n.id}`}
          title={n.name}
          selected={n.id === props.selectedId}
          cursor={n.id === cursor}
          over={over === n.id}
          leadWidth={r.depth * DEPTH_PX + LEAD_PX}
          lead={lead}
          trail={trail}
          onPress={() => {
            setCursor(n.id);
            props.onSelect?.(n.id);
          }}
          onMenu={(x, y) => menu.show(folderMenu(n, r.open, r.hasChildren, handlers), x, y, "context", { label: `Folder ${n.name}` })}
          dom={dropProps(n.id, n.scope, n.id)}
        />,
      );
    }
    parts.push(
      <View key={section.id} testID={`folders-${section.id}`} accessibilityRole="list" accessibilityLabel={section.label} {...webProps({ ...dropProps(null, scope, `sec:${section.id}`) })} style={[styles.section, over === `sec:${section.id}` && OVER]}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${closed ? "Show" : "Hide"} ${section.label}`}
            accessibilityState={{ expanded: !closed }}
            onPress={() => setShut((o) => ({ ...o, [section.id]: !closed }))}
            testID={`folders-head-${section.id}`}
            style={({ hovered }: { hovered?: boolean }) => [styles.headButton, hovered === true && styles.addHover]}
          >
            <Chevron open={!closed} />
            <Text accessibilityRole="header" style={styles.headText}>{section.label}</Text>
            <Text style={styles.headCount}>{section.total}</Text>
          </Pressable>
          <View style={styles.grow} />
          {mayCreate ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`New folder in ${section.label}`} onPress={() => props.onNewFolder?.(scope, null)} testID={`folders-new-${section.id}`} {...webProps({ title: "New Folder" })} style={({ hovered }: { hovered?: boolean }) => [styles.add, hovered === true && styles.addHover]}>
              <Text style={styles.addText}>+</Text>
            </Pressable>
          ) : null}
        </View>
        {rowNodes}
        {rowNodes.length === 0 && !closed ? <Text style={styles.none}>{section.id === "shared" ? "Nothing shared with you yet" : "No folders yet"}</Text> : null}
      </View>,
    );
  }

  return (
    <View
      testID={props.testID ?? `folders-${props.resourceType}`}
      accessibilityLabel={`${props.resourceType} folders`}
      style={[styles.root, compact && styles.rootCompact]}
      {...webProps({ tabIndex: 0, onKeyDown })}
    >
      {parts}
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", paddingHorizontal: 6, gap: 8 },
  rootCompact: { paddingHorizontal: 4 },
  section: { width: "100%", borderRadius: 8 },
  head: { flexDirection: "row", alignItems: "center", height: 26, paddingHorizontal: 4 },
  headButton: { flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingHorizontal: 4, borderRadius: 5 },
  headText: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "600", lineHeight: 22 },
  headCount: { color: "var(--ink-4)" as string, fontSize: 12, lineHeight: 22 },
  grow: { flex: 1 },
  add: { width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  addHover: { backgroundColor: "var(--hover)" as string },
  addText: { color: "var(--ink-3)" as string, fontSize: 15, lineHeight: 17 },
  none: { color: "var(--ink-4)" as string, fontSize: 12, lineHeight: 28, paddingHorizontal: 8 },
  folderIcon: { width: ICON_PX, marginLeft: 5, height: 22, alignItems: "center", justifyContent: "center" },
  chev: { width: CHEVRON_PX, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 5 },
  chevHover: { backgroundColor: "var(--press)" as string },
  nativeChevron: { color: "var(--ink-4)" as string, fontSize: 10 },
  count: { color: "var(--ink-4)" as string, fontSize: 11.5, paddingRight: 8, fontVariant: ["tabular-nums"] },
  slot: { position: "relative", width: "100%", borderRadius: 6 },
  lead: { position: "absolute", left: 8, top: 0, bottom: 0, justifyContent: "center" },
  trail: { position: "absolute", right: 0, top: 0, bottom: 0, justifyContent: "center", flexDirection: "row", alignItems: "center" },
});
