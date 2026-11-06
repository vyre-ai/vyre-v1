// Mount for the Computer tab in the workspace model (l-capacity): a Terminal section (the agent's workspace) and a Browser section (its profile in the Space browser), over the sample Space with
// stubbed workspace and browser data, the way the workspace and Space browser work will bind them.
//   ?part=running (both up, sessions, a login), asleep (workspace asleep, browser closed), waiting (the host is full: the plain line), takeover (you are in control of its browser), member (a person who may
//   not attach or take over), terminal-only (the Space browser is not bound yet), starting
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { createSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import type { ChatRightPaneData } from "../../../apps/app/src/places/chats/rightpane/data.tsx";
import type { BrowserData, BrowserView, WorkspaceData, WorkspaceView } from "../../../apps/app/src/places/chats/rightpane/work-model.ts";

export const title = "Computer tab: Terminal and Browser";

const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";
const SITES = [
  { site: "app.clio.com", signedInAs: "intake@northwind.example", since: Date.UTC(2026, 9, 28) },
  { site: "mail.google.com", signedInAs: "dex@northwind.example", since: Date.UTC(2026, 10, 2) },
];
const SESSIONS = [{ name: "main", windows: 2, attached: 0 }, { name: "dev server", windows: 1, attached: 1 }, { name: "tests", windows: 1, attached: 0 }];

const VIEWS: Record<string, { ws: WorkspaceView | null; br: BrowserView | null }> = {
  running: {
    ws: { state: "running", host: "Northwind server", canAttach: true, sessions: SESSIONS, projects: ["Client portal launch", "Northwind renewal"] },
    br: { state: "open", host: "Northwind server", tabs: 3, caption: "Reading the intake form on app.clio.com", canTakeOver: true, sites: SITES },
  },
  asleep: {
    ws: { state: "asleep", host: "Northwind server", canAttach: true, sessions: SESSIONS.slice(0, 1).map((s) => ({ ...s, attached: 0 })), projects: ["Client portal launch"] },
    br: { state: "closed", host: "Northwind server", canTakeOver: true, sites: SITES },
  },
  starting: {
    ws: { state: "starting", host: "Northwind server", canAttach: true, sessions: [] },
    br: { state: "starting", host: "Northwind server", canTakeOver: true, sites: SITES },
  },
  waiting: {
    ws: { state: "waiting", host: "Northwind server", line: LINE, canAttach: true, sessions: [] },
    br: { state: "waiting", host: "Northwind server", line: LINE, canTakeOver: true, sites: SITES },
  },
  takeover: {
    ws: { state: "running", host: "Northwind server", canAttach: true, sessions: SESSIONS, projects: ["Client portal launch"] },
    br: { state: "takeover", host: "Northwind server", tabs: 2, mine: true, takenBy: "You", canTakeOver: true, sites: SITES },
  },
  member: {
    ws: { state: "running", host: "Northwind server", canAttach: false, cannotAttach: "A team agent's terminal is for owners and admins.", sessions: SESSIONS.slice(0, 2), projects: ["Client portal launch"] },
    br: { state: "open", host: "Northwind server", tabs: 3, canTakeOver: false, cannotTakeOver: "A team agent's browser is for owners and admins.", sites: SITES },
  },
  "terminal-only": {
    ws: { state: "running", host: "Northwind server", canAttach: true, sessions: SESSIONS, projects: ["Client portal launch"] },
    br: null,
  },
};

function bind(ws: WorkspaceView | null, br: BrowserView | null): { workspace?: WorkspaceData; browser?: BrowserData } {
  const none = async (): Promise<void> => undefined;
  return {
    ...(ws ? { workspace: { watch: (_a: string, on: (v: WorkspaceView) => void) => { on(ws); return () => undefined; }, wake: none, attach: none } } : {}),
    ...(br ? { browser: { watch: (_a: string, on: (v: BrowserView) => void) => { on(br); return () => undefined; }, open: none, takeOver: none, giveBack: none, signOut: none } } : {}),
  };
}

function Pane({ part }: { part: string }): ReactNode {
  const s = useMemo(() => createSample("northwind"), []);
  const v = VIEWS[part] ?? VIEWS["running"]!;
  const data: ChatRightPaneData = useMemo(() => ({ ...s.data, agent: { agentId: s.data.agent.agentId, name: s.data.agent.name }, ...bind(v.ws, v.br) }), [s, v]);
  return <View style={{ flex: 1, alignItems: "flex-end", backgroundColor: "var(--win)" as string }}><ChatRightPane data={data} open onToggle={() => undefined} initialTab="computer" window={{ start: 0, end: 500 }} /></View>;
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "running"), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Pane part={part} />;
}
