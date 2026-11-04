// Mount for MENUSB_01 (lane l-chrome2a): the right-click menus of Vault items, automations, goals, projects, tabs and the Console rows, each place over its own sample, so the shoot can right-click a row and show the menu of
// that kind. ?part= vault | auto | goal | project | tabs | console
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault } from "../../../apps/app/src/places/vault/layout/sample.ts";
import { AutomationsSidebar } from "../../../apps/app/src/places/automations/sidebar/AutomationsSidebar.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { createSampleAutomations, northwind as autoNorthwind } from "../../../apps/app/src/places/automations/sidebar/sample.ts";
import { GoalPage } from "../../../apps/app/src/places/chats/goals/GoalPage.tsx";
import { goalsCall } from "../../../apps/app/src/places/chats/goals/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../../apps/app/src/places/records/projectpage/index.ts";
import { createSampleProject } from "../../../apps/app/src/places/records/projectpage/sample.ts";
import { MainTabs } from "../../../apps/app/src/shell/tabs/MainTabs.tsx";
import { createTabsController } from "../../../apps/app/src/shell/tabs/store.ts";
import { ObjectList } from "../../../apps/app/src/console/objects/ObjectList.tsx";
import { groupRowActions, personRowActions, roleRowActions } from "../../../apps/app/src/console/objects/row-menus.ts";
import { createMenuApiB } from "../../../apps/app/src/places/chats/menus/actions-b.ts";
import { MachineList } from "../../../apps/app/src/machines/MachinesView.tsx";
import type { MachineRow } from "../../../apps/app/src/machines/model.ts";
import type { ConversationData } from "../../../apps/app/src/places/chats/conversation/data.tsx";

export const title = "Right-click menus: Vault, automations, goals, projects, tabs, Console";
const NOW = Date.UTC(2026, 10, 3, 5, 0);

function Frame({ children, width = 760 }: { children: ReactNode; width?: number }): ReactNode {
  return <View style={{ flex: 1, minHeight: 640, backgroundColor: "var(--win)" as string, alignItems: "flex-start" }}><View style={{ width, flex: 1, minHeight: 600 }}>{children}</View></View>;
}

function ConsoleRows(): ReactNode {
  const api = createMenuApiB({ call: async () => ({}) });
  const d = { api, can: () => true, open: () => undefined, done: () => undefined, fail: () => undefined, rename: () => undefined };
  const rows = [
    { id: "p1", title: "Sara Lindqvist", note: "Active · Member · 2 groups", actions: personRowActions({ id: "usr_sara", name: "Sara Lindqvist", status: "active", roles: ["rol_member"] }, "usr_me", d) },
    { id: "g1", title: "Sales", note: "6 members · 1 manager", actions: groupRowActions({ id: "grp_sales", name: "Sales", builtIn: false }, d) },
    { id: "r1", title: "Editor", note: "3 holders · internal", actions: roleRowActions({ id: "rol_editor", name: "Editor", builtIn: false, holders: 0 }, d) },
  ];
  return <Frame width={560}><ObjectList rows={rows} selectedId={null} onOpen={() => undefined} empty="none" /></Frame>;
}

const mrow = (o: Partial<MachineRow> & { serverId: string; name: string }): MachineRow => ({ kind: "server", mine: false, state: "healthy", online: true, private: false, runs: { turns: 1, agentComputers: 0, sites: 0, automations: 0 }, can: ["claude_code", "docker"], room: { n: 60, why: "" }, limits: { maxTurns: null, maxAgentComputers: null }, drain: false, pins: [], version: "1.4.1", os: "Debian 12", arch: "x64", cores: 4, memBytes: 8e9, diskBytes: 160e9, latencyMs: 34, load: { cpu: 21, memPct: 51, diskPct: 40, diskFreeBytes: 96e9 }, ...o }) as MachineRow;
function Machines(): ReactNode {
  const ms = [mrow({ serverId: "space", name: "Northwind server", kind: "space" }), mrow({ serverId: "srv_box", name: "Berlin box", nickname: "Berlin" }), mrow({ serverId: "dev_maya", name: "Maya's MacBook Air", kind: "linked", owner: "usr_maya", private: true })];
  return <Frame width={1100}><MachineList data={{ machines: ms, waiting: [], alerts: [], admin: true, now: NOW }} who={(id) => id} narrow={false} now={NOW} onOpen={() => undefined} onAdd={() => undefined} scope="space" call={async () => ({})} reload={async () => undefined} /></Frame>;
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "vault"), []);
  const vault = useMemo(() => createSampleVault(), []);
  const autos = useMemo(() => createSampleAutomations(autoNorthwind), []);
  const goalCall = useMemo(() => { const base = goalsCall(async (cap) => { throw new Error(`no write for ${cap}`); }, NOW, "active"); return async (cap: string, input: unknown): Promise<unknown> => (cap.startsWith("goals.") && cap !== "goals.get" && cap !== "goals.list" ? {} : base(cap, input)); }, []);
  const project = useMemo(() => {
    const s = createSampleProject();
    const base = s.data.call.bind(s.data);
    s.data.call = async (cap: string, input: unknown) => (cap === "projects.members.list" ? { members: [{ principal: "usr_me", role: "lead", kind: "person", since: 0 }] } : cap === "stars.list" ? { stars: [] } : base(cap, input));
    s.data.me = { id: "usr_me", name: "Me" };
    return s;
  }, []);
  const tabs = useMemo(() => { const c = createTabsController({ deviceId: "d", personId: "p", spaceId: "s", storage: null, start: "home" }); c.openPlace("chats"); c.openPlace("files"); c.openPlace("records", "rivera", "Rivera engagement"); c.close("files"); c.select("chats"); return c; }, []);
  if (part === null) return <View style={{ flex: 1 }} />;
  if (part === "vault") return <View style={{ flex: 1, minHeight: 700 }}><Vault data={vault.data} /></View>;
  if (part === "auto") return <Frame width={320}><AutomationsDataProvider value={autos.data}><AutomationsSidebar shared={autos.shared} reasons={autos.space.reasons} /></AutomationsDataProvider></Frame>;
  if (part === "goal") return <Frame width={760}><GoalPage goalId="gol_lab8" call={goalCall} changes={undefined} me="usr_irfad" nameOf={(id) => ({ usr_irfad: "Irfad Imtiaz", agt_labdesk: "Lab Desk" } as Record<string, string>)[id] ?? id} clock={() => ({ now: NOW, offsetMin: 300 })} conversationFor={() => ({}) as ConversationData} openTask={() => undefined} openAgent={() => undefined} pane={false} /></Frame>;
  if (part === "project") return <Frame width={760}><ProjectPageDataProvider value={project.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider></Frame>;
  if (part === "tabs") return <Frame width={760}><MainTabs controller={tabs} onGoToPlace={() => undefined} /></Frame>;
  if (part === "machines") return <Machines />;
  return <ConsoleRows />;
}
