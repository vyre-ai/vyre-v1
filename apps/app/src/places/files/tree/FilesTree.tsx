// Files > sidebar (spec 3.5, 2.4), drawn inside the shared place sidebar (P-L9_22, which draws the title, the collapse button and the search field): Recent, Starred and Shared with me;
// Knowledge (Memory, Graph); then Space, holding All files, the Agents folders (each agent's face), the Projects folders and the Space's other top folders. Every row is a ui/Row (a
// ui/FolderTree SlotRow for the folders); a folder is a drop target; dropping a file or folder on a folder moves it there. The Trash is in the list's more menu.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { SlotRow, folderMenu } from "../../../../../../ui/src/FolderTree/index.tsx";
import type { FolderHandlers, FolderNode, FolderScope } from "../../../../../../ui/src/FolderTree/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { each, matchRows } from "../../../shell/sidebar/model.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { useFilesData, useFolderNodes, useLive, useOptionalFilesData } from "./data.tsx";
import { dropMoves, parsePayload, sameWhere, subjectGroups, subtreeIds } from "./model.ts";
import type { TreeRoot, TreeRoots, Where } from "./model.ts";
import { Glyph } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { useFilesState } from "./state.tsx";

function NavRow({ id, title, glyph, selected, count, onPress }: { id: string; title: string; glyph: IconName; selected: boolean; count?: number | undefined; onPress: () => void }): ReactElement {
  return (
    <Row
      id={`nav:${id}`} title={title} selected={selected}
      leading={<View style={styles.glyph}><Glyph name={glyph} size={16} /></View>}
      trailing={<View style={styles.trail}>{count ? <Text style={styles.count} testID={`count-${id}`}>{count}</Text> : null}</View>}
      onPress={onPress}
    />
  );
}

const DEPTH_PX = 14;

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

interface FolderLine { id: string; scope: "agents" | "projects" | "folder"; title: string; count: number; depth: number; node: FolderNode; face: boolean; kids: number }

function Tree({ query, slot }: { query: string; slot?: SidebarSlotApi | undefined }): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const menu = useMenu();
  const roots = useLive("files.tree", {});
  const nodesQ = useFolderNodes();
  const stars = useLive("stars.list", { type: "file" });
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [openF, setOpenF] = useState<Record<string, boolean>>({});
  const [over, setOver] = useState<string | null>(null);
  const q = query.trim();
  const nodes: readonly FolderNode[] = nodesQ.status === "ready" ? nodesQ.data : [];
  const rootRows: TreeRoots = roots.status === "ready" ? roots.data.roots : [];
  const virtual = rootRows.filter((r) => r.kind === "virtual");
  const count = (key: string): number | undefined => virtual.find((r) => r.key === key)?.count;
  const starCount = stars.status === "ready" ? stars.data.stars.length : undefined;
  const groups = subjectGroups(rootRows);
  const subjectIds = [...groups.agents, ...groups.projects].flatMap((r) => (r.folderId === undefined ? [] : [r.folderId]));
  const hidden = subtreeIds(nodes, subjectIds);
  const ids = new Set(nodes.map((n) => n.id));
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const folderId = state.where.kind === "folder" ? state.where.id : null;
  const rootSelected = state.where.kind === "folder" && state.where.id === null;
  const go = (where: Where) => (): void => { dispatch({ type: "go", where }); slot?.openBody(); };
  const goFolder = (id: string | null): void => { dispatch({ type: "go", where: { kind: "folder", id } }); slot?.openBody(); };
  const flip = (k: string): void => setShut((o) => ({ ...o, [k]: o[k] !== true }));
  const isShut = (k: string): boolean => shut[k] === true;

  const onDrop = (payload: string, target: string | null, _scope: FolderScope): void => {
    for (const m of dropMoves(parsePayload(payload), target, () => null)) void data.call(m.cap, m.input);
  };
  const handlers: FolderHandlers = {
    onSelect: goFolder,
    onToggle: (id, open) => setOpenF((o) => ({ ...o, [id]: open })),
    onNewFolder: (scope, parent) => data.nav.newFolder(scope === "space" ? "space" : "personal", parent),
    onShare: (n) => data.nav.shareFolder(n.id),
    onRename: (n) => data.nav.renameEntry("folder", n.id, n.name),
    onDelete: (n) => void data.call("folders.delete", { folderId: n.id }),
  };

  const nodeOf = (r: TreeRoot): FolderNode | undefined => (r.folderId === undefined ? undefined : nodes.find((n) => n.id === r.folderId) ?? { id: r.folderId, name: r.title, parentId: null, count: r.count, scope: "space", section: "space", via: "space", open: false });
  const lines: ReactElement[] = [];
  const pushLine = (l: FolderLine): void => {
    const fid = l.node.id;
    const isOpen = openF[fid] === true;
    const lead = (
      <View style={[styles.subLead, { paddingLeft: l.depth * DEPTH_PX }]}>
        {l.kids > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${isOpen ? "Close" : "Open"} ${l.title}`} accessibilityState={{ expanded: isOpen }} testID={`${l.scope}-toggle-${fid}`}
            onPress={() => setOpenF((o) => ({ ...o, [fid]: !isOpen }))} style={({ hovered }: { hovered?: boolean }) => [styles.chev, hovered === true && styles.chevOver]}>
            <Glyph name={isOpen ? "chevd" : "chev"} size={10} color="var(--ink-4)" width={1.6} />
          </Pressable>
        ) : <View style={styles.chev} />}
        {l.face ? <Avatar name={l.title} kind="agent" size={18} testID={`face-${l.title}`} /> : <Glyph name="folder" size={16} />}
      </View>
    );
    const drop = {
      onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); setOver(fid); },
      onDragLeave: () => setOver((o) => (o === fid ? null : o)),
      onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); setOver(null); const item = e.dataTransfer?.getData?.("text/plain") ?? ""; if (item.length > 0) onDrop(item, fid, "space"); },
    };
    const countText = l.scope === "folder" || l.count > 0 ? <Text style={styles.count} testID={l.scope === "folder" ? `folder-count-${fid}` : `${l.scope}-count-${fid}`}>{l.count}</Text> : undefined;
    lines.push(
      <SlotRow
        key={`${l.scope}-${fid}`} id={l.scope === "folder" ? `folder-${fid}` : `${l.scope}-${fid}`} title={l.title} selected={fid === folderId} over={over === fid}
        leadWidth={l.depth * DEPTH_PX + 18 + 7 + (l.face ? 18 : 16) + 6} lead={lead} trail={countText} onPress={() => goFolder(fid)} dom={drop}
        onMenu={(x, y) => menu.show(folderMenu(l.node, isOpen, l.kids > 0, handlers), x, y, "context", { label: `Folder ${l.title}` })}
      />,
    );
  };
  const kidsOf = (id: string): FolderNode[] => nodes.filter((n) => n.parentId === id).sort(byName);
  const walk = (n: FolderNode, scope: FolderLine["scope"], depth: number, title: string, face: boolean, cnt: number): void => {
    const kids = kidsOf(n.id);
    pushLine({ id: n.id, scope, title, count: cnt, depth, node: n, face, kids: kids.length });
    if (openF[n.id] === true) for (const k of kids) walk(k, scope, depth + 1, k.name, false, k.count);
  };
  /** Agents and Projects: a row that opens and closes, with each registered folder under it. */
  const group = (key: "agents" | "projects", label: string, list: readonly TreeRoot[], face: boolean): ReactElement | null => {
    if (list.length === 0) return null;
    const open = !isShut(key);
    lines.length = 0;
    if (open) for (const r of list) { const n = nodeOf(r); if (n) walk(n, key, 1, r.title, face, r.count); }
    return (
      <View key={key} testID={`files-${key}`} accessibilityRole="list" accessibilityLabel={label}>
        <SlotRow id={`group-${key}`} title={label} onPress={() => flip(key)}
          lead={<View style={styles.subLead}><View style={styles.chev}><Glyph name={open ? "chevd" : "chev"} size={10} color="var(--ink-4)" width={1.6} /></View><Glyph name="folder" size={16} /></View>} leadWidth={18 + 7 + 16 + 6} />
        {lines.slice()}
      </View>
    );
  };

  const fixed = matchRows([
    { id: "recent", title: "Recent", glyph: "clock" as IconName, count: count("recent"), where: { kind: "recent" } as Where },
    { id: "starred", title: "Starred", glyph: "star" as IconName, count: starCount, where: { kind: "starred" } as Where },
    { id: "shared", title: "Shared with me", glyph: "users" as IconName, count: count("shared"), where: { kind: "shared" } as Where },
  ], q);
  const know = matchRows([{ id: "memory", title: "Memory" }, { id: "graph", title: "Graph" }], q);

  let space: ReactElement[] = [];
  if (q.length > 0) {
    lines.length = 0;
    const agentIds = new Set(groups.agents.flatMap((r) => (r.folderId === undefined ? [] : [r.folderId])));
    for (const n of matchRows(nodes.map((x) => ({ ...x, title: x.name })), q).sort(byName)) pushLine({ id: n.id, scope: "folder", title: n.name, count: n.count, depth: 0, node: n, face: agentIds.has(n.id), kids: 0 });
    space = lines.slice();
  } else {
    const rows: ReactElement[] = [];
    rows.push(
      <SlotRow
        key="all" id="folder-all" title="All files" selected={rootSelected} over={over === "all"} leadWidth={18 + 7 + 16 + 6}
        lead={<View style={styles.subLead}><View style={styles.chev} /><Glyph name="folder" size={16} /></View>} onPress={() => goFolder(null)}
        dom={{
          onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); setOver("all"); },
          onDragLeave: () => setOver((o) => (o === "all" ? null : o)),
          onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); setOver(null); const item = e.dataTransfer?.getData?.("text/plain") ?? ""; if (item.length > 0) onDrop(item, null, "space"); },
        }}
      />,
    );
    const a = group("agents", "Agents", groups.agents, true);
    if (a) rows.push(a);
    const p = group("projects", "Projects", groups.projects, false);
    if (p) rows.push(p);
    lines.length = 0;
    const tops = nodes.filter((n) => !hidden.has(n.id) && (n.parentId === null || !ids.has(n.parentId))).sort(byName);
    for (const n of tops) walk(n, "folder", 0, n.name, false, n.count);
    rows.push(<View key="others" testID="files-folders">{lines.slice()}</View>);
    space = rows;
  }

  return (
    <View style={styles.side} testID="files-tree" accessibilityLabel="Files sidebar">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="files-nav">
        {each(fixed, (r) => <NavRow key={r.id} id={r.id} title={r.title} glyph={r.glyph} selected={sameWhere(state.where, r.where)} count={r.count} onPress={go(r.where)} />)}
        {know.length > 0 ? <SectionHead id="know" label="Knowledge" open={!isShut("know")} onToggle={() => flip("know")} /> : null}
        {know.length > 0 && !isShut("know") ? each(know, (r) => (r.id === "memory"
          ? <NavRow key={r.id} id="memory" title="Memory" glyph="memory" selected={sameWhere(state.where, { kind: "knowledge" })} onPress={() => { dispatch({ type: "go", where: { kind: "knowledge" } }); data.nav.openMemory(); slot?.openBody(); }} />
          : <NavRow key={r.id} id="graph" title="Graph" glyph="graph" selected={false} onPress={() => { data.nav.openGraph(); slot?.openBody(); }} />)) : null}
        {space.length > 0 || q.length === 0 ? <SectionHead id="space" label="Space" open={q.length > 0 || !isShut("space")} onToggle={() => flip("space")} onAdd={() => data.nav.newFolder("space", null)} /> : null}
        {q.length > 0 || !isShut("space") ? space : null}
        {fixed.length === 0 && know.length === 0 && space.length === 0 ? <Text style={styles.none} testID="files-tree-empty">Nothing matches that.</Text> : null}
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
