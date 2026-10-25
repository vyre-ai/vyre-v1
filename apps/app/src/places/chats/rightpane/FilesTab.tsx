// Right pane > Files (spec 3.2, 2.7): the agent's own folder, the same one mounted as ~/Vyre on its computer. Folders open in place with a way back; a file opens beside the chat as
// a tab, or full screen from its menu. "Ask about this" puts the file's name in the composer. The list is files.list over the kept copy, so it works offline.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { copyText } from "./actions.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { agoLabel, backTo, enter, filePath, folderEntries, formatSize } from "./model.ts";
import type { Crumb } from "./model.ts";
import { LeadIcon, PaneList, Tool } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type FilesOut = CapMap["files.list"]["out"];

export const FILES_SCREEN = "files.list";

export function FilesTab({ deps, folderId, window }: { deps: PaneDeps; folderId: string; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const [stack, setStack] = useState<Crumb[]>([{ folderId, name: data.agent.name }]);
  // Following another agent starts at its own folder again.
  const root = stack[0];
  const crumbs: Crumb[] = root && root.folderId === folderId ? stack : [{ folderId, name: data.agent.name }];
  const here = crumbs[crumbs.length - 1] ?? { folderId, name: data.agent.name };
  const q = useScreenQuery<FilesOut>(FILES_SCREEN, "items", { folder: here.folderId });
  const clock = data.clock();

  if (folderId === "" || q.status === "loading") {
    const bars: ReactElement[] = [];
    for (let i = 0; i < 6; i++) bars.push(<View key={i} style={[st.skBar, { width: `${40 + ((i * 13) % 45)}%` }]} />);
    return <View testID="files-loading" accessibilityLabel="Loading" style={st.sk}>{bars}</View>;
  }

  const { folders, files } = folderEntries(q.data.folders, q.data.files, here.folderId);
  const relative = (name?: string): string => filePath(crumbs.slice(1), name);
  const entries: Entry[] = [
    { key: "l-folder", type: "label", text: `${data.agent.name}'s folder`, right: crumbs.length > 1 ? relative() : "Mounted as ~/Vyre" },
  ];
  const parent = crumbs[crumbs.length - 2];
  if (parent) {
    entries.push({ key: "back", type: "row", title: `Back to ${parent.name}`, leading: <LeadIcon name="back" />, onPress: () => setStack(backTo(crumbs, parent.folderId)), testID: "files-back" });
  }
  for (const f of folders) {
    entries.push({
      key: `d-${f.folderId}`, type: "row", title: f.name, note: `${f.fileCount} ${f.fileCount === 1 ? "file" : "files"}${f.folderCount ? `, ${f.folderCount} ${f.folderCount === 1 ? "folder" : "folders"}` : ""}`,
      leading: <LeadIcon name="folder" />, onPress: () => setStack(enter(crumbs, { folderId: f.folderId, name: f.name })), testID: `folder-${f.folderId}`,
      menu: [{ label: "Open", onSelect: () => setStack(enter(crumbs, { folderId: f.folderId, name: f.name })) }, { label: "Copy Path", onSelect: () => void copyText(deps, relative(f.name)) }],
    });
  }
  for (const f of files) {
    const open = (how: "side" | "full"): void => data.nav.openFile(f.fileId, how);
    entries.push({
      key: `f-${f.fileId}`, type: "row", title: f.name, note: `${formatSize(f.size)} · updated ${agoLabel(f.updatedAt, clock)}`, leading: <LeadIcon name="file" />, testID: `file-${f.fileId}`,
      onPress: () => open("side"),
      trailing: (over) => (over ? <Tool icon="expand" label={`Open ${f.name} full screen`} onPress={() => open("full")} testID={`full-${f.fileId}`} /> : null),
      menu: [
        { label: "Open", onSelect: () => open("side") },
        { label: "Open Full Screen", onSelect: () => open("full") },
        { label: `Ask ${data.agent.name} About This`, onSelect: () => data.nav.fillComposer(`About ${f.name}: `) },
        { separator: true },
        { label: "Copy Path", onSelect: () => void copyText(deps, relative(f.name)) },
      ],
    });
  }
  if (folders.length === 0 && files.length === 0) entries.push({ key: "empty", type: "empty", text: "Nothing in this folder yet.", testID: "files-empty" });
  entries.push({ key: "foot", type: "block", node: <View style={st.foot}><Text style={st.footText}>People write AGENT.md. Only the owner changes agent.toml. Vyre owns logs and chats.</Text></View> });
  return <PaneList entries={entries} {...(window ? { window } : {})} testID="files-list" />;
}

const st = StyleSheet.create({
  sk: { padding: 8, gap: 12 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  foot: { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 8 },
  footText: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
});
