// Files > tree (spec 3.5, 2.4): Recent, Shared with me and Trash, then the folders in Personal, Shared with me and Space (ui/FolderTree), then Knowledge (Memory, Graph). Every row is a
// ui/Row; a folder is a drop target; dropping a file or folder on a folder moves it there, and a section head takes a drop into the section's top.
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { FolderTree } from "../../../../../../ui/src/FolderTree/index.tsx";
import type { FolderNode, FolderScope } from "../../../../../../ui/src/FolderTree/index.tsx";
import { useFilesData, useFolderNodes, useLive, useOptionalFilesData } from "./data.tsx";
import { dropMoves, parsePayload, sameWhere } from "./model.ts";
import type { TreeRoots, Where } from "./model.ts";
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
        <NavRow id="shared" title="Shared with me" glyph="users" selected={sameWhere(state.where, { kind: "shared" })} count={count("shared")} onPress={go({ kind: "shared" })} />
        <NavRow id="trash" title="Trash" glyph="trash" selected={sameWhere(state.where, { kind: "trash" })} count={count("trash")} onPress={go({ kind: "trash" })} />
        <View style={styles.folders}>
          {nodes.status === "ready" ? (
            <FolderTree
              resourceType="file" density="regular" nodes={nodes.data} selectedId={folderId}
              onSelect={(id) => dispatch({ type: "go", where: { kind: "folder", id } })}
              onNewFolder={(scope, parent) => data.nav.newFolder(scope === "space" ? "space" : "personal", parent)}
              onShare={(n: FolderNode) => data.nav.shareFolder(n.id)}
              onRename={(n: FolderNode) => data.nav.renameEntry("folder", n.id, n.name)}
              onDelete={(n: FolderNode) => void data.call("folders.delete", { folderId: n.id })}
              onDropItem={onDrop}
            />
          ) : null}
        </View>
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
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 14, marginBottom: 2, paddingHorizontal: 8 },
  skRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 14 },
  skDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
