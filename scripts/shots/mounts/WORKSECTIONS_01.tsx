// Mount for the Computer tab in the workspace model (l-capacity): a Terminal section (the agent's workspace) and a Browser section (its profile in the Space browser), over the sample Space with
// stubbed workspace and browser data, the way the workspace and Space browser work will bind them.
//   ?part=running (both up, sessions, a login), asleep (workspace asleep, browser closed), waiting (the host is full: the plain line), takeover (you are in control of its browser), member (a person who may
//   not attach or take over), terminal-only (the Space browser is not bound yet), starting. &old=1 keeps the agent's older desktop computer (the row that opens it).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { BrowserLive } from "../../../apps/app/src/places/chats/rightpane/BrowserLive.tsx";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { createSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import type { ChatRightPaneData } from "../../../apps/app/src/places/chats/rightpane/data.tsx";
import type { BrowserData, BrowserView, WorkspaceData, WorkspaceView } from "../../../apps/app/src/places/chats/rightpane/work-model.ts";

export const title = "Computer tab: Terminal and Browser";

// A page the browser might be showing, as the picture the stream would carry (MJPEG frames are JPEGs; an SVG data address stands in so the shot needs no browser service).
const PAGE = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#f7f7fa"/><rect width="1280" height="64" fill="#fff"/><rect x="40" y="20" width="160" height="24" rx="6" fill="#d9d8e6"/><rect x="1060" y="18" width="180" height="28" rx="14" fill="#5b57d6"/><text x="80" y="170" font-family="Helvetica" font-size="44" font-weight="700" fill="#1c1b29">New matter intake</text><rect x="80" y="220" width="520" height="56" rx="8" fill="#fff" stroke="#cfcedb"/><text x="100" y="256" font-family="Helvetica" font-size="24" fill="#1c1b29">Northwind Holdings LLC</text><rect x="80" y="310" width="520" height="56" rx="8" fill="#fff" stroke="#cfcedb"/><text x="100" y="346" font-family="Helvetica" font-size="24" fill="#8a89a0">Contact email</text><rect x="80" y="400" width="520" height="140" rx="8" fill="#fff" stroke="#cfcedb"/><rect x="80" y="580" width="200" height="56" rx="10" fill="#5b57d6"/><text x="118" y="616" font-family="Helvetica" font-size="24" fill="#fff">Create matter</text><rect x="700" y="220" width="480" height="420" rx="12" fill="#ececf4"/></svg>`);
const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";
const SITES = [
  { site: "app.clio.com", signedInAs: "intake@northwind.example", since: Date.UTC(2026, 9, 28) },
  { site: "mail.google.com", signedInAs: "dex@northwind.example", since: Date.UTC(2026, 10, 2) },
];
const SESSIONS = [{ name: "main", owner: { kind: "agent" as const }, windows: 2, attached: 0 }, { name: "tests", owner: { kind: "helper" as const, name: "Tess" }, windows: 1, attached: 0 }, { name: "dev server", owner: { kind: "person" as const, name: "Maya" }, windows: 1, attached: 1 }];

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

const live = (agentId: string, o: { state: string; control: boolean }): ReactNode => (
  o.control
    // the controlled view draws frames from a WebSocket the shots app does not have: its picture stands in
    ? <Image accessibilityLabel="Live view" source={{ uri: PAGE }} resizeMode="contain" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
    : <BrowserLive agentId={agentId} control={false} call={async () => ({ url: PAGE })} />
);

function bind(ws: WorkspaceView | null, br: BrowserView | null): { workspace?: WorkspaceData; browser?: BrowserData } {
  const none = async (): Promise<void> => undefined;
  return {
    ...(ws ? { workspace: { watch: (_a: string, on: (v: WorkspaceView) => void) => { on(ws); return () => undefined; }, wake: none, attach: none } } : {}),
    ...(br ? { browser: { watch: (_a: string, on: (v: BrowserView) => void) => { on(br); return () => undefined; }, open: none, takeOver: none, giveBack: none, signOut: none, renderLive: (a, o) => live(a, o) as never } } : {}),
  };
}

function Pane({ part, old }: { part: string; old: boolean }): ReactNode {
  const s = useMemo(() => createSample("northwind"), []);
  const v = VIEWS[part] ?? VIEWS["running"]!;
  const data: ChatRightPaneData = useMemo(() => ({ ...s.data, agent: old ? s.data.agent : { agentId: s.data.agent.agentId, name: s.data.agent.name }, ...bind(v.ws, v.br) }), [s, v, old]);
  return <View style={{ flex: 1, alignItems: "flex-end", backgroundColor: "var(--win)" as string }}><ChatRightPane data={data} open onToggle={() => undefined} initialTab="computer" window={{ start: 0, end: 500 }} /></View>;
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  const [old, setOld] = useState(false);
  useEffect(() => { const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""); setPart(q.get("part") ?? "running"); setOld(q.get("old") === "1"); }, []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Pane part={part} old={old} />;
}
