// Files > sidebar (spec 3.5, 2.4), drawn inside the shared place sidebar (P-L9_22, which draws the title, the collapse button and the search field): Recent, Starred and Shared with me;
// Knowledge (Memory, Graph); then Space, holding All files, the Agents folders (each agent's face), the Projects folders and the Space's other top folders. Every row is a ui/Row (a
// ui/FolderTree SlotRow for the folders); a folder is a drop target; dropping a file or folder on a folder moves it there. The Trash is in the list's more menu.
import { useEffect, useState } from "react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SlotRow, folderMenu } from "../../../../../../ui/src/FolderTree/index.tsx";
import type { FolderHandlers, FolderNode, FolderScope } from "../../../../../../ui/src/FolderTree/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { each, matchRows } from "../../../shell/sidebar/model.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { useFilesData, useLive, useOptionalFilesData, useSource } from "./data.tsx";
import { dropMoves, hasAgentFace, openByDefault, orderFolders, parsePayload, rootRank, sameWhere, spaceRoots } from "./model.ts";
import type { FolderRow, TreeRoots, Where } from "./model.ts";
import { KNOW_ROWS, rowOf } from "../memory/know.ts";
import { Glyph } from "./parts.tsx";
import { Mark } from "../mounts/icons.tsx";
import type { MarkKind } from "../mounts/icons.tsx";
import type { IconName } from "./parts.tsx";
import { useFilesState } from "./state.tsx";

function NavRow({ id, title, glyph, selected, count, onPress, hint }: { id: string; title: string; glyph: IconName; selected: boolean; count?: number | undefined; onPress: () => void; hint?: string }): ReactElement {
  return (
    <Row
      id={`nav:${id}`} title={title} selected={selected} {...(hint !== undefined ? { domProps: { title: hint } } : {})}
      leading={<View style={styles.glyph}><Glyph name={glyph} size={16} /></View>}
      trailing={<View style={styles.trail}>{count ? <Text style={styles.count} testID={`count-${id}`}>{count}</Text> : null}</View>}
      onPress={onPress}
    />
  );
}

const DEPTH_PX = 14;

/** The mark of a mounted folder's source: a computer for a folder on one, the provider's mark for the rest. */
const markOf = (provider: string): MarkKind => (/google/i.test(provider) ? "google_drive" : /sharepoint/i.test(provider) ? "sharepoint" : /onedrive/i.test(provider) ? "onedrive" : /microsoft/i.test(provider) ? "microsoft" : /github/i.test(provider) ? "github" : "local");

type MountState = { state: string; lastSyncAt?: number };

/** The state of every mount by its folder, read when the tree opens and every half minute, so a folder that stops syncing shows a dot in the tree. */
function useMountStates(call: (cap: string, input: unknown) => Promise<unknown>): ReadonlyMap<string, MountState> {
  const [map, setMap] = useState<ReadonlyMap<string, MountState>>(new Map());
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void call("mounts.list", {}).then((o) => {
        if (!live) return;
        const rows = (o as { mounts?: Array<{ folderId: string; state: string; lastSyncAt?: number }> }).mounts ?? [];
        setMap(new Map(rows.map((m) => [m.folderId, { state: m.state, ...(m.lastSyncAt !== undefined ? { lastSyncAt: m.lastSyncAt } : {}) }])));
      }, () => undefined);
    };
    read();
    const t = setInterval(read, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [call]);
  return map;
}

/** What a mount's dot in the tree says; nothing for a mount that is fine. */
const MOUNT_WORDS: Record<string, string> = { failing: "Needs attention", paused: "Paused", device_offline: "Computer offline", syncing: "Syncing" };

/** A section head that opens and closes (Knowledge, Space), with the small + where the section takes a new folder. */
function SectionHead({ id, label, open, onToggle, onAdd }: { id: string; label: string; open: boolean; onToggle(): void; onAdd?: (() => void) | undefined }): ReactElement {
  return (
    <View style={styles.sectionHead}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${open ? "open" : "closed"}`} accessibilityState={{ expanded: open }} testID={`files-head-${id}`} onPress={onToggle}
        style={({ hovered }: { hovered?: boolean }) => [styles.headBtn, hovered === true && styles.over]}>
        <Text accessibilityRole="header" style={styles.head}>{label}</Text>
        <Glyph name={open ? "chevd" : "chev"} size={10} color="var(--ink-4)" width={1.6} />
      </Pressable>
      {onAdd ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`New folder in ${label}`} testID={`files-new-${id}`} onPress={onAdd} style={({ hovered }: { hovered?: boolean }) => [styles.add, hovered === true && styles.over]}>
          <Glyph name="plus" size={12} color="var(--ink-3)" width={1.6} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The frame before data arrives: rows of the real height, so nothing moves when the tree lands. */
export function TreeLoading(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 10; i++) bars.push(<View key={i} style={styles.skRow}><View style={styles.skDot} /><View style={[styles.skBar, { width: `${36 + ((i * 17) % 40)}%` }]} /></View>);
  return <View style={styles.loadSide} testID="files-tree-loading" accessibilityLabel="Loading">{bars}</View>;
}

/** What the folder rows share: which folders are open, the drop highlight, where the list is, and what a click, a drop and the menu do. */
interface RowCtx {
  openF: Record<string, boolean>;
  setOpenF: Dispatch<SetStateAction<Record<string, boolean>>>;
  over: string | null;
  setOver: Dispatch<SetStateAction<string | null>>;
  folderId: string | null;
  goFolder(id: string | null): void;
  menu: ReturnType<typeof useMenu>;
  handlers: FolderHandlers;
  onDrop(payload: string, target: string | null, scope: FolderScope): void;
  rank: ReadonlyMap<string, number>;
  /** The Space's registered roots: the only top folders listed under Space. */
  allow: ReadonlySet<string>;
  /** Agents with a change set waiting for review: their folder shows the attention dot. */
  waiting: ReadonlySet<string>;
  /** Mounted folders by folder id, with how each is doing. */
  mounts: ReadonlyMap<string, MountState>;
}

const nodeOf = (f: FolderRow): FolderNode => ({
  id: f.folderId, name: f.name, parentId: f.parentId ?? null, count: f.fileCount, scope: f.scope, section: f.scope === "space" ? "space" : "personal", via: f.scope === "space" ? "space" : "owner", open: false,
});

/** One folder row (a ui/FolderTree SlotRow): chevron where it has subfolders, the agent's face or the folder icon, the count; open, it lists its subfolders. */
function FolderLine({ f, depth, c, flat = false }: { f: FolderRow; depth: number; c: RowCtx; flat?: boolean }): ReactElement {
  const fid = f.folderId;
  const isOpen = c.openF[fid] ?? openByDefault(f);
  const kids = f.folderCount;
  const face = hasAgentFace(f);
  const lead = (
    <View style={[styles.subLead, { paddingLeft: depth * DEPTH_PX }]}>
      {kids > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${isOpen ? "Close" : "Open"} ${f.name}`} accessibilityState={{ expanded: isOpen }} testID={`folder-toggle-${fid}`}
          onPress={() => c.setOpenF((o) => ({ ...o, [fid]: !isOpen }))} style={({ hovered }: { hovered?: boolean }) => [styles.chev, hovered === true && styles.chevOver]}>
          <Glyph name={isOpen ? "chevd" : "chev"} size={10} color="var(--ink-4)" width={1.6} />
        </Pressable>
      ) : <View style={styles.chev} />}
      {face ? <Avatar name={f.name} kind="agent" size={18} testID={`face-${f.name}`} /> : f.source ? <View testID={`mount-mark-${fid}`} accessibilityLabel={`From ${f.source.provider}`}><Mark kind={markOf(f.source.provider)} size={16} /></View> : <Glyph name="folder" size={16} />}
    </View>
  );
  const drop = {
    // a folder is dragged out as "folder:<id>": onto another folder it moves, onto a chat it is shared with the chat's agents
    draggable: true,
    onDragStart: (e: { dataTransfer?: { setData?: (t: string, v: string) => void; effectAllowed?: string } }) => { e.dataTransfer?.setData?.("text/plain", `folder:${fid}`); if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove"; },
    onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); c.setOver(fid); },
    onDragLeave: () => c.setOver((o) => (o === fid ? null : o)),
    onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); c.setOver(null); const item = e.dataTransfer?.getData?.("text/plain") ?? ""; if (item.length > 0) c.onDrop(item, fid, f.scope); },
  };
  const node = nodeOf(f);
  const mountState = c.mounts.get(fid);
  const words = mountState ? MOUNT_WORDS[mountState.state] : undefined;
  const dot = words ? <View style={[styles.attn, mountState?.state === "failing" ? null : styles.dotCalm]} accessibilityLabel={words} testID={`mount-state-${fid}`} /> : undefined;
  return (
    <View>
      <SlotRow
        id={`folder-${fid}`} title={f.name} selected={fid === c.folderId} over={c.over === fid}
        leadWidth={depth * DEPTH_PX + 18 + 7 + (face ? 18 : 16) + 6} lead={lead} trail={face ? (c.waiting.has(f.subject?.id ?? "") ? <View style={styles.attn} accessibilityLabel="Waiting for you" testID={`folder-attention-${fid}`} /> : undefined) : dot ? dot : f.fileCount > 0 ? <Text style={styles.count} testID={`folder-count-${fid}`}>{f.fileCount}</Text> : undefined}
        onPress={() => c.goFolder(fid)} dom={drop}
        onMenu={(x, y) => c.menu.show(folderMenu(node, isOpen, kids > 0, c.handlers), x, y, "context", { label: `Folder ${f.name}` })}
      />
      {isOpen && !flat ? <Kids parent={fid} depth={depth + 1} c={c} query="" /> : null}
    </View>
  );
}

const SEARCH_DEPTH = 3;

/** The subfolders of a folder (the top of Files when `parent` is null), read live from files.list. With a search, every level is read down to a few levels and the matching folders are listed flat. */
function Kids({ parent, depth, c, query }: { parent: string | null; depth: number; c: RowCtx; query: string }): ReactElement | null {
  const src = useSource({ cap: "files.list", input: parent === null ? {} : { folder: parent } });
  if (src.status !== "ready") return null;
  const folders = orderFolders((src.data.folders ?? []).filter((f) => parent !== null || c.allow.has(f.folderId) || f.source !== undefined), parent === null ? c.rank : new Map());
  if (query === "") return <View testID={parent === null ? "files-folders" : undefined}>{each(folders, (f) => <FolderLine key={f.folderId} f={f} depth={depth} c={c} />)}</View>;
  return (
    <View>
      {each(folders, (f) => (
        <View key={f.folderId}>
          {matchRows([{ title: f.name }], query).length > 0 ? <FolderLine f={{ ...f, folderCount: 0 }} depth={0} c={c} flat /> : null}
          {depth < SEARCH_DEPTH ? <Kids parent={f.folderId} depth={depth + 1} c={c} query={query} /> : null}
        </View>
      ))}
    </View>
  );
}

function Tree({ query, slot }: { query: string; slot?: SidebarSlotApi | undefined }): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const menu = useMenu();
  const roots = useLive("files.tree", {});
  const stars = useLive("stars.list", { type: "file" });
  const open = useLive("changesets.list", { state: "open" });
  const waiting = new Set<string>(open.status === "ready" ? open.data.changesets.map((x) => x.by) : []);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [openF, setOpenF] = useState<Record<string, boolean>>({});
  const mounts = useMountStates(data.call);
  const [over, setOver] = useState<string | null>(null);
  const q = query.trim();
  const rootRows: TreeRoots = roots.status === "ready" ? roots.data.roots : [];
  const virtual = rootRows.filter((r) => r.kind === "virtual");
  const count = (key: string): number | undefined => virtual.find((r) => r.key === key)?.count;
  const learned = useLive("memory.learned", { since: data.clock().now - 86_400_000, limit: 50 });
  const trashed = useLive("memory.trash.search", { area: "trash", limit: 50 });
  const learnedCount = learned.status === "ready" ? learned.data.items.length : undefined;
  const trashCount = trashed.status === "ready" ? trashed.data.facts.length : undefined;
  const starCount = stars.status === "ready" ? stars.data.stars.length : undefined;
  const folderId = state.where.kind === "folder" ? state.where.id : null;
  const rootSelected = state.where.kind === "folder" && state.where.id === null;
  const go = (where: Where) => (): void => { dispatch({ type: "go", where }); data.nav.leaveMemory?.(); slot?.openBody(); };
  const goFolder = (id: string | null): void => { dispatch({ type: "go", where: { kind: "folder", id } }); data.nav.leaveMemory?.(); slot?.openBody(); };
  const flip = (k: string): void => setShut((o) => ({ ...o, [k]: o[k] !== true }));
  const isShut = (k: string): boolean => shut[k] === true;

  const onDrop = (payload: string, target: string | null, _scope: FolderScope): void => {
    for (const m of dropMoves(parsePayload(payload), target, () => null)) void data.call(m.cap, m.input);
  };
  const c: RowCtx = {
    mounts, openF, setOpenF, over, setOver, folderId, goFolder, menu, onDrop, rank: rootRank(rootRows), allow: spaceRoots(rootRows), waiting,
    handlers: {
      onSelect: goFolder,
      onToggle: (id, open) => setOpenF((o) => ({ ...o, [id]: open })),
      onNewFolder: (scope, parent) => data.nav.newFolder(scope === "space" ? "space" : "personal", parent),
      onShare: (n) => data.nav.shareFolder(n.id),
      ...(data.nav.connectFolder ? { onMount: (n: { id: string }) => data.nav.connectFolder?.(n.id) } : {}),
      onRename: (n) => data.nav.renameEntry("folder", n.id, n.name),
      onDelete: (n) => void data.call("folders.delete", { folderId: n.id }),
    },
  };

  const fixed = matchRows([
    { id: "recent", title: "Recent", glyph: "clock" as IconName, count: count("recent"), where: { kind: "recent" } as Where },
    { id: "starred", title: "Starred", glyph: "star" as IconName, count: starCount, where: { kind: "starred" } as Where },
    ...(data.personal === true ? [] : [{ id: "shared", title: "Shared with me", glyph: "users" as IconName, count: count("shared"), where: { kind: "shared" } as Where }]),
  ], q);
  const know = matchRows(KNOW_ROWS.map((r) => ({ id: r.id, title: r.title })), q);
  const knowCount = (id: string): number | undefined => (id === "learned" ? learnedCount : id === "trash" ? trashCount : undefined);
  // Only the Knowledge rows that hold something (or the open one) are listed; with none, one quiet "Knowledge" entry explains itself on hover.
  const knowShown = know.filter((r) => (knowCount(r.id) ?? 0) > 0 || (data.memoryView != null && rowOf(data.memoryView) === r.id));
  const knowQuiet = knowShown.length === 0 && (q === "" || matchRows([{ title: "Knowledge" }], q).length > 0);
  const allFiles = q === "" || matchRows([{ title: "All files" }], q).length > 0;

  const dropAll = {
    onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); setOver("all"); },
    onDragLeave: () => setOver((o) => (o === "all" ? null : o)),
    onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); setOver(null); const item = e.dataTransfer?.getData?.("text/plain") ?? ""; if (item.length > 0) onDrop(item, null, "space"); },
  };

  return (
    <View style={styles.side} testID="files-tree" accessibilityLabel="Files sidebar">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="files-nav">
        {each(fixed, (r) => <NavRow key={r.id} id={r.id} title={r.title} glyph={r.glyph} selected={sameWhere(state.where, r.where)} count={r.count} onPress={go(r.where)} />)}
        {knowShown.length > 0 ? <SectionHead id="know" label="Knowledge" open={!isShut("know")} onToggle={() => flip("know")} /> : null}
        {knowShown.length > 0 && !isShut("know") ? each(knowShown, (r) => {
          const row = KNOW_ROWS.find((x) => x.id === r.id)!;
          return <NavRow key={r.id} id={r.id} title={r.title} glyph={row.glyph as IconName} selected={data.memoryView != null && rowOf(data.memoryView) === r.id} count={knowCount(r.id)} onPress={() => { data.nav.openKnow(row.route); slot?.openBody(); }} />;
        }) : null}
        {knowQuiet ? <NavRow id="know" title="Knowledge" glyph="bulb" selected={data.memoryView != null} onPress={() => { data.nav.openKnow(KNOW_ROWS[0]!.route); slot?.openBody(); }} hint="What Vyre has learned about your people, clients and projects. It fills in as you work." /> : null}
        <SectionHead id="space" label="Space" open={q.length > 0 || !isShut("space")} onToggle={() => flip("space")} onAdd={() => data.nav.newFolder("space", null)} />
        {q.length > 0 || !isShut("space") ? (
          <View testID="files-space">
            {allFiles ? (
              <SlotRow
                id="folder-all" title="All files" selected={rootSelected} over={over === "all"} leadWidth={18 + 7 + 16 + 6}
                lead={<View style={styles.subLead}><View style={styles.chev} /><Glyph name="folder" size={16} /></View>} onPress={() => goFolder(null)} dom={dropAll}
              />
            ) : null}
            <Kids parent={null} depth={0} c={c} query={q} />
            {data.nav.openLive && q.length === 0 ? (
              <SlotRow
                id="folder-live" title="Live folders" selected={data.liveView === true} leadWidth={18 + 7 + 16 + 6}
                lead={<View style={styles.subLead}><View style={styles.chev} /><Glyph name="link" size={16} /></View>} onPress={() => data.nav.openLive?.()}
              />
            ) : null}
            {data.nav.connectFolder && q.length === 0 ? (
              <SlotRow
                id="folder-connect" title="Connect a folder…" leadWidth={18 + 7 + 16 + 6}
                lead={<View style={styles.subLead}><View style={styles.chev} /><Glyph name="link" size={16} /></View>} onPress={() => data.nav.connectFolder?.(null)}
              />
            ) : null}
          </View>
        ) : null}
        {fixed.length === 0 && know.length === 0 && !allFiles && q.length > 0 ? <Text style={styles.none} testID="files-tree-empty">Nothing matches that.</Text> : null}
        {menu.element}
      </ScrollView>
    </View>
  );
}

/** The Files sidebar's content. `query` is the shared search field's text; `slot` lets the phone leave the list for the body when a row is chosen. */
export function FilesTree({ query = "", slot }: { query?: string; slot?: SidebarSlotApi | undefined } = {}): ReactElement {
  const data = useOptionalFilesData();
  if (!data) return <TreeLoading />;
  return <Tree query={query} slot={slot} />;
}

const styles = StyleSheet.create({
  side: { flex: 1, minWidth: 220 },
  loadSide: { flex: 1, minWidth: 220, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 6, paddingBottom: 12 },
  glyph: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  dotCalm: { backgroundColor: "var(--ink-4)" as string },
  attn: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--danger)" as string, marginRight: 4 },
  subLead: { flexDirection: "row", alignItems: "center", gap: 7 },
  chev: { width: 18, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 5 },
  chevOver: { backgroundColor: "var(--press)" as string },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 2 },
  headBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 6 },
  add: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  none: { color: "var(--ink-3)" as string, fontSize: 13, textAlign: "center", paddingVertical: 24 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingVertical: 0 },
  skRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 14 },
  skDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
