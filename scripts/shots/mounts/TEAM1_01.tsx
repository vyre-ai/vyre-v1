// Mount for lane l-team1 (owner D21 to D24, 3 Nov) over the Northwind sample. ?part=
//   chats       the Chats sidebar after an absence: the While you were away row on top, Team now (pressed open by the shoot: Intake at work in #sales for Omar, Priya online, Omar away),
//               steady dots on the People rows
//   chats-quiet the same sidebar with no absence: no digest row, Team now folded
//   overview    Console Overview: a new member's stuck join with Retry, the #general offer (Rename to #vyre, Keep #general), and Working now open
//   invite      Console > People with the invite sheet open (the shoot presses Invite a person): where they start, #vyre ticked and fixed, a shared agent ticked; What everyone gets below
//   menu        the Space menu of an admin in a Team Space, with Invite People (the shoot presses the tile)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind, SAMPLE_NOW } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole, overviewFor } from "../../../apps/app/src/console/shell/sample.ts";
import { Overview } from "../../../apps/app/src/console/pages/overview/Overview.tsx";
import { People } from "../../../apps/app/src/console/pages/People.tsx";
import { SpaceTile } from "../../../apps/app/src/shell/spaces/SpaceSwitcher.tsx";
import { SEED_DEFS } from "../../../apps/app/src/shell/spaces/model.ts";

export const title = "Team: away digest, Team now, presence, invites, What everyone gets";

const MIN = 60_000, HOUR = 60 * MIN;
const DIGEST = {
  id: "dgs_1", person: "usr_irfad", periodStart: SAMPLE_NOW - 14 * HOUR, periodEnd: SAMPLE_NOW, builtBy: "vyre",
  headline: ["4 things happened while you were away.", "1 was a decision your agents made for you."],
  items: [
    { kind: "decision", title: "Booked the Rivera consult", line: "Done for you.", subject: { type: "run", id: "run_1" } },
    { kind: "record_change", title: "Rivera matter", line: "Changed by Maya Chen.", subject: { type: "record", id: "rec_rivera" } },
    { kind: "notice", title: "Lena Brandt joined Northwind", line: "Joined the Space." },
    { kind: "notice", title: "Intake finished: Pruitt intake summary", line: "Held back so it would not interrupt you." },
  ],
};
const PRESENCE = { people: [
  { personId: "usr_irfad", state: "online", lastSeenAt: SAMPLE_NOW },
  { personId: "usr_priya", state: "online", lastSeenAt: SAMPLE_NOW - 2 * MIN },
  { personId: "usr_omar", state: "away", lastSeenAt: SAMPLE_NOW - 40 * MIN, awayUntil: SAMPLE_NOW + 9 * HOUR },
  { personId: "usr_maya", state: "offline", lastSeenAt: SAMPLE_NOW - 3 * HOUR },
] };
const WORKING = { working: [
  { agentId: "agt_intake", forPerson: "usr_omar", where: "space", since: SAMPLE_NOW - 2 * MIN, threadId: "thr_sales", title: "sales", channelId: "chn_sales", kind: "channel" },
  { agentId: "agt_docs", forPerson: "usr_priya", where: "space", since: SAMPLE_NOW - 5 * MIN },
] };

function chats(away: boolean): ReturnType<typeof createSampleSidebar>["data"] {
  const s = createSampleSidebar(northwind).data;
  return {
    ...s,
    people: (northwind.people ?? []).map((p) => ({ id: p.id, name: p.name })),
    call: (cap: string, input: unknown) => {
      if (cap === "home.digest") return Promise.resolve({ digest: away ? DIGEST : null });
      if (cap === "devices.presence") return Promise.resolve(PRESENCE);
      if (cap === "engine.now") return Promise.resolve(WORKING);
      return s.call(cap, input);
    },
  };
}

const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_priya: "Priya Raman", usr_omar: "Omar Haddad", usr_maya: "Maya Chen", usr_lena: "Lena Brandt", agt_intake: "Intake", agt_docs: "Docs", agt_billing: "Billing" };
const ROWS: Record<string, unknown> = {
  "access.principals.list": { principals: [
    { id: "usr_irfad", kind: "person", name: "Irfad Imtiaz", status: "active", roles: ["rol_owner"], groups: ["grp_everyone"], createdAt: SAMPLE_NOW - 90 * 24 * HOUR },
    { id: "usr_priya", kind: "person", name: "Priya Raman", status: "active", roles: ["rol_admin"], groups: ["grp_everyone", "grp_sales"], createdAt: SAMPLE_NOW - 60 * 24 * HOUR },
    { id: "usr_omar", kind: "person", name: "Omar Haddad", status: "active", roles: ["rol_member"], groups: ["grp_everyone", "grp_sales"], createdAt: SAMPLE_NOW - 30 * 24 * HOUR },
    { id: "usr_lena", kind: "person", name: "Lena Brandt", status: "active", roles: ["rol_member"], groups: ["grp_everyone"], createdAt: SAMPLE_NOW - 3 * HOUR },
  ] },
  "access.roles.list": { roles: [{ id: "rol_owner", name: "Owner" }, { id: "rol_admin", name: "Admin" }, { id: "rol_member", name: "Member" }, { id: "rol_guest", name: "Guest" }] },
  "access.groups.list": { groups: [{ id: "grp_everyone", name: "Everyone", members: [] }, { id: "grp_sales", name: "Sales", members: [] }, { id: "grp_intake", name: "Intake team", members: [] }] },
  "members.invites.list": { invites: [], total: 0 },
  "access.groups.defaults_get": { groupId: "grp_everyone", grants: [{ resource: { type: "agent", id: "agt_intake" }, level: "use" }, { resource: { type: "vault_item", id: "vit_webhook" }, level: "use" }] },
  "channels.home": { channel: { channelId: "chn_vyre", name: "vyre", mainThreadId: "thr_vyre", legacy: false } },
  "channels.list": { channels: [
    { channelId: "chn_vyre", mainThreadId: "thr_vyre", name: "vyre", visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 1 },
    { channelId: "chn_sales", mainThreadId: "thr_sales", name: "sales", visibility: "public", archived: false, members: [], agents: [], unread: 0, createdAt: 2 },
    { channelId: "chn_intake", mainThreadId: "thr_intake", name: "intake", visibility: "invite", archived: false, members: [], agents: [], unread: 0, createdAt: 3 },
  ] },
  "projects.list": { projects: [{ projectId: "prj_rivera", recordId: "rec_rivera", type: "matter", title: "Rivera matter", status: "active", channelId: "chn_rivera", folderId: "fld_rivera", memberCount: 3, openTasks: 4, lateTasks: 0 }] },
  "agents.list": { agents: [
    { agentId: "agt_intake", name: "Intake", kind: "agent", face: "intake", status: "awake", ownerId: "usr_irfad", folderId: "fld_a1", accountPolicy: "asker", accountFallback: [] },
    { agentId: "agt_docs", name: "Docs", kind: "agent", face: "docs", status: "awake", ownerId: "usr_irfad", folderId: "fld_a2", accountPolicy: "asker", accountFallback: [] },
    { agentId: "agt_billing", name: "Billing", kind: "agent", face: "billing", status: "asleep", ownerId: "usr_priya", folderId: "fld_a3", accountPolicy: "asker", accountFallback: [] },
  ] },
  "vault.items.list": { items: [{ id: "vit_webhook", name: "Team webhook", kind: "api_key", folderId: "vfd_team", owner: "usr_irfad", scope: "shared", fieldKeys: ["key"], handle: "#Team_webhook", spaceOnly: false, injectIntoDeployments: false, yourLevel: "manage", label: 1 }, { id: "vit_stripe", name: "Stripe", kind: "api_key", folderId: "vfd_team", owner: "usr_irfad", scope: "shared", fieldKeys: ["key"], handle: "#Stripe", spaceOnly: false, injectIntoDeployments: false, yourLevel: "manage", label: 1 }], counts: {} },
  "skills.list": { skills: [{ name: "intake-rules", description: "How we take a new matter.", tier: "space", source: "upload", system: false, enabled: true, bytes: 420 }] },
  "schema.types.list": { types: [{ key: "contact", title: "Contact", plural: "Contacts", icon: "person", label: "internal", system: true, rowCount: 214, fieldCount: 12 }, { key: "matter", title: "Matter", plural: "Matters", icon: "briefcase", label: "internal", system: false, rowCount: 38, fieldCount: 20 }] },
  "files.list": { files: [], folders: [{ folderId: "fld_firm", name: "Firm templates", path: "Firm templates", fileCount: 12, folderCount: 2, scope: "space", label: 1 }] },
};

function consoleData(): ConsoleData {
  const c = createSampleConsole();
  const base = overviewFor(false);
  c.replica.resolve("console.overview", () => ({
    ...base, health: "healthy",
    attention: [
      { kind: "join_stuck", title: "Lena Brandt is missing Channel #intake", ref: "usr_lena", since: SAMPLE_NOW - 3 * HOUR, next: "Vyre was not allowed to do it. Retry, or fix it by hand." },
      { kind: "home_channel", title: "Your first channel is #general", ref: "chn_general", since: SAMPLE_NOW, next: "New Spaces call it #vyre. Rename it, or keep #general." },
    ],
  }));
  const rows = (cap: string): unknown => ROWS[cap];
  return {
    ...c.data,
    name: (id) => NAMES[id] ?? c.data.name(id),
    call: async (cap) => (cap === "devices.presence" ? PRESENCE : cap === "engine.now" ? WORKING : rows(cap) ?? {}),
    screens: { ...c.data.screens, capQuery: (cap: string) => { const v = rows(cap); const state = v === undefined ? { status: "loading" } : { status: "ready", data: v }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never,
  };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "chats"), []);
  const away = useMemo(() => chats(true), []);
  const quiet = useMemo(() => chats(false), []);
  const cons = useMemo(() => consoleData(), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "chats" || part === "chats-quiet") {
    return <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}><View style={{ width: 272, flexShrink: 0 }}><ChatsSidebar data={part === "chats" ? away : quiet} window={{ start: 0, end: 500 }} /></View><View style={{ flex: 1 }} /></View>;
  }
  if (part === "menu") {
    return <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}><View style={{ width: 56, paddingTop: 12, alignItems: "center", backgroundColor: "var(--rail)" as string }}><SpaceTile spaces={SEED_DEFS} openId="nw" away={false} onSwitch={() => undefined} onAction={() => undefined} /></View><View style={{ flex: 1 }} /></View>;
  }
  return <ConsoleDataProvider value={cons}><View style={{ flex: 1, minHeight: 900, padding: 24, backgroundColor: "var(--win)" as string }}>{part === "overview" ? <Overview /> : <People />}</View></ConsoleDataProvider>;
}
