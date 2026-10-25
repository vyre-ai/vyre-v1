// Mount for P-L9_06: ?part=tree (FolderTree in a sidebar), ?part=share (ShareSheet), ?part=needs (NeedsTeamSpace), ?part=locked (LockedState).
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { FolderTree } from "../../../ui/src/FolderTree/index.tsx";
import type { FolderNode } from "../../../ui/src/FolderTree/index.tsx";
import { LockedState } from "../../../ui/src/LockedState/index.tsx";
import { NeedsTeamSpace } from "../../../ui/src/NeedsTeamSpace/index.tsx";
import { ShareSheet } from "../../../ui/src/ShareSheet/index.tsx";
import type { ShareRow } from "../../../ui/src/ShareSheet/index.tsx";

export const title = "Folders, sharing and locked states";

const node = (id: string, name: string, count: number, section: FolderNode["section"], over: Partial<FolderNode> = {}): FolderNode => ({
  id, name, parentId: null, count, scope: section === "space" ? "space" : "personal", section, via: section === "space" ? "space" : section === "shared" ? "grant" : "owner", open: false, ...over,
});

const NODES: FolderNode[] = [
  node("daily", "Daily", 1, "personal"),
  node("money", "Money", 1, "personal"),
  node("maya", "Maya's reports", 1, "shared"),
  node("sales", "Sales", 5, "space"),
  node("billing", "Billing", 1, "space"),
  node("intake", "Intake", 5, "space"),
];

const SHARES: ShareRow[] = [
  { subjectKind: "person", subjectId: "prs_omar", name: "Omar Haddad", level: "edit", via: "grant", fromFolderId: null },
  { subjectKind: "person", subjectId: "prs_lena", name: "Lena Ortiz", level: "view", via: "grant", fromFolderId: null },
];

export default function Mount() {
  const { part = "tree" } = useLocalSearchParams<{ part?: string }>();
  if (part === "share") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ShareSheet
          resourceType="folder" resourceId="fld_intake" resourceName="Intake" target="folder" ownerName="Irfad Imtiaz"
          levels={["view", "use", "edit", "manage"]} shares={SHARES} allowExternal={false} density="regular"
          directory={{ people: [{ id: "prs_maya", name: "Maya Chen" }] }}
        />
      </View>
    );
  }
  if (part === "needs") {
    return <View style={{ flex: 1, justifyContent: "center", padding: 16 }}><NeedsTeamSpace what="Admin, webhooks and agent computers" density="regular" /></View>;
  }
  if (part === "locked") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <LockedState resourceType="folder" resourceId="fld_clients" title="Clients" reason="no_grant" level="view" status="none" canRequest note="" density="regular" />
      </View>
    );
  }
  return (
    <View style={{ width: 268, flex: 1, paddingTop: 12, paddingHorizontal: 4, backgroundColor: "var(--side)" }}>
      <FolderTree resourceType="automations" nodes={NODES} selectedId={null} density="regular" />
    </View>
  );
}
