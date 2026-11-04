// Mount for lane l-share2 (owner, 4 Nov): the Share sheet of each kind of item, all the one Access sheet. ?part=dex is Dex over the rows rc.20 listed (the owner's screenshot); note, vault, vaultfolder, rtype, record, folder, artifact and automation draw the sheet with the props that place passes.
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { ShareSheetProps } from "../../../ui/src/AccessSheet/index.tsx";
import { AccessSheet } from "../../../ui/src/AccessSheet/index.tsx";
import type { ShareRow } from "../../../ui/src/AccessSheet/index.tsx";

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


const P = (id: string, name: string, level: ShareRow["level"], via: ShareRow["via"] = "grant"): ShareRow => ({ subjectKind: "person", subjectId: id, name, level, via, fromFolderId: via === "folder" ? "fld_clients" : null });
const PEOPLE = [{ id: "usr_sara", name: "Sara Malik", kind: "person" as const }, { id: "usr_omar", name: "Omar Reyes", kind: "person" as const }];
const BASE = { mode: "share" as const, density: "regular" as const, ownerName: "Irfad", ownerId: "usr_irfad", spaceName: "Northwind", onClose: () => undefined, allowExternal: false, directory: { ...DIRECTORY, people: PEOPLE } };
const EVERYONE: ShareRow = { subjectKind: "group", subjectId: "grp_everyone", name: "Everyone", level: "view", via: "grant", fromFolderId: null };

const PARTS: Record<string, ShareSheetProps> = {
  dex: { ...BASE, itemType: "agent", resourceType: "agent", resourceId: "agt_dex", itemName: "Dex", target: "item", levels: ["view", "use", "edit", "manage"], shares: ROWS, agentsOn: true, onAgents: () => undefined },
  note: { ...BASE, itemType: "note", resourceType: "file", resourceId: "not_1", itemName: "Lab 8 run of show", target: "item", levels: ["view", "edit"], shares: [P("usr_omar", "Omar Reyes", "view"), { ...EVERYONE, level: "view" }] },
  vault: { ...BASE, itemType: "vault", resourceType: "vault_item", resourceId: "vit_ghl", itemName: "GoHighLevel", target: "item", levels: ["use", "view", "edit"], shares: [P("usr_omar", "Omar Reyes", "view"), { subjectKind: "agent", subjectId: "agt_intake", name: "Intake", level: "use", via: "grant", fromFolderId: null }] },
  vaultfolder: { ...BASE, itemType: "vault", itemLabel: "folder", resourceType: "vault_folder", resourceId: "vfd_mkt", itemName: "Marketing", target: "folder", levels: ["use", "view", "edit"], shares: [P("usr_sara", "Sara Malik", "edit")] },
  rtype: { ...BASE, itemType: "rtype", resourceType: "record_type", resourceId: "deal", itemName: "Deals", target: "item", levels: ["view", "edit", "manage"], shares: [P("usr_omar", "Omar Reyes", "edit"), P("usr_sara", "Sara Malik", "view")] },
  record: { ...BASE, itemType: "record", resourceType: "record", resourceId: "rec_acme", itemName: "Acme renewal", target: "item", folderName: "Deals", levels: ["view", "edit", "manage"], shares: [P("usr_omar", "Omar Reyes", "edit", "folder"), P("usr_sara", "Sara Malik", "view")] },
  folder: { ...BASE, itemType: "file", itemLabel: "folder", resourceType: "folder", resourceId: "fld_clients", itemName: "Clients", target: "folder", levels: ["view", "edit", "manage"], shares: [P("usr_omar", "Omar Reyes", "edit"), { ...EVERYONE, via: "grant" }] },
  artifact: { ...BASE, itemType: "artifact", resourceType: "site", resourceId: "sit_pitch", itemName: "Pitch", target: "item", subtitle: "Artifact. The people you add can open it in Vyre.", levels: ["view", "edit", "manage"], shares: [P("usr_sara", "Sara Malik", "view")] },
  automation: { ...BASE, itemType: "automation", resourceType: "automation", resourceId: "aut_weekly", itemName: "Weekly report", target: "item", levels: ["view", "edit", "manage"], shares: [P("usr_omar", "Omar Reyes", "edit")] },
};

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "dex"), []);
  if (part === null) return <View />;
  const props = PARTS[part] ?? PARTS["dex"]!;
  return <AccessSheet {...props} />;
}
