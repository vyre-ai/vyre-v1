// Mount for lane l-share2 (owner, 4 Nov): Dex's Share sheet. ?part=before is the rc.20 sheet over the owner's rows; ?part=after is the one Access sheet over the same rows.
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AccessSheet } from "../../../ui/src/AccessSheet/index.tsx";
import type { ShareRow } from "../../../ui/src/AccessSheet/index.tsx";
import { ShareSheet } from "../../../ui/src/ShareSheet/index.tsx";

export const title = "Share an agent (Dex)";

// What rc.20 listed, top to bottom (the owner's screenshot)
const ROWS: ShareRow[] = [
  { subjectKind: "person", subjectId: "usr_irfad", name: "Irfad", level: "manage", via: "folder", fromFolderId: null },
  { subjectKind: "agent", subjectId: "agt_aliza", name: "Aliza Rizvi (Agent)", level: "edit", via: "folder", fromFolderId: null, privateAgent: true },
  { subjectKind: "agent", subjectId: "agt_andrey", name: "Andrey Lyutykh (Agent)", level: "edit", via: "folder", fromFolderId: null, privateAgent: true },
  { subjectKind: "agent", subjectId: "agt_rubab", name: "Rubab Asif (Agent)", level: "edit", via: "folder", fromFolderId: null, privateAgent: true },
  { subjectKind: "agent", subjectId: "agt_assistant", name: "Assistant", level: "edit", via: "folder", fromFolderId: null, privateAgent: true },
  { subjectKind: "agent", subjectId: "agt_dex", name: "Dex", level: "edit", via: "folder", fromFolderId: null },
  { subjectKind: "agent", subjectId: "agt_simba", name: "Simba (Claude Code)", level: "edit", via: "folder", fromFolderId: null, privateAgent: true },
  { subjectKind: "group", subjectId: "grp_everyone", name: "Everyone", level: "use", via: "grant", fromFolderId: null },
];
const DIRECTORY = {
  people: [{ id: "usr_aliza", name: "Aliza Rizvi", kind: "person" as const }, { id: "usr_andrey", name: "Andrey Lyutykh", kind: "person" as const }],
  groups: [], agents: [{ id: "agt_scout", name: "Scout", kind: "agent" as const }],
};

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "after"), []);
  if (part === null) return <View />;
  const noop = (): void => undefined;
  if (part === "before") {
    return (
      <ShareSheet
        resourceType="agent" resourceId="agt_dex" resourceName="Dex" target="item" ownerName="Irfad" ownerId="usr_irfad" levels={["use", "edit", "manage"]}
        shares={ROWS.filter((r) => r.subjectId !== "usr_irfad" || true)} allowExternal={false} density="regular" directory={DIRECTORY} onClose={noop}
      />
    );
  }
  return (
    <AccessSheet
      mode="share" itemType="agent" resourceType="agent" resourceId="agt_dex" itemName="Dex" target="item" ownerName="Irfad" ownerId="usr_irfad" spaceName="Northwind"
      levels={["view", "use", "edit", "manage"]} shares={ROWS} allowExternal={false} density="regular" directory={DIRECTORY} onClose={noop}
    />
  );
}
