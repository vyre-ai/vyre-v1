// Files toolbar (P-L9e_01b): the path as a breadcrumb you can click back through, the count, the sort button that names the current sort, and the list/grid toggle.
// Matches the prototype's Files header (.bc, .hm, .segsm). Colours are skin tokens, so a skin switch repaints with no re-render.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactElement } from "react";
import { PaneToggleButton } from "../../../../../ui/src/SidePane/index.tsx";
import { Glyph, pointOf } from "./tree/parts.tsx";
import type { ViewMode } from "./tree/model.ts";

export interface Crumb {
  /** Stable key for the test id. */
  key: string;
  name: string;
  /** The folder this crumb opens; null is the top of Files. Absent for a place that is not a folder (Recent, Trash) or the crumb you are on. */
  id?: string | null;
}

export interface ToolbarProps {
  crumbs: readonly Crumb[];
  /** "12 items, 2 selected", or null while loading. */
  count: string | null;
  sortLabel: string;
  view: ViewMode;
  onGo(id: string | null): void;
  onSort(x: number, y: number): void;
  onView(view: ViewMode): void;
  /** Back and forward through where the list has been; a missing handler greys the arrow. */
  onBack?: (() => void) | undefined;
  onForward?: (() => void) | undefined;
  /** Upload into the open folder. Absent where the place has no upload (Recent, Trash). */
  onUpload?: (() => void) | undefined;
  /** The filled New button; the menu opens under it. */
  onNew?: ((x: number, y: number) => void) | undefined;
  /** The more menu (the folder's options). */
  onMore?: ((x: number, y: number) => void) | undefined;
  /** The side pane's toggle, at the far right of the header. */
  pane?: { open: boolean; toggle(): void } | undefined;
  /** The phone: the title, New and one "..." menu (the sort, view, upload and options live in it). */
  compact?: boolean | undefined;
}

/** The crumbs of a place: Files and each folder down to this one for a folder, the place's own name for Recent, Shared with me, Trash or Knowledge. */
export function crumbTrail(folder: readonly { id: string; name: string }[] | null, title: string, placeKey: string): Crumb[] {
  if (folder === null) return [{ key: placeKey, name: title }];
  const out: Crumb[] = [{ key: "root", name: "Files", id: null }];
  for (const f of folder) out.push({ key: f.id, name: f.name, id: f.id });
  return out;
}

/** The path. Every crumb but the last opens its folder; the last is the page title. */
export function Breadcrumb({ crumbs, onGo }: { crumbs: readonly Crumb[]; onGo(id: string | null): void }): ReactElement {
  const out: ReactElement[] = [];
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    if (i > 0) out.push(<View key={`sep-${c.key}`} style={styles.sep}><Glyph name="chev" size={9} color="var(--ink-4)" width={1.5} /></View>);
    if (last) {
      out.push(<Text key={c.key} accessibilityRole="header" aria-level={1} aria-current="page" numberOfLines={1} testID="files-title" style={styles.cur}>{c.name}</Text>);
    } else {
      out.push(
        <Pressable key={c.key} accessibilityRole="link" accessibilityLabel={c.name} testID={`files-crumb-${c.key}`} onPress={() => onGo(c.id ?? null)}
          style={({ hovered }: { hovered?: boolean }) => [styles.crumb, hovered === true && styles.over]}>
          <Text numberOfLines={1} style={styles.crumbText}>{c.name}</Text>
        </Pressable>,
      );
    }
  });
  return <View style={styles.bc} testID="files-path" accessibilityLabel="Path">{out}</View>;
}

/** List or grid, one choice, as the prototype's two-button segment. */
export function ViewToggle({ view, onView }: { view: ViewMode; onView(view: ViewMode): void }): ReactElement {
  const one = (v: ViewMode, label: string): ReactElement => (
    <Pressable key={v} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: view === v }} testID={`files-view-${v}`} onPress={() => onView(v)}
      style={({ hovered }: { hovered?: boolean }) => [styles.seg, view === v ? SEG_ON : hovered === true ? HOVER : null]}>
      <Glyph name={v} size={14} color={view === v ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
  return <View accessibilityRole="radiogroup" accessibilityLabel="View" style={styles.segs} testID="files-view">{one("list", "As List")}{one("grid", "As Grid")}</View>;
}

/** The sort button: the sort icon, the name of the current sort, a chevron. It opens the sort menu under the button. */
export function SortButton({ label, onSort }: { label: string; onSort(x: number, y: number): void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Sort by ${label}`} testID="files-sort" onPress={(e) => { const p = anchorOf(e); onSort(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [styles.hm, hovered === true && styles.over]}>
      <Glyph name="sort" size={15} color="var(--ink-2)" />
      <Text style={styles.sortText} testID="files-sort-label">{label}</Text>
      <Glyph name="chevd" size={11} color="var(--ink-3)" />
    </Pressable>
  );
}

/** A quiet icon button of the header; greyed and inert without a handler. */
function HeadIcon({ icon, label, onPress, testID, flip = false }: { icon: "back" | "chev" | "upload" | "more"; label: string; onPress: ((x: number, y: number) => void) | undefined; testID: string; flip?: boolean }): ReactElement {
  const off = onPress === undefined;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }} disabled={off} testID={testID}
      onPress={(e) => { const p = anchorOf(e); onPress?.(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [styles.ib, hovered === true && !off && styles.over, off && styles.dis]}
    >
      <Glyph name={icon} size={flip ? 14 : 15} color="var(--ink-2)" width={icon === "more" ? 2.4 : 1.4} />
    </Pressable>
  );
}

/** Where a menu opened from a button goes: under the button's left edge, whether it was pressed or opened from the keyboard (rule 26). */
function anchorOf(e: unknown): { x: number; y: number } {
  const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
  if (box && Number.isFinite(box.left) && Number.isFinite(box.bottom)) return { x: box.left, y: box.bottom + 4 };
  return pointOf(e);
}

export function Toolbar({ crumbs, count, sortLabel, view, onGo, onSort, onView, onBack, onForward, onUpload, onNew, onMore, pane, compact }: ToolbarProps): ReactElement {
  if (compact === true) {
    return (
      <View style={styles.head} testID="files-head">
        <Breadcrumb crumbs={crumbs.slice(-1)} onGo={onGo} />
        <View style={styles.grow} />
        {onNew ? (
          <Pressable accessibilityRole="button" accessibilityLabel="New" accessibilityHint="Opens the New menu" testID="files-new" onPress={(e) => { const p = anchorOf(e); onNew(p.x, p.y); }}
            style={({ hovered }: { hovered?: boolean }) => [styles.pri, hovered === true && styles.priOver]}>
            <Glyph name="plus" size={13} color="var(--accent-ink)" width={1.8} />
            <Text style={styles.priText}>New</Text>
          </Pressable>
        ) : null}
        {onMore ? <HeadIcon icon="more" label="More options" testID="files-more" onPress={onMore} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.head} testID="files-head">
      <View style={styles.nav} testID="files-history">
        <HeadIcon icon="back" label="Back" testID="files-back" onPress={onBack ? () => onBack() : undefined} />
        <HeadIcon icon="chev" label="Forward" testID="files-forward" onPress={onForward ? () => onForward() : undefined} />
      </View>
      <Breadcrumb crumbs={crumbs} onGo={onGo} />
      {count !== null ? <Text style={styles.meta} testID="files-count">{count}</Text> : null}
      <View style={styles.grow} />
      <SortButton label={sortLabel} onSort={onSort} />
      <ViewToggle view={view} onView={onView} />
      {onUpload ? <HeadIcon icon="upload" label="Upload files" testID="files-upload" onPress={() => onUpload()} /> : null}
      {onNew ? (
        <Pressable accessibilityRole="button" accessibilityLabel="New" accessibilityHint="Opens the New menu" testID="files-new" onPress={(e) => { const p = anchorOf(e); onNew(p.x, p.y); }}
          style={({ hovered }: { hovered?: boolean }) => [styles.pri, hovered === true && styles.priOver]}>
          <Glyph name="plus" size={13} color="var(--accent-ink)" width={1.8} />
          <Text style={styles.priText}>New</Text>
        </Pressable>
      ) : null}
      {onMore ? <HeadIcon icon="more" label="Folder options" testID="files-more" onPress={onMore} /> : null}
      {pane ? <PaneToggleButton open={pane.open} onPress={pane.toggle} /> : null}
    </View>
  );
}

// Plain objects (not StyleSheet ids), as in ui/Row, so the painted token is visible in the element's inline style.
const SEG_ON = { backgroundColor: "var(--raised)", boxShadow: "var(--sh-1)" };
const HOVER = { backgroundColor: "var(--hover)" };

const styles = StyleSheet.create({
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  bc: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0, flexShrink: 1, overflow: "hidden" },
  crumb: { height: 26, paddingHorizontal: 6, borderRadius: 6, justifyContent: "center", flexShrink: 1 },
  crumbText: { fontSize: 13, color: "var(--ink-2)" as string },
  cur: { paddingHorizontal: 6, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string, flexShrink: 1 },
  sep: { flexShrink: 0 },
  over: { backgroundColor: "var(--hover)" as string },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 0 },
  grow: { flex: 1 },
  nav: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  ib: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dis: { opacity: 0.35 },
  pri: { height: 28, paddingHorizontal: 10, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "var(--accent)" as string, flexShrink: 0 },
  priOver: { opacity: 0.9 },
  priText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent-ink)" as string },
  hm: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7 },
  sortText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  segs: { height: 28, padding: 2, borderRadius: 8, flexDirection: "row", backgroundColor: "var(--hover)" as string },
  seg: { width: 30, borderRadius: 6, alignItems: "center", justifyContent: "center" },
});
