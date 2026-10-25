// The Vault place (spec 3.8, 2.17, ARCH 7.8): Apple Passwords layout. A sidebar of sections and folders, a calm list of items (names and field names, never values), and the selected item
// as the hero on the right, drawn as a .env block with reveal on request. One Add understands what you paste. Nothing opens as a page, so you never lose your place.
// The shell provides the data (replica hooks, calls, navigation) through VaultDataProvider; without it the place draws its loading frame, the size of the real one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { AddAnything, EditSheet, ItemEnv, NoItem } from "../itemenv/index.ts";
import { VaultDataProvider, copyText, useOnline, useOptionalVaultData, useScreenQuery, useVaultData } from "./data.tsx";
import type { VaultData } from "./data.tsx";
import { ItemList } from "./ItemList.tsx";
import { ALL, countItems, sameSelection, visibleItems } from "./model.ts";
import type { Folder, Health, Item, Provider, Selection } from "./model.ts";
import { Glyph, IconBtn, QuietLine } from "./parts.tsx";
import { Sidebar } from "./Sidebar.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";

export { VaultDataProvider } from "./data.tsx";
export type { VaultData, VaultNav } from "./data.tsx";

export const LAYOUT_SCREEN = "vault.layout";
type ItemsOut = CapMap["vault.items.list"]["out"];
type FoldersOut = CapMap["vault.folders.list"]["out"];
type ProvidersOut = CapMap["providers.list"]["out"];
type RequestsOut = CapMap["vault.requests.list"]["out"];

export const WIDE = 900;
export const TWO_PANE = 720;

const TITLES: Record<Exclude<Selection["kind"], "folder">, string> = { all: "All", providers: "AI providers", keys: "Keys", logins: "Logins", cards: "Cards", health: "Health", requested: "Requested", mine: "Mine" };

function titleOf(sel: Selection, folders: readonly Folder[]): string {
  return sel.kind === "folder" ? (folders.find((f) => f.id === sel.folderId)?.name ?? "Folder") : TITLES[sel.kind];
}

interface QuietNote { id: number; text: string; undo: (() => Promise<void> | void) | undefined }
const LINE_MS = 9000;

function Page({ initial, sheet, view }: { initial?: Selection | undefined; sheet?: InitialSheet | undefined; view?: "env" | "fields" | undefined }): ReactElement {
  const data = useVaultData();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const twoPane = width >= TWO_PANE;
  const items = useScreenQuery<ItemsOut>(LAYOUT_SCREEN, "items", {});
  const folders = useScreenQuery<FoldersOut>(LAYOUT_SCREEN, "folders", {});
  const providers = useScreenQuery<ProvidersOut>(LAYOUT_SCREEN, "providers", {});
  const health = useScreenQuery<Health>("vault.health", "health", {});
  const requests = useScreenQuery<RequestsOut>("vault_requests.list", "requests", { state: "waiting" });
  const menu = useMenu();
  const [selection, setSelection] = useState<Selection>(initial ?? ALL);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [adding, setAdding] = useState<{ paste?: string; app?: string } | null>(sheet?.add ?? null);
  const [editing, setEditing] = useState<string | null>(sheet?.edit ?? null);
  const [addField, setAddField] = useState(false);
  const [lastFolder, setLastFolder] = useState<string | undefined>(undefined);
  const [askDelete, setAskDelete] = useState(0);
  const [note, setNote] = useState<QuietNote | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<{ focus?: () => void } | null>(null);

  const all: readonly Item[] = items.status === "ready" ? items.data.items : EMPTY_ITEMS;
  const folderList: readonly Folder[] = folders.status === "ready" ? folders.data.folders : EMPTY_FOLDERS;
  const providerList: readonly Provider[] = providers.status === "ready" ? providers.data.providers : EMPTY_PROVIDERS;
  const providerOf = useMemo(() => new Map(providerList.map((p) => [p.itemId, p] as const)), [providerList]);
  const providerIds = useMemo(() => new Set(providerOf.keys()), [providerOf]);
  const healthIds = useMemo(() => new Set(health.status === "ready" ? health.data.items.map((i) => i.itemId) : []), [health]);
  const requested = requests.status === "ready" ? requests.data.requests.length : 0;
  const counts = useMemo(() => countItems(all, providerIds, health.status === "ready" ? health.data : null, requested), [all, providerIds, health, requested]);
  const visible = useMemo(() => visibleItems(all, selection, query, providerIds, healthIds), [all, selection, query, providerIds, healthIds]);
  const clock = data.clock();

  const showNote = useCallback((text: string, undo?: () => Promise<void> | void) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setNote({ id, text, undo });
    timer.current = setTimeout(() => setNote((cur) => (cur && cur.id === id ? null : cur)), LINE_MS);
  }, []);
  const undoNote = useCallback(() => { const cur = note; if (!cur) return; if (timer.current) clearTimeout(timer.current); setNote(null); void cur.undo?.(); }, [note]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // on a wide window the first row is open, as in the prototype; on a phone nothing is open until a row is chosen
  const effectiveId = selectedId && visible.some((i) => i.id === selectedId) ? selectedId : twoPane ? (visible[0]?.id ?? null) : null;
  const showDetail = twoPane || (detailOpen && effectiveId !== null);

  const select = useCallback((s: Selection) => {
    if (s.kind === "requested") { data.nav.openRequests(); return; }
    setSelection(s); setSelectedId(null); setDetailOpen(false);
  }, [data.nav]);
  const open = useCallback((id: string) => { setSelectedId(id); setDetailOpen(true); }, []);

  const moveSelection = useCallback((dir: 1 | -1) => {
    if (visible.length === 0) return;
    const cur = visible.findIndex((i) => i.id === effectiveId);
    const next = cur < 0 ? (dir === 1 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, cur + dir));
    setSelectedId(visible[next]!.id);
  }, [visible, effectiveId]);

  const overlay = adding !== null || editing !== null;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      if (overlay) return;
      const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable === true;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); setAdding({}); return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); searchRef.current?.focus?.(); return; }
      if (typing) { if (e.key === "Escape" && query) setQuery(""); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus?.(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
      else if (e.key === "Enter" && effectiveId) { e.preventDefault(); setEditing(effectiveId); }
      else if ((e.key === "Delete" || e.key === "Backspace") && effectiveId) { e.preventDefault(); setAskDelete((n) => n + 1); if (!twoPane) setDetailOpen(true); }
      else if (e.key === "Escape") { if (detailOpen && !twoPane) setDetailOpen(false); else if (query) setQuery(""); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [overlay, moveSelection, effectiveId, query, detailOpen, twoPane]);

  const createFolder = useCallback(async (name: string) => { await data.call("vault.folders.create", { name, scope: "shared" }); showNote(`Made the folder ${name}`); }, [data, showNote]);

  const sectionEntries = (): MenuEntry[] => {
    const entry = (s: Selection, label: string, n?: number): MenuEntry => ({ label: n === undefined ? label : `${label}  ${n}`, checked: sameSelection(s, selection), onSelect: () => select(s) });
    return [
      ...(counts.requested > 0 ? [entry({ kind: "requested" }, "Requested", counts.requested)] : []),
      entry({ kind: "all" }, "All", counts.all), entry({ kind: "providers" }, "AI providers", counts.providers), entry({ kind: "keys" }, "Keys", counts.keys),
      entry({ kind: "logins" }, "Logins", counts.logins), entry({ kind: "cards" }, "Cards", counts.cards), ...(counts.health > 0 ? [entry({ kind: "health" }, "Health", counts.health)] : []),
      { separator: true },
      ...folderList.filter((f) => f.scope === "shared").map((f): MenuEntry => entry({ kind: "folder", folderId: f.id }, f.name, counts.folders.get(f.id) ?? f.itemCount)),
      entry({ kind: "mine" }, "Mine", counts.mine),
    ];
  };

  const itemMenu = (item: Item, x: number, y: number): void => {
    setSelectedId(item.id);
    const others = folderList.filter((f) => f.id !== item.folderId && (f.yourLevel === "edit" || f.yourLevel === "manage") && f.scope === "shared");
    const canEdit = item.yourLevel === "edit" || item.yourLevel === "manage";
    const entries: MenuEntry[] = [
      ...(canEdit ? [{ label: "Edit…", onSelect: () => setEditing(item.id) }] : [{ label: "Open", onSelect: () => open(item.id) }]),
      { label: "Copy handle", onSelect: () => { void copyHandle(data, item.handle); } },
      ...(canEdit ? [{ separator: true } as MenuEntry, { label: "Mark as rotated", onSelect: () => { void data.call("vault.item.mark_rotated", { itemId: item.id }).then(() => showNote(`Marked ${item.name} rotated`)); } }] : []),
      ...(item.yourLevel === "manage" && others.length ? [{ separator: true } as MenuEntry, { head: "Move to" } as MenuEntry, ...others.map((f): MenuEntry => ({ label: f.name, onSelect: () => { const from = item.folderId; void data.call("vault.item.move", { itemId: item.id, folderId: f.id }).then(() => showNote(`Moved ${item.name} to ${f.name}`, async () => { await data.call("vault.item.move", { itemId: item.id, folderId: from }); })); } }))] : []),
      ...(item.yourLevel === "manage" ? [{ separator: true } as MenuEntry, { label: "Move to Trash", danger: true, onSelect: () => { open(item.id); setAskDelete((n) => n + 1); } } as MenuEntry] : []),
    ];
    menu.show(entries, x, y);
  };

  const folderMenu = (f: Folder, x: number, y: number): void => {
    menu.show([
      ...(f.yourLevel === "edit" || f.yourLevel === "manage" ? [{ label: "Add an item here", onSelect: () => { setLastFolder(f.id); setAdding({}); } } as MenuEntry] : []),
      ...(f.yourLevel === "manage" ? [{ label: "Export .env…", onSelect: () => data.nav.openExport(f.id) } as MenuEntry] : []),
    ], x, y);
  };

  const loading = items.status !== "ready";
  const title = titleOf(selection, folderList);
  const header = (
    <View style={s.listHead}>
      {wide ? (
        <Text accessibilityRole="header" style={s.listTitle} testID="list-title">{title}<Text style={s.listCount}>{`  ${visible.length}`}</Text></Text>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Section: ${title}`} testID="section-menu" onPress={(e) => { const r = rectOf(e); menu.show(sectionEntries(), r.x, r.y, "other"); }} style={s.titleBtn}>
          <Text accessibilityRole="header" style={s.listTitle} testID="list-title">{title}<Text style={s.listCount}>{`  ${visible.length}`}</Text></Text>
          <Glyph name="chevron" size={12} />
        </Pressable>
      )}
      <View style={{ flex: 1 }} />
      <IconBtn icon="plus" label="Add an item" onPress={() => setAdding({})} testID="add-item" color="var(--ink-2)" />
    </View>
  );

  const listPane = (
    <View style={[s.listPane, twoPane ? s.listPaneTwo : { flex: 1 }]} testID="vault-list-pane">
      {header}
      <View style={s.searchWrap}>
        <View style={s.search}>
          <Glyph name="search" size={14} />
          <TextInput ref={(r) => { searchRef.current = r as unknown as { focus?: () => void } | null; }} value={query} onChangeText={setQuery} placeholder="Search" accessibilityLabel="Search the Vault" style={s.searchInput} testID="vault-search" />
          <Text style={s.kbd}>⌘F</Text>
        </View>
      </View>
      {loading ? <ListSkeleton /> : visible.length === 0 ? (
        <View style={s.empty} testID="vault-empty">
          {all.length === 0
            ? <States kind="empty" title="Your vault is empty" icon="files" action={{ label: "Add an item", onPress: () => setAdding({}) }} />
            : <States kind="empty" title={query ? `Nothing matches ${query}` : selection.kind === "health" ? "Nothing needs attention" : "Nothing here yet"} icon="search" />}
        </View>
      ) : (
        <ItemList items={visible} selectedId={effectiveId} providerOf={providerOf} healthIds={healthIds} clock={clock} onSelect={(id) => { setSelectedId(id); if (!twoPane) setDetailOpen(true); }} onOpen={(id) => { setSelectedId(id); setEditing(id); }} onMenu={itemMenu} />
      )}
      <View style={s.lineSlot}>{note ? <QuietLine text={note.text} onUndo={note.undo ? undoNote : undefined} testID="vault-line" /> : null}</View>
      {!online ? <Text style={s.offline} testID="vault-offline">Offline, showing your saved copy</Text> : null}
    </View>
  );

  const detail = effectiveId ? (
    <ItemEnv key={effectiveId} itemId={effectiveId} askDelete={askDelete} initialMode={view} onEdit={() => { setAddField(false); setEditing(effectiveId); }} onAddField={() => { setAddField(true); setEditing(effectiveId); }} onGone={() => { setSelectedId(null); setDetailOpen(false); }} onNote={showNote} onBack={twoPane ? undefined : () => setDetailOpen(false)} />
  ) : <NoItem text={loading ? "" : visible.length === 0 ? "" : "Select an item to see its fields"} />;

  return (
    <View style={s.page} testID="vault-place">
      {menu.element}
      {wide ? <Sidebar counts={counts} folders={folderList} selection={selection} onSelect={select} onAdvanced={data.nav.openAdvanced} onNewFolder={createFolder} onFolderMenu={folderMenu} canCreateShared /> : null}
      {twoPane || !showDetail ? listPane : null}
      {showDetail ? <View style={s.detail}>{detail}</View> : null}
      {adding ? (
        <AddAnything
          lastFolderId={lastFolder} initialPaste={adding.paste} initialApp={adding.app} onClose={() => setAdding(null)}
          onAdded={(id, name, folderId) => {
            setAdding(null); setLastFolder(folderId); setSelectedId(id); setDetailOpen(true);
            setQuery("");
            if (selection.kind !== "all" && !(selection.kind === "folder" && selection.folderId === folderId)) setSelection(ALL);
            showNote(`Added ${name}`, async () => { await data.call("vault.item.delete", { itemId: id }); });
          }}
        />
      ) : null}
      {editing ? <EditSheet itemId={editing} addField={addField} onClose={() => { setEditing(null); setAddField(false); }} onSaved={(text) => showNote(text)} /> : null}
    </View>
  );
}

const EMPTY_ITEMS: readonly Item[] = [];
const EMPTY_FOLDERS: readonly Folder[] = [];
const EMPTY_PROVIDERS: readonly Provider[] = [];

const copyHandle = (data: VaultData, handle: string): Promise<void> => copyText(data, handle);

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

/** Rows the size of the real ones, so nothing moves when the data arrives. */
function ListSkeleton(): ReactElement {
  const rows: ReactElement[] = [];
  for (let i = 0; i < 8; i++) rows.push(
    <View key={i} style={s.skRow}><View style={s.skLogo} /><View style={{ flex: 1, gap: 6 }}><View style={[s.skBar, { width: `${40 + ((i * 11) % 30)}%` }]} /><View style={[s.skBar, { width: `${25 + ((i * 7) % 25)}%`, height: 9 }]} /></View></View>,
  );
  return <View style={{ flex: 1, paddingHorizontal: 8 }} testID="vault-loading" accessibilityLabel="Loading">{rows}</View>;
}

/** The place before data arrives: the same three columns with skeleton rows. */
export function VaultLoading(): ReactElement {
  return (
    <View style={s.page} testID="vault-loading-frame">
      <View style={[s.listPane, s.listPaneTwo, { flex: 1 }]}><View style={s.listHead}><Text style={s.listTitle}>Vault</Text></View><ListSkeleton /></View>
    </View>
  );
}

export interface InitialSheet { add?: { paste?: string; app?: string }; edit?: string }

export interface VaultProps {
  /** Overrides what the shell provided (the screenshot mounts and tests pass their own). */
  data?: VaultData | undefined;
  /** Which sidebar section opens first. */
  initial?: Selection | undefined;
  /** A sheet that is open from the start (the screenshot mounts and tests use it). */
  sheet?: InitialSheet | undefined;
  /** The card's first view for the opening item. */
  view?: "env" | "fields" | undefined;
}

export default function VaultLayout({ data, initial, sheet, view }: VaultProps): ReactElement {
  const provided = useOptionalVaultData();
  const d = data ?? provided;
  if (!d) return <VaultLoading />;
  return (
    <VaultDataProvider value={d}>
      <Page initial={initial} sheet={sheet} view={view} />
    </VaultDataProvider>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string, position: "relative" },
  listPane: { minWidth: 0, backgroundColor: "var(--win)" as string },
  listPaneTwo: { width: 380, flexShrink: 0, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  detail: { flex: 1, minWidth: 0 },
  listHead: { height: 48, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 10 },
  titleBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  listTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  listCount: { fontSize: 13, fontWeight: "400", color: "var(--ink-3)" as string },
  searchWrap: { paddingHorizontal: 12, paddingBottom: 8 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sel)" as string },
  searchInput: { flex: 1, minWidth: 0, height: 30, color: "var(--ink)" as string, fontSize: 13.5 },
  kbd: { fontSize: 11.5, color: "var(--ink-3)" as string },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  lineSlot: { height: 32, paddingHorizontal: 18, justifyContent: "center" },
  offline: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingBottom: 8 },
  skRow: { height: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  skLogo: { width: 30, height: 30, borderRadius: 8, backgroundColor: "var(--sel)" as string },
  skBar: { height: 11, borderRadius: 4, backgroundColor: "var(--sel)" as string },
});
