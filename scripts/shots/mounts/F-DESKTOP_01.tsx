// Mount for the f-desktop lane: Console > Computers > Agent computers (the old per-agent desktops) over a sample with one old desktop that is asleep and one that works. The page lists, wakes,
// sleeps and removes them; it never offers to make a new one.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { AgentComputers } from "../../../apps/app/src/console/pages/Agents.tsx";

export const title = "Console: Agent computers";

const ROWS: Record<string, unknown> = {
  "computers.health": { state: "healthy", runtime: "ready", awake: 1, asleep: 1 },
  "computers.list": { total: 2, computers: [
    { computerId: "cmp_dex", agentId: "agt_dex", state: "asleep", tabs: 0, tabLimit: 8, idleSleepMinutes: 10, host: "server", createdAt: 1_760_000_000_000, recording: false },
    { computerId: "cmp_scout", agentId: "agt_scout", state: "working", caption: "Scout's computer", tabs: 3, tabLimit: 8, idleSleepMinutes: 10, host: "server", createdAt: 1_760_000_000_000, recording: false },
  ] },
  "agents.list": { agents: [
    { agentId: "agt_dex", name: "Dex", status: "active", hasComputer: true, ownerId: "usr_irfad", folderId: "f" },
    { agentId: "agt_scout", name: "Scout", status: "active", hasComputer: true, ownerId: "usr_irfad", folderId: "f" },
    { agentId: "agt_docs", name: "Docs Writer", status: "active", hasComputer: false, ownerId: "usr_irfad", folderId: "f" },
  ] },
};

export default function Mount(): ReactNode {
  const data = useMemo<ConsoleData>(() => {
    const sample = createSampleConsole().data;
    return { ...sample, screens: { ...sample.screens, capQuery: (cap: string) => { const v = { status: "ready", data: ROWS[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => v }; } } as never };
  }, []);
  return <View style={{ flex: 1, padding: 24 }}><ConsoleDataProvider value={data}><AgentComputers /></ConsoleDataProvider></View>;
}
