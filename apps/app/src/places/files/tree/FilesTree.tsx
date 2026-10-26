// Files > tree (spec 3.5, 2.4): Recent, Shared with me and Trash, then the folders in Personal, Shared with me and Space (ui/FolderTree), then Knowledge (Memory, Graph). Every row is a
// ui/Row; a folder is a drop target; dropping a file or folder on a folder moves it there, and a section head takes a drop into the section's top.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { FolderTree, SlotRow } from "../../../../../../ui/src/FolderTree/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { FolderNode, FolderScope } from "../../../../../../ui/src/FolderTree/index.tsx";
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

/** One group of the folders Files registers for itself (ruling 65): the agents' folders, with each agent's face, or the projects' folders. Each row is a ui/FolderTree SlotRow, so hover, selection, drop and the menu match the folders above. */
export function SubjectGroup({ id, label, roots, nodes, agent, selectedId, onSelect, onShare, onNewFolder, onDrop }: {
  id: "agents" | "projects"; label: string; roots: readonly TreeRoot[]; nodes: readonly FolderNode[]; agent: boolean; selectedId: string | null;
  onSelect(folderId: string): void; onShare(folderId: string): void; onNewFolder(parentId: string): void; onDrop(payload: string, folderId: string): void;
}): ReactElement | null {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [over, setOver] = useState<string | null>(null);
  const menu = useMenu();
  if (roots.length === 0) return null;
  const rows: ReactElement[] = [];
  const walk = (fid: string, title: string, count: number, depth: number): void => {
    const kids = nodes.filter((n) => n.parentId === fid).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    const isOpen = open[fid] === true;
    const face = agent && depth === 0;
    const lead = (
      <View style={[styles.subLead, { paddingLeft: depth * DEPTH_PX }]}>
        {kids.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${isOpen ? "Close" : "Open"} ${title}`} accessibilityState={{ expanded: isOpen }} testID={`${id}-toggle-${fid}`}
            onPress={() => setOpen((o) => ({ ...o, [fid]: !isOpen }))} style={({ hovered }: { hovered?: boolean }) => [styles.chev, hovered === true && styles.chevOver]}>
            <Glyph name={isOpen ? "chevd" : "chev"} size={10} color="var(--ink-4)" width={1.6} />
          </Pressable>
        ) : <View style={styles.chev} />}
        {face ? <Avatar name={title} kind="agent" size={18} testID={`face-${title}`} /> : <Glyph name="folder" size={16} />}
      </View>
    );
    const drop = {
      onDragOver: (e: { preventDefault: () => void }) => { e.preventDefault(); setOver(fid); },
      onDragLeave: () => setOver((o) => (o === fid ? null : o)),
      onDrop: (e: { preventDefault: () => void; dataTransfer?: { getData?: (t: string) => string } }) => { e.preventDefault(); setOver(null); const item = e.dataTransfer?.getData?.("text/plain") ?? ""; if (item.length > 0) onDrop(item, fid); },
    };
    rows.push(
      <SlotRow
        key={fid} id={`${id}-${fid}`} title={title} selected={fid === selectedId} over={over === fid} leadWidth={depth * DEPTH_PX + 18 + 7 + (face ? 18 : 16) + 6}
        lead={lead} trail={count > 0 ? <Text style={styles.count} testID={`${id}-count-${fid}`}>{count}</Text> : undefined}
        onPress={() => onSelect(fid)} dom={drop}
        onMenu={(x, y) => menu.show([
          { label: "Open", onSelect: () => onSelect(fid) },
          ...(kids.length > 0 ? [{ label: isOpen ? "Close" : "Expand", onSelect: () => setOpen((o) => ({ ...o, [fid]: !isOpen })) }] : []),
          { label: "New Folder…", onSelect: () => onNewFolder(fid) },
          { label: "Share…", onSelect: () => onShare(fid) },
        ], x, y, "context", { label: `Folder ${title}` })}
      />,
    );
    if (isOpen) for (const k of kids) walk(k.id, k.name, k.count, depth + 1);
  };
  for (const r of roots) if (r.folderId !== undefined) walk(r.folderId, r.title, r.count, 0);
  return (
    <View testID={`files-${id}`} accessibilityRole="list" accessibilityLabel={label}>
      <Head label={label} />
      {rows}
      {menu.element}
    </View>
  );
}

function Head({ label }: { label: string }): ReactElement {
  return <Text accessibilityRole="header" style={styles.head}>{label}</Text>;
}

/** The frame before data arrives: rows of the real height, so nothing moves when the tree lands. */
export function TreeLoading(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 10; i++) bars.push(<View key={i} style={styles.skRow}><View style={styles.skDot} /><View style={[styles.skBar, { width: `${36 + ((i * 17) % 40)}%` }]} /></View>);
  return <View style={styles.side} testID="files-tree-loading" accessibilityLabel="Loading">{bars}</View>;
}

function Tree(): ReactElement {
  const data = useFilesData();
  const { state, dispatch } = useFilesState();
  const roots = useLive("files.tree", {});
  const nodes = useFolderNodes();
  const stars = useLive("stars.list", { type: "file" });
  const starCount = stars.status === "ready" ? stars.data.stars.length : undefined;
  const groups = roots.status === "ready" ? subjectGroups(roots.data.roots) : { agents: [], projects: [] };
  const subjectIds = [...groups.agents, ...groups.projects].flatMap((r) => (r.folderId === undefined ? [] : [r.folderId]));
  const hidden = nodes.status === "ready" ? subtreeIds(nodes.data, subjectIds) : new Set<string>();
  const virtual: TreeRoots = roots.status === "ready" ? roots.data.roots.filter((r) => r.kind === "virtual") : [];
  const count = (key: string): number | undefined => virtual.find((r) => r.key === key)?.count;
  const go = (where: Where) => (): void => dispatch({ type: "go", where });
  const folderId = state.where.kind === "folder" ? state.where.id : null;

  const onDrop = (payload: string, target: string | null, _scope: FolderScope): void => {
    for (const m of dropMoves(parsePayload(payload), target, () => null)) void data.call(m.cap, m.input);
  };

  return (
    <View style={styles.side} testID="files-tree" accessibilityLabel="Files sidebar">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="files-nav">
        <NavRow id="recent" title="Recent" glyph="clock" selected={sameWhere(state.where, { kind: "recent" })} count={count("recent")} onPress={go({ kind: "recent" })} />
        <NavRow id="starred" title="Starred" glyph="star" selected={sameWhere(state.where, { kind: "starred" })} count={starCount} onPress={go({ kind: "starred" })} />
        <NavRow id="shared" title="Shared with me" glyph="users" selected={sameWhere(state.where, { kind: "shared" })} count={count("shared")} onPress={go({ kind: "shared" })} />
        <NavRow id="trash" title="Trash" glyph="trash" selected={sameWhere(state.where, { kind: "trash" })} count={count("trash")} onPress={go({ kind: "trash" })} />
        <View style={styles.folders}>
          {nodes.status === "ready" ? (
            <FolderTree
              resourceType="file" density="regular" nodes={nodes.data.filter((n) => !hidden.has(n.id))} selectedId={folderId}
              onSelect={(id) => dispatch({ type: "go", where: { kind: "folder", id } })}
              onNewFolder={(scope, parent) => data.nav.newFolder(scope === "space" ? "space" : "personal", parent)}
              onShare={(n: FolderNode) => data.nav.shareFolder(n.id)}
              onRename={(n: FolderNode) => data.nav.renameEntry("folder", n.id, n.name)}
              onDelete={(n: FolderNode) => void data.call("folders.delete", { folderId: n.id })}
              onDropItem={onDrop}
            />
          ) : null}
        </View>
        <SubjectGroup
          id="agents" label="Agents" roots={groups.agents} nodes={nodes.status === "ready" ? nodes.data : []} agent selectedId={folderId}
          onSelect={(id) => dispatch({ type: "go", where: { kind: "folder", id } })} onShare={(id) => data.nav.shareFolder(id)} onNewFolder={(id) => data.nav.newFolder("space", id)} onDrop={(p, id) => onDrop(p, id, "space")}
        />
        <SubjectGroup
          id="projects" label="Projects" roots={groups.projects} nodes={nodes.status === "ready" ? nodes.data : []} agent={false} selectedId={folderId}
          onSelect={(id) => dispatch({ type: "go", where: { kind: "folder", id } })} onShare={(id) => data.nav.shareFolder(id)} onNewFolder={(id) => data.nav.newFolder("space", id)} onDrop={(p, id) => onDrop(p, id, "space")}
        />
        <Head label="Knowledge" />
        <NavRow id="memory" title="Memory" glyph="memory" selected={sameWhere(state.where, { kind: "knowledge" })} onPress={() => { dispatch({ type: "go", where: { kind: "knowledge" } }); data.nav.openMemory(); }} />
        <NavRow id="graph" title="Graph" glyph="graph" selected={false} onPress={() => data.nav.openGraph()} />
      </ScrollView>
    </View>
  );
}

export function FilesTree(): ReactElement {
  const data = useOptionalFilesData();
  if (!data) return <TreeLoading />;
  return <Tree />;
}

const styles = StyleSheet.create({
  side: { flex: 1, minWidth: 220, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 6, paddingBottom: 12 },
  glyph: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  folders: { marginTop: 10 },
  subLead: { flexDirection: "row", alignItems: "center", gap: 7 },
  chev: { width: 18, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 5 },
  chevOver: { backgroundColor: "var(--press)" as string },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 2, paddingHorizontal: 8 },
  skRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 14 },
  skDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
