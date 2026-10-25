// Right pane > Files (spec 3.2, 2.7): the agent's own folder, the same one mounted as ~/Vyre on its computer. Folders open in place with a way back; a file opens beside the chat as
// a tab, or full screen from its menu. "Ask about this" puts the file's name in the composer. The list is files.list over the kept copy, so it works offline.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { copyText } from "./actions.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { agoLabel, folderEntries, formatSize } from "./model.ts";
import { Icon, LeadIcon } from "./parts.tsx";

type FilesOut = CapMap["files.list"]["out"];

export const FILES_SCREEN = "files.list";

/** Folders the tree shows in this order (the prototype's), the rest alphabetical after; Vyre owns logs and chats, so they carry a lock. */
export const FOLDER_ORDER: readonly string[] = ["notes", "proposed", "recipes", "journal", "memory", "skills", "routines", "knowledge", "inbox", "work", "downloads", "logs", "chats"];
export const VYRE_OWNED: ReadonlySet<string> = new Set(["logs", "chats"]);
/** Open when the tab first draws. */
const OPEN_AT_START: ReadonlySet<string> = new Set(["memory", "routines"]);

/** Files first (AGENT.md, agent.toml), then folders in the prototype's order. */
export function treeOrder<T extends { name: string }>(folders: readonly T[]): T[] {
  const rank = (n: string): number => { const i = FOLDER_ORDER.indexOf(n); return i < 0 ? FOLDER_ORDER.length : i; };
  return folders.slice().sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }], width: 14, alignItems: "center" }}><Icon name="chev" size={11} color="var(--ink-4)" /></View>;
}

/** One level of the tree: the files, then the folders; an open folder draws its own level beneath it. Every row is a ui/Row. */
function Level({ folderId, depth, deps, relative, openSet, toggle }: {
  folderId: string; depth: number; deps: PaneDeps; relative: string[]; openSet: ReadonlySet<string>; toggle: (id: string) => void;
}): ReactElement | null {
  const data = usePaneData();
  const q = useScreenQuery<FilesOut>(FILES_SCREEN, "items", { folder: folderId });
  const clock = data.clock();
  if (q.status !== "ready") return null;
  const { folders, files } = folderEntries(q.data.folders, q.data.files, folderId);
  const indent = { paddingLeft: depth * 14 };
  const rows: ReactElement[] = [];
  for (const f of files) {
    const open = (how: "side" | "full"): void => data.nav.openFile(f.fileId, how);
    const path = [...relative, f.name].join("/");
    rows.push(
      <View key={f.fileId} style={indent}>
        <TreeMenu title={f.name} entries={[
          { label: "Open", onSelect: () => open("side") },
          { label: "Open Full Screen", onSelect: () => open("full") },
          { label: `Ask ${data.agent.name} About This`, onSelect: () => data.nav.fillComposer(`About ${f.name}: `) },
          { separator: true },
          { label: "Copy Path", onSelect: () => void copyText(deps, path) },
        ]}>
          <Row id={`file-${f.fileId}`} title={f.name} note={`${formatSize(f.size)} · updated ${agoLabel(f.updatedAt, clock)}`} onPress={() => open("side")} leading={<LeadIcon name="file" />} />
        </TreeMenu>
      </View>,
    );
  }
  for (const f of treeOrder(folders)) {
    const isOpen = openSet.has(f.folderId);
    const owned = VYRE_OWNED.has(f.name);
    const count = f.fileCount + f.folderCount;
    rows.push(
      <View key={f.folderId}>
        <View style={indent}>
          <TreeMenu title={f.name} entries={[
            { label: isOpen ? "Close" : "Open", onSelect: () => toggle(f.folderId) },
            { label: "Copy Path", onSelect: () => void copyText(deps, [...relative, f.name].join("/")) },
          ]}>
            <Row
              id={`folder-${f.folderId}`} title={f.name} onPress={() => toggle(f.folderId)}
              leading={<View style={st.lead}><Chevron open={isOpen} /><Icon name="folder" size={14} /></View>}
              trailing={owned ? <View testID={`lock-${f.folderId}`} accessibilityLabel="Owned by Vyre"><Icon name="lock" size={12} color="var(--ink-4)" /></View> : count > 0 ? <Text testID={`count-${f.folderId}`} style={st.count}>{count}</Text> : null}
            />
          </TreeMenu>
        </View>
        {isOpen ? <Level folderId={f.folderId} depth={depth + 1} deps={deps} relative={[...relative, f.name]} openSet={openSet} toggle={toggle} /> : null}
      </View>,
    );
  }
  if (rows.length === 0 && depth === 0) return <View testID="files-empty" style={st.empty}><Text style={st.footText}>Nothing in this folder yet.</Text></View>;
  return <View>{rows}</View>;
}

/** The right-click menu around one tree row. */
function TreeMenu({ title, entries, children }: { title: string; entries: MenuEntry[]; children: ReactElement }): ReactElement {
  const menu = useMenu();
  return <View {...menuTrigger((x, y) => menu.show(entries, x, y, "context", { label: title }))}>{children}{menu.element}</View>;
}

export function FilesTab({ deps, folderId }: { deps: PaneDeps; folderId: string; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const q = useScreenQuery<FilesOut>(FILES_SCREEN, "items", { folder: folderId });
  // Open folders by id; memory and routines start open, found by name once their level has arrived.
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
  const initial = useMemo(() => {
    if (q.status !== "ready") return new Set<string>();
    const ids = new Set<string>();
    for (const f of q.data.folders) if (f.parentId === folderId && OPEN_AT_START.has(f.name)) ids.add(f.folderId);
    return ids;
  }, [q, folderId]);
  const openSet = opened ?? initial;
  const toggle = (id: string): void => setOpened((cur) => { const n = new Set(cur ?? initial); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (folderId === "" || q.status === "loading") {
    const bars: ReactElement[] = [];
    for (let i = 0; i < 6; i++) bars.push(<View key={i} style={[st.skBar, { width: `${40 + ((i * 13) % 45)}%` }]} />);
    return <View testID="files-loading" accessibilityLabel="Loading" style={st.sk}>{bars}</View>;
  }
  return (
    <ScrollView testID="files-list" style={{ flex: 1 }}>
      <View style={st.head}>
        <Text accessibilityRole="header" style={st.headText}>{`${data.agent.name}'s folder`}</Text>
        <Text style={st.headRight}>Mounted as ~/Vyre</Text>
      </View>
      <Level folderId={folderId} depth={0} deps={deps} relative={[]} openSet={openSet} toggle={toggle} />
      <View style={st.foot}><Text style={st.footText}>People write AGENT.md. Only the owner changes agent.toml. Vyre owns logs and chats.</Text></View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  head: { minHeight: 30, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4 },
  headText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  headRight: { fontSize: 11.5, color: "var(--ink-4)" as string },
  lead: { flexDirection: "row", alignItems: "center", gap: 2 },
  count: { fontSize: 11.5, color: "var(--ink-4)" as string, fontVariant: ["tabular-nums"] },
  sk: { padding: 8, gap: 12 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  empty: { paddingHorizontal: 8, paddingVertical: 8 },
  foot: { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 8 },
  footText: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
});
