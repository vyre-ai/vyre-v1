// Vault sidebar (Apple Passwords layout): Requested (only when something waits), All, AI providers, Keys, Logins, Cards, Health (only when something needs a look), then Shared with its
// folders, Mine and Advanced. Each has a count. Rows are the shared ui/Row with a leading icon and a trailing count.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { sameSelection } from "./model.ts";
import type { Counts, Folder, Selection } from "./model.ts";
import { Glyph, IconBtn } from "./parts.tsx";
import type { IconName } from "./parts.tsx";

export interface SidebarProps {
  counts: Counts;
  folders: readonly Folder[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAdvanced: () => void;
  onNewFolder: (name: string) => Promise<void>;
  onFolderMenu: (folder: Folder, x: number, y: number) => void;
  canCreateShared: boolean;
}

const Count = ({ n }: { n: number }): ReactElement => <Text style={s.count}>{n}</Text>;

export function Sidebar({ counts, folders, selection, onSelect, onAdvanced, onNewFolder, onFolderMenu, canCreateShared }: SidebarProps): ReactElement {
  const [naming, setNaming] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const item = (sel: Selection, key: string, label: string, icon: IconName, n?: number): ReactElement => (
    <Row key={key} id={`nav-${key}`} title={label} selected={sameSelection(sel, selection)} leading={<View style={s.lead}><Glyph name={icon} size={16} color={sameSelection(sel, selection) ? "var(--ink)" : "var(--ink-2)"} /></View>} trailing={n !== undefined ? <Count n={n} /> : undefined} onPress={() => onSelect(sel)} />
  );
  const shared = folders.filter((f) => f.scope === "shared");
  const depthOf = (f: Folder): number => { let d = 0; let cur: Folder | undefined = f; while (cur?.parentId && d < 4) { cur = shared.find((x) => x.id === cur!.parentId); d++; } return d; };
  const submit = async (): Promise<void> => {
    const name = (naming ?? "").trim();
    if (!name) { setNaming(null); return; }
    try { await onNewFolder(name); setNaming(null); setFolderError(null); } catch { setFolderError("Could not make that folder."); }
  };
  return (
    <View style={s.side} testID="vault-sidebar" accessibilityRole="menu" accessibilityLabel="Vault sections">
      <View style={s.title}><Text accessibilityRole="header" style={s.titleText}>Vault</Text></View>
      <View style={s.group}>
        {counts.requested > 0 ? item({ kind: "requested" }, "requested", "Requested", "requested", counts.requested) : null}
        {item({ kind: "all" }, "all", "All", "all", counts.all)}
        {item({ kind: "providers" }, "providers", "AI providers", "providers", counts.providers)}
        {item({ kind: "keys" }, "keys", "Keys", "keys", counts.keys)}
        {item({ kind: "logins" }, "logins", "Logins", "logins", counts.logins)}
        {item({ kind: "cards" }, "cards", "Cards", "cards", counts.cards)}
        {counts.health > 0 ? item({ kind: "health" }, "health", "Health", "health", counts.health) : null}
      </View>
      <View style={s.head}>
        <Text style={s.headText}>Shared</Text>
        <View style={{ flex: 1 }} />
        {canCreateShared ? <IconBtn icon="plus" label="New shared folder" onPress={() => setNaming("")} testID="new-folder" /> : null}
      </View>
      <View style={s.group} testID="vault-folders">
        {shared.map((f) => (
          <View key={f.id} {...menuTrigger((x, y) => onFolderMenu(f, x, y))}>
            <Row id={`nav-folder-${f.id}`} title={f.name} selected={selection.kind === "folder" && selection.folderId === f.id}
              leading={<View style={[s.lead, { marginLeft: depthOf(f) * 12 }]}><Glyph name="folder" size={16} color="var(--ink-2)" /></View>} trailing={<Count n={counts.folders.get(f.id) ?? f.itemCount} />}
              onPress={() => onSelect({ kind: "folder", folderId: f.id })} />
          </View>
        ))}
        {naming !== null ? (
          <View style={s.naming}>
            <Glyph name="folder" size={16} color="var(--ink-2)" />
            <TextInput autoFocus value={naming} onChangeText={setNaming} placeholder="Folder name" accessibilityLabel="Folder name" onSubmitEditing={() => { void submit(); }} onBlur={() => { void submit(); }} style={s.nameInput} testID="new-folder-name" />
          </View>
        ) : null}
        {folderError ? <Text style={s.error} accessibilityRole="alert">{folderError}</Text> : null}
      </View>
      <View style={[s.group, { marginTop: 8 }]}>
        {item({ kind: "mine" }, "mine", "Mine", "mine", counts.mine)}
        <Row id="nav-advanced" title="Advanced" leading={<View style={s.lead}><Glyph name="advanced" size={16} color="var(--ink-2)" /></View>} onPress={onAdvanced} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  side: { width: 240, flexShrink: 0, paddingHorizontal: 8, paddingBottom: 12, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  title: { height: 48, justifyContent: "center", paddingHorizontal: 10 },
  titleText: { fontSize: 18, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  group: { gap: 1 },
  head: { flexDirection: "row", alignItems: "center", height: 32, marginTop: 14, paddingLeft: 10, paddingRight: 2 },
  headText: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  lead: { width: 26, alignItems: "flex-start", justifyContent: "center" },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  naming: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 8 },
  nameInput: { flex: 1, minWidth: 0, height: 24, color: "var(--ink)" as string, fontSize: 13 },
  error: { fontSize: 12, color: "var(--danger)" as string, paddingHorizontal: 10 },
});
