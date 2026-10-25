// The Chats right pane (spec 3.2, 2.7, 3.0): it belongs to whoever you talk to. Five quiet tabs in the shared tab strip, with the one pane toggle at the far left of the header
// (ui/SidePane): Computer, Threads, Files, Memory, Routines. It follows the agent of the open chat; the width belongs to the pane, not to a tab, so switching tabs never moves
// the edge. Every change says so in one quiet line at the foot, with Undo where it can be taken back.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { RightPaneDataProvider, useOnline, useOptionalPaneData, usePaneData, useScreenQuery } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { ComputerTab } from "./ComputerTab.tsx";
import { FilesTab } from "./FilesTab.tsx";
import { MemoryTab } from "./MemoryTab.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";
import { ThreadsTab, AGENT_PAGE_SCREEN } from "./ThreadsTab.tsx";
import { DEFAULT_TAB, PANE_KEY, TABS, isTabKey } from "./model.ts";
import type { TabKey } from "./model.ts";
import { Face, Notice, Tool } from "./parts.tsx";

type AgentOut = CapMap["agents.get"]["out"];

export interface ChatRightPaneProps {
  /** The data context; the shell wraps the pane in a provider instead when it shares one. */
  data?: ChatRightPaneData;
  /** The pane toggle's state belongs to the shell: it also drives the chat header's button, which hides while this pane is open. */
  open: boolean;
  onToggle: () => void;
  /** The tab shown. Leave `tab` out and the pane keeps its own; `initialTab` is where it starts. */
  tab?: TabKey;
  initialTab?: TabKey;
  onTab?: (tab: TabKey) => void;
  /** Pins which rows are drawn (tests and screenshots draw them all); the shell leaves it out and the lists window by scroll. */
  window?: VirtualWindow;
}

export const NOTICE_MS = 8000;
/** Below this window width the pane fills it (a phone shows it as a screen of its own); above, it is a resizable column. */
export const NARROW = 640;

export function ChatRightPane(props: ChatRightPaneProps): ReactElement {
  const ctx = useOptionalPaneData();
  const value = props.data ?? ctx;
  if (!value) return <ChatRightPaneLoading open={props.open} onToggle={props.onToggle} />;
  return <RightPaneDataProvider value={value}><PaneView {...props} /></RightPaneDataProvider>;
}

/** The frame before data: the pane header and a body the size of the real one, so nothing moves when the data arrives. */
export function ChatRightPaneLoading({ open, onToggle }: { open: boolean; onToggle: () => void }): ReactElement {
  return (
    <SidePane paneKey={PANE_KEY} toggle={{ open, onPress: onToggle }} title="Agent" tabs={TABS} activeTab={DEFAULT_TAB}>
      <View testID="right-pane-loading" accessibilityLabel="Loading" style={st.sk}><View style={st.skFace} /><View style={st.skScreen} /></View>
    </SidePane>
  );
}

function PaneView({ open, onToggle, tab: controlled, initialTab, onTab, window }: ChatRightPaneProps): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  const [own, setOwn] = useState<TabKey>(initialTab ?? DEFAULT_TAB);
  const tab = controlled ?? own;
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<void> | void } | null>(null);
  const deps: PaneDeps = useMemo(() => ({
    call: data.call,
    note: (text: string, undo?: () => Promise<void> | void) => setNotice(undo ? { text, undo } : { text }),
  }), [data.call]);
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const agentQ = useScreenQuery<AgentOut>(AGENT_PAGE_SCREEN, "agent", { agentId: data.agent.agentId });
  const agent = agentQ.status === "ready" ? agentQ.data.agent : null;
  const select = (key: string): void => {
    if (!isTabKey(key)) return;
    setOwn(key);
    onTab?.(key);
  };
  const moreMenu = (x: number, y: number): void => {
    menu.show([
      { label: `Open ${data.agent.name}'s Page`, onSelect: () => data.nav.openAgentPage(data.agent.agentId) },
      { label: "Chat With It", onSelect: () => data.nav.openThread(data.threadId, "here") },
    ], x, y, "other");
  };

  return (
    <SidePane paneKey={PANE_KEY} toggle={{ open, onPress: onToggle }} title={data.agent.name} tabs={TABS} activeTab={tab} onSelectTab={select} {...(narrow ? { max: 1, defaultWidth: win.width } : {})}>
      <View testID="chats-right-pane" style={st.root}>
        <View testID="pane-agent" style={st.who}>
          <Face name={data.agent.name} size={30} pulse={agent?.status === "working"} />
          <View style={st.whoText}>
            <Text numberOfLines={1} style={st.name}>{data.agent.name}</Text>
            {agent?.role ? <Text numberOfLines={1} style={st.role}>{agent.role}</Text> : null}
          </View>
          <Tool icon="more" label="More" onPress={moreMenu} testID="pane-more" />
        </View>
        {online ? null : <Text testID="pane-offline" style={st.offline}>Offline. Showing what this device keeps.</Text>}
        <View testID={`pane-body-${tab}`} style={st.body}>
          {tab === "computer" ? <ComputerTab deps={deps} {...(window ? { window } : {})} /> : null}
          {tab === "threads" ? <ThreadsTab deps={deps} {...(window ? { window } : {})} /> : null}
          {tab === "files" ? <FilesTab deps={deps} folderId={agent?.folderId ?? ""} {...(window ? { window } : {})} /> : null}
          {tab === "memory" ? <MemoryTab deps={deps} spaceName={data.space.name} {...(window ? { window } : {})} /> : null}
          {tab === "routines" ? <RoutinesTab deps={deps} {...(window ? { window } : {})} /> : null}
        </View>
        {notice ? <Notice text={notice.text} onClose={() => setNotice(null)} {...(notice.undo ? { onUndo: () => { const u = notice.undo; setNotice(null); void u?.(); } } : {})} /> : null}
        {menu.element}
      </View>
    </SidePane>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--side)" as string },
  who: { height: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10 },
  whoText: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  role: { fontSize: 12, color: "var(--ink-3)" as string },
  offline: { paddingHorizontal: 12, paddingBottom: 4, fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { flex: 1, minHeight: 0 },
  sk: { padding: 10, gap: 12 },
  skFace: { width: 30, height: 30, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skScreen: { height: 150, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
