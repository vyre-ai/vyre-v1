import { useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { Empty, pointer } from "../shell/ui.tsx";

export interface ObjectListRow<T = unknown> {
  id: string;
  title: string;
  note?: string;
  search?: string;
  filters?: readonly string[];
  leading?: ReactNode;
  trailing?: ReactNode;
  value?: T;
  actions: readonly MenuEntry[];
}

export interface ObjectListFilter {
  id: string;
  label: string;
}

export interface ObjectListPagination {
  next?: string;
  busy: boolean;
  onMore: () => void;
}

export interface ObjectListProps<T = unknown> {
  rows: readonly ObjectListRow<T>[];
  selectedId: string | null;
  onOpen: (row: ObjectListRow<T>) => void;
  search?: { value: string; onSearch: (value: string) => void };
  filters?: readonly ObjectListFilter[];
  activeFilters?: ReadonlySet<string>;
  onFilters?: (filters: ReadonlySet<string>) => void;
  picked?: ReadonlySet<string>;
  onPicked?: (ids: ReadonlySet<string>) => void;
  bulkActions?: readonly MenuEntry[];
  pagination?: ObjectListPagination;
  empty: string;
  testID?: string;
}

export function filterObjectRows<T>(rows: readonly ObjectListRow<T>[], query: string, filters: ReadonlySet<string>): ObjectListRow<T>[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.size > 0 && ![...filters].every((filter) => row.filters?.includes(filter))) return false;
    if (!q) return true;
    return `${row.title} ${row.note ?? ""} ${row.search ?? ""}`.toLocaleLowerCase().includes(q);
  });
}

export type ObjectListKey = "ArrowUp" | "ArrowDown" | "Home" | "End";
export function moveObjectSelection<T>(rows: readonly ObjectListRow<T>[], selectedId: string | null, key: ObjectListKey): string | null {
  if (rows.length === 0) return null;
  if (key === "Home") return rows[0]?.id ?? null;
  if (key === "End") return rows[rows.length - 1]?.id ?? null;
  const at = rows.findIndex((row) => row.id === selectedId);
  if (at < 0) return rows[0]?.id ?? null;
  const next = key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
  return rows[next]?.id ?? selectedId;
}

function webProps(props: Record<string, unknown>): Record<string, unknown> { return Platform.OS === "web" ? props : {}; }

export function ObjectList<T = unknown>(props: ObjectListProps<T>): ReactElement {
  const [localSearch, setLocalSearch] = useState("");
  const menu = useMenu();
  const filterButton = useRef<unknown>(null);
  const query = props.search?.value ?? localSearch;
  const active = props.activeFilters ?? new Set<string>();
  const picked = props.picked ?? new Set<string>();
  const visible = useMemo(() => filterObjectRows(props.rows, query, active), [props.rows, query, active]);
  const setSearch = props.search?.onSearch ?? setLocalSearch;
  const togglePicked = (id: string): void => {
    if (!props.onPicked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    props.onPicked(next);
  };
  const rowMenu = (row: ObjectListRow<T>): MenuEntry[] => {
    const out: MenuEntry[] = [{ label: "Open", onSelect: () => props.onOpen(row) }];
    if (props.onPicked) out.push({ label: picked.has(row.id) ? "Remove from selection" : "Select", onSelect: () => togglePicked(row.id) });
    if (row.actions.length) out.push({ separator: true }, ...row.actions);
    return out;
  };
  const filterEntries = (): MenuEntry[] => (props.filters ?? []).map((filter) => ({
    label: filter.label,
    checked: active.has(filter.id),
    count: props.rows.filter((row) => row.filters?.includes(filter.id)).length,
    onSelect: () => {
      const next = new Set(active);
      if (next.has(filter.id)) next.delete(filter.id); else next.add(filter.id);
      props.onFilters?.(next);
    },
  }));
  const onKeyDown = (event: { key: string; preventDefault?: () => void; target?: { tagName?: string } }): void => {
    if (event.target?.tagName === "INPUT" || event.target?.tagName === "TEXTAREA") return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const id = moveObjectSelection(visible, props.selectedId, event.key as ObjectListKey);
      const row = visible.find((item) => item.id === id);
      if (row) { event.preventDefault?.(); props.onOpen(row); }
    } else if (event.key === "Enter") {
      const row = visible.find((item) => item.id === props.selectedId);
      if (row) { event.preventDefault?.(); props.onOpen(row); }
    } else if (event.key === " " && props.selectedId) {
      event.preventDefault?.(); togglePicked(props.selectedId);
    }
  };
  const filterAnchor = (): { x: number; y: number } => {
    const box = (filterButton.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    return { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 };
  };
  return <View testID={props.testID ?? "object-list"} style={styles.root} {...webProps({ onKeyDown, tabIndex: 0 })}>
    <View style={styles.toolbar}>
      <View style={styles.search}><Glyph name="search" size={14} color="var(--ink-3)" /><TextInput accessibilityLabel="Search" testID="object-list-search" value={query} onChangeText={setSearch} placeholder="Search" placeholderTextColor="var(--ink-3)" style={styles.input} /></View>
      {props.filters?.length ? <Pressable ref={(value) => { filterButton.current = value; }} accessibilityRole="button" accessibilityLabel="Filter" testID="object-list-filter" onPress={() => { const at = filterAnchor(); menu.show(filterEntries(), at.x, at.y, "other", { label: "Filter" }); }} style={[styles.iconButton, pointer, active.size > 0 && styles.on]}><Glyph name="filter" size={15} color={active.size ? "var(--accent)" : "var(--ink-2)"} /></Pressable> : null}
      <View style={{ flex: 1 }} />
      {picked.size > 0 ? <Text style={styles.selected}>{picked.size} selected</Text> : null}
      {picked.size > 0 ? props.bulkActions?.map((action) => "separator" in action ? null : "head" in action ? null : <Pressable key={action.label} accessibilityRole="button" onPress={action.onSelect} style={[styles.bulk, pointer]}><Text style={styles.bulkText}>{action.label}</Text></Pressable>) : null}
    </View>
    <View style={styles.rows}>{visible.length ? visible.map((row) => <Row key={row.id} id={`object-row-${row.id}`} title={row.title} {...(row.note === undefined ? {} : { note: row.note })} selected={row.id === props.selectedId} {...(row.leading === undefined ? {} : { leading: row.leading })} {...(row.trailing === undefined ? {} : { trailing: row.trailing })} onPress={() => props.onOpen(row)} domProps={menuTrigger((x, y) => menu.show(rowMenu(row), x, y, "context", { label: row.title }))} />) : <Empty>{props.empty}</Empty>}</View>
    {props.pagination?.next ? <Pressable accessibilityRole="button" accessibilityLabel="Load more" disabled={props.pagination.busy} onPress={props.pagination.onMore} style={[styles.more, pointer]}><Text style={styles.moreText}>{props.pagination.busy ? "Loading…" : "Load more"}</Text></Pressable> : null}
    {menu.element}
  </View>;
}

const styles = StyleSheet.create({
  root: { minHeight: 0, gap: 8 }, toolbar: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 7 }, search: { flexDirection: "row", alignItems: "center", gap: 7, width: 260, height: 32, paddingHorizontal: 10, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, backgroundColor: "var(--raised)" as string }, input: { flex: 1, color: "var(--ink)" as string, fontSize: 13, outlineStyle: "none" as never }, iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string }, on: { borderColor: "var(--accent)" as string }, selected: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] }, bulk: { height: 30, paddingHorizontal: 10, justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string }, bulkText: { fontSize: 12.5, color: "var(--ink)" as string }, rows: { padding: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string }, more: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 7 }, moreText: { color: "var(--accent)" as string, fontSize: 12.5 },
});
