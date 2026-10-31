// The Chats right pane (spec 3.2, 2.7, 3.0): it belongs to whoever you talk to. Five quiet tabs in the shared tab strip, with the one pane toggle at the far left of the header
// (ui/SidePane): Computer, Threads, Files, Knows (it was Memory: the same facts with Accept, Correct and Remove, now with what the Space and you know too), Routines. It follows the agent of the open chat; the width belongs to the pane, not to a tab, so switching tabs never moves
// the edge. Every change says so in one quiet line at the foot, with Undo where it can be taken back.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { useKnowsFocus } from "../memory/data.tsx";
import type { ChatMemoryData } from "../memory/data.tsx";
import { RightPaneDataProvider, useOnline, useOptionalPaneData, usePaneData, useScreenQuery } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { ComputerTab } from "./ComputerTab.tsx";
import { FilesTab } from "./FilesTab.tsx";
import { MemoryTab } from "./MemoryTab.tsx";
import { KnowsTab } from "../memory/KnowsTab.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";
import { TerminalPaneTab } from "./TerminalPaneTab.tsx";
import { ThreadsTab, AGENT_PAGE_SCREEN } from "./ThreadsTab.tsx";
import { DEFAULT_TAB, PANE_KEY, PANE_WIDTH_GUESS, TABS, tabsOf } from "./model.ts";
import { TabMeasure, useFittedTabs, useTitleWidths } from "./fit.tsx";
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
  /** Pins the width the tab strip is fitted to (tests and screenshots); the shell leaves it out and the pane measures itself. */
  paneWidth?: number;
  /** Opens one routine on the Routines tab (tests and screenshots). */
  openRoutine?: string;
}

/** "Show what the agent knew here" on a message pins the store's Knows focus and asks for the tab: switch to it (also when the pane opens because of the request). */
function useKnowsRequest(store: ChatMemoryData["store"] | undefined, show: () => void): void {
  const seq = useKnowsFocus(store ?? null).seq;
  useEffect(() => { if (store && store.takeKnowsRequest()) show(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, seq]);
}

export const NOTICE_MS = 8000;
/** What the pane header holds besides tabs: the toggle, the strip's padding and the options button. */
export const PANE_CHROME = 56;
const withMore = (w: ReadonlyMap<string, number>): ReadonlyMap<string, number> => new Map(w).set("More", 14).set("More tabs", 14);
/** A pane tab is pinned and tight: no close slot, so it adds 7 + 7 padding, 2 border and the 2 px between tabs around its text, not TAB_EXTRA's 45. */
export const PANE_TAB_EXTRA = 16;
/** The prototype's pane: 340 px, room for Computer, Threads, Files and Knows with its count; Routines waits behind More at this width. */
export const WIDE_PANE_W = 340;
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

function PaneView({ open, onToggle, tab: controlled, initialTab, onTab, window, paneWidth, openRoutine }: ChatRightPaneProps): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  // a Personal Space has no agent computers: there is no Computer tab to show and the pane opens on Threads
  const personal = data.space.personal;
  const [own, setOwn] = useState<TabKey>(initialTab ?? (personal ? "threads" : DEFAULT_TAB));
  const tab = personal && (controlled ?? own) === "computer" ? "threads" : controlled ?? own;
  useKnowsRequest(data.memory?.store, (): void => { setOwn("memory"); onTab?.("memory"); });
  const [paneW, setPaneW] = useState(PANE_WIDTH_GUESS);
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
  const summaryQ = useScreenQuery<CapMap["agents.summary"]["out"]>(AGENT_PAGE_SCREEN, "summary", { agentId: data.agent.agentId });
  const facts = summaryQ.status === "ready" ? summaryQ.data.memoryFacts : 0;
  const tabs = useMemo(() => tabsOf(data.terminal !== undefined).filter((t) => !(personal && t.key === "computer")).map((t) => ({ ...t, pinned: true, ...(t.key === "memory" && facts > 0 ? { title: `Knows ${facts}` } : {}) })), [facts, personal, data.terminal]);
  const titles = useTitleWidths();
  const paneNow = paneWidth ?? (narrow ? win.width : paneW);
  const { strip, select } = useFittedTabs(tabs, tab, paneNow, {
    extra: PANE_TAB_EXTRA, chrome: PANE_CHROME, ...(titles.widths.size > 0 ? { chevron: true } : {}), menu, left: Math.max(0, win.width - paneNow) + 40, top: 118, measured: withMore(titles.widths),
    pick: (key) => { setOwn(key); onTab?.(key); },
  });
  /** The pane's top row: the open item as a tab, the agent with its face and a close x, as the prototype draws it above the agent's header. */
  const openTab = { key: "open", title: data.agent.name, lead: <Face name={data.agent.name} size={16} /> };
  const moreMenu = (x: number, y: number): void => {
    menu.show([
      { label: `Open ${data.agent.name}'s Page`, onSelect: () => data.nav.openAgentPage(data.agent.agentId) },
      { label: "Chat With It", onSelect: () => data.nav.openThread(data.threadId, "here") },
    ], x, y, "other");
  };

  return (
    <SidePane
      paneKey={PANE_KEY} toggle={{ open, onPress: onToggle }} title={data.agent.name} tabs={[openTab]} activeTab="open" onSelectTab={() => undefined} onCloseTab={onToggle}
      {...(narrow ? { max: 1, defaultWidth: win.width } : { defaultWidth: WIDE_PANE_W })}
    >
      <View testID="chats-right-pane" style={st.root} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== paneW) setPaneW(w); }}>
        <TabMeasure titles={tabs.map((x) => x.title)} onWidth={titles.set} />
        <View testID="pane-agent" style={st.who}>
          <Face name={data.agent.name} seedId={data.agent.agentId} size={30} pulse={agent?.status === "working"} />
          <View style={st.whoText}>
            <Text numberOfLines={1} style={st.name}>{data.agent.name}</Text>
            {agent?.role ? <Text numberOfLines={1} style={st.role}>{agent.role}</Text> : null}
          </View>
          <Tool icon="more" label="More" onPress={moreMenu} testID="pane-more" />
        </View>
        <TabStrip tabs={strip} active={tab} onSelect={select} tight bare label={`${data.agent.name}'s tabs`} />
        {online ? null : <Text testID="pane-offline" style={st.offline}>Offline. Showing what this device keeps.</Text>}
        <View testID={`pane-body-${tab}`} style={st.body}>
          {tab === "computer" ? <ComputerTab deps={deps} {...(window ? { window } : {})} /> : null}
          {tab === "threads" ? <ThreadsTab deps={deps} {...(window ? { window } : {})} /> : null}
          {tab === "files" ? <FilesTab deps={deps} folderId={agent?.folderId ?? ""} {...(window ? { window } : {})} /> : null}
          {tab === "terminal" && data.terminal ? <TerminalPaneTab data={data.terminal} /> : null}
          {tab === "memory" ? (data.memory ? <KnowsTab deps={deps} memory={data.memory} spaceName={data.space.name} {...(window ? { window } : {})} /> : <MemoryTab deps={deps} spaceName={data.space.name} {...(window ? { window } : {})} />) : null}
          {tab === "routines" ? <RoutinesTab deps={deps} {...(window ? { window } : {})} {...(openRoutine ? { initial: { routineId: openRoutine } } : {})} /> : null}
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
