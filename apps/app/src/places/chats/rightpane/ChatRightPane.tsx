// The Chats right pane (spec 3.2, 2.7, 3.0): it belongs to whoever you talk to. Five quiet tabs in the shared tab strip, with the one pane toggle at the far left of the header
// (ui/SidePane): Computer, Threads, Files, Knows (it was Memory: the same facts with Accept, Correct and Remove, now with what the Space and you know too), Routines. It follows the agent of the open chat; the width belongs to the pane, not to a tab, so switching tabs never moves
// the edge. Every change says so in one quiet line at the foot, with Undo where it can be taken back.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
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
import { RightPaneDataProvider, hasComputers, useOnline, useOptionalPaneData, usePaneData, useScreenQuery } from "./data.tsx";
import type { ChatRightPaneData, RightPaneNav } from "./data.tsx";
import { COMPUTER_SCREEN, ComputerTab } from "./ComputerTab.tsx";
import { AboutTab } from "./AboutTab.tsx";
import { ProfileHeader, roleLine } from "./ProfileHeader.tsx";
import type { HeaderAction, Presence } from "./ProfileHeader.tsx";
import { sleep } from "./actions.ts";
import { FilesTab } from "./FilesTab.tsx";
import { MemoryTab } from "./MemoryTab.tsx";
import { KnowsTab } from "../memory/KnowsTab.tsx";
import { RoutinesTab } from "./RoutinesTab.tsx";
import { TerminalPaneTab } from "./TerminalPaneTab.tsx";
import { HooksTab } from "./HooksTab.tsx";
import { ThreadsTab, AGENT_PAGE_SCREEN, PANE_SCREEN } from "./ThreadsTab.tsx";
import { CrewTab } from "./CrewTab.tsx";
import { useCrew } from "../crew/context.tsx";
import { SkillsTab } from "../install/SkillsTab.tsx";
import { onOpenSkills } from "../install/open.ts";
import { DEFAULT_TAB, PANE_KEY, PANE_WIDTH_GUESS, TABS, tabsOf } from "./model.ts";
import { TabMeasure, useFittedTabs, useTitleWidths } from "./fit.tsx";
import type { TabKey } from "./model.ts";
import { Face, Notice } from "./parts.tsx";

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
  /** Draw only the pane body, with no side-pane frame: an agent's profile opened as a tab inside another pane. */
  embedded?: boolean;
  /** Start with the Computer tab on the setup of an agent that has no computer yet (what "Give it a computer" in About does). */
  setup?: boolean;
  onTab?: (tab: TabKey) => void;
  /** Pins which rows are drawn (tests and screenshots draw them all); the shell leaves it out and the lists window by scroll. */
  window?: VirtualWindow;
  /** Pins the width the tab strip is fitted to (tests and screenshots); the shell leaves it out and the pane measures itself. */
  paneWidth?: number;
  /** Opens one routine on the Routines tab (tests and screenshots). */
  openRoutine?: string;
  /** What was opened from the chat, after the pane's own: closable right tabs. The shown one replaces the pane's body. */
  extra?: { tabs: readonly { key: string; title: string; lead?: ReactNode }[]; active: string | null; onSelect(key: string | null): void; onClose(key: string): void; body: ReactNode };
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

function PaneView({ open, onToggle, tab: controlled, initialTab, setup: setupFirst, onTab, window, paneWidth, openRoutine, extra, embedded }: ChatRightPaneProps): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  // no capable host, no agent computers: no Computer tab and no offer to set one up
  const noComputers = !hasComputers(data.space);
  const hasComputer = (data.agent.computerId ?? "") !== "";
  // "Give it a computer" in About opens the Computer tab on the setup, until the agent has one
  const [setup, setSetup] = useState(setupFirst === true);
  const showComputer = hasComputer || (setup && !noComputers);
  const [own, setOwn] = useState<TabKey>(initialTab ?? DEFAULT_TAB);
  const wanted = controlled ?? own;
  const tab: TabKey = wanted === "computer" && !showComputer ? "about" : wanted === "terminal" && !hasComputer ? "about" : wanted;
  // Open on an install card: the Skills tab, with that skill lit
  const [lit, setLit] = useState<string | undefined>(undefined);
  // the Skills tab appears once the person has skills (their own, an agent's they own, or shared with them)
  const [hasSkills, setHasSkills] = useState(false);
  useEffect(() => onOpenSkills((name) => { setHasSkills(true); setLit(name); setOwn("skills"); onTab?.("skills"); }), [onTab]);
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
  // the Crew tab appears once teammates work for this chat
  const crewQ = useScreenQuery<CapMap["engine.crew.list"]["out"]>(PANE_SCREEN, "crew", { threadId: data.threadId });
  const crewLive = useCrew();
  const hasCrew = (crewQ.status === "ready" && crewQ.data.jobs.length > 0) || (crewLive?.status?.members.length ?? 0) > 0;
  // "Show it in the pane" on a helper row or the strip: this tab, and nothing else changes
  useEffect(() => { if (crewLive && crewLive.seq > 0) { setOwn("crew"); onTab?.("crew"); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewLive?.seq]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("skills.page", {})).then((p) => { const pg = p as { mine?: unknown[]; shared?: unknown[] } | undefined; if (live) setHasSkills(((pg?.mine?.length ?? 0) + (pg?.shared?.length ?? 0)) > 0); }, () => undefined);
    return () => { live = false; };
  }, [data]);
  const tabs = useMemo(() => tabsOf(data.terminal !== undefined, hasCrew, hasComputer, hasSkills).filter((t) => !(noComputers && t.key === "computer")).map((t) => ({ ...t, pinned: true, ...(t.key === "memory" && facts > 0 ? { title: `Knows ${facts}` } : {}) })), [facts, noComputers, data.terminal, hasCrew, showComputer, hasSkills]);
  const titles = useTitleWidths();
  const paneNow = paneWidth ?? (narrow ? win.width : paneW);
  const { strip, select } = useFittedTabs(tabs, tab, paneNow, {
    extra: PANE_TAB_EXTRA, chrome: PANE_CHROME, dots: true, menu, left: Math.max(0, win.width - paneNow) + 40, top: 118, measured: withMore(titles.widths),
    pick: (key) => { setOwn(key); onTab?.(key); },
  });
  /** The pane's top row: the open item as a tab, the agent with its face and a close x, as the prototype draws it above the agent's header. */
  const openTab = { key: "open", title: data.agent.name, lead: <Face name={data.agent.name} seedId={data.agent.agentId} size={16} /> };
  const inner = (
  <View testID="chats-right-pane" style={[st.root, extra?.active ? st.gone : null]} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== paneW) setPaneW(w); }}>
    <TabMeasure titles={tabs.map((x) => x.title)} onWidth={titles.set} />
    <AgentHeader deps={deps} role={agent?.role} status={agent?.status} menu={menu} />
    <View style={st.tabs}><TabStrip tabs={strip} active={tab} onSelect={select} tight bare underline noOptions label={`${data.agent.name}'s tabs`} /></View>
    {online ? null : <Text testID="pane-offline" style={st.offline}>Offline. Showing what this device keeps.</Text>}
    <View testID={`pane-body-${tab}`} style={st.body}>
      {tab === "about" ? <AboutTab agent={agent} name={data.agent.name} hasComputer={showComputer} {...(!noComputers && !showComputer ? { onGive: () => { setSetup(true); setOwn("computer"); onTab?.("computer"); } } : {})} onOpenFiles={() => { setOwn("files"); onTab?.("files"); }} onOpenKnows={() => { setOwn("memory"); onTab?.("memory"); }} /> : null}
      {tab === "computer" ? <ComputerTab deps={deps} {...(window ? { window } : {})} /> : null}
      {tab === "threads" ? <ThreadsTab deps={deps} {...(window ? { window } : {})} /> : null}
      {tab === "crew" ? <CrewTab deps={deps} {...(window ? { window } : {})} /> : null}
      {tab === "files" ? <FilesTab deps={deps} folderId={agent?.folderId ?? ""} {...(window ? { window } : {})} /> : null}
      {tab === "terminal" && data.terminal ? <TerminalPaneTab data={data.terminal} /> : null}
      {tab === "memory" ? (data.memory ? <KnowsTab deps={deps} memory={data.memory} spaceName={data.space.name} {...(window ? { window } : {})} /> : <MemoryTab deps={deps} spaceName={data.space.name} {...(window ? { window } : {})} />) : null}
      {tab === "skills" ? <SkillsTab deps={deps} {...(data.nameOf ? { nameOf: data.nameOf } : {})} {...(lit ? { highlight: lit } : {})} {...(data.renderShare ? { renderShare: data.renderShare } : {})} /> : null}
      {tab === "routines" ? <RoutinesTab deps={deps} {...(window ? { window } : {})} {...(openRoutine ? { initial: { routineId: openRoutine } } : {})} /> : null}
      {tab === "skills" ? <SkillsTab deps={deps} {...(data.nameOf ? { nameOf: data.nameOf } : {})} {...(lit ? { highlight: lit } : {})} {...(data.renderShare ? { renderShare: data.renderShare } : {})} /> : null}
    </View>
    {notice ? <Notice text={notice.text} onClose={() => setNotice(null)} {...(notice.undo ? { onUndo: () => { const u = notice.undo; setNotice(null); void u?.(); } } : {})} /> : null}
    {menu.element}
  </View>
  );
  if (embedded === true) return inner;
  return (
    <SidePane
      paneKey={PANE_KEY} toggle={{ open, onPress: onToggle }} title={data.agent.name} tabs={[openTab, ...(extra?.tabs ?? [])]} activeTab={extra?.active ?? "open"} onSelectTab={(key) => extra?.onSelect(key === "open" ? null : key)} onCloseTab={(key) => { if (key === "open") onToggle(); else extra?.onClose(key); }}
      {...(narrow ? { max: 1, defaultWidth: win.width } : { defaultWidth: WIDE_PANE_W })}
    >
      {extra?.active ? <View testID="right-tab-body" style={st.root}>{extra.body}</View> : null}
      {inner}
    </SidePane>
  );
}


/** The agent's header: its face with presence, one role line, Message and what the shell can do (Poke, Share), and one "..." menu. Sleep now is in the menu; the Computer tab has no button for it. */
function AgentHeader({ deps, role, status, menu }: { deps: PaneDeps; role: string | undefined; status: string | undefined; menu: ReturnType<typeof useMenu> }): ReactElement {
  const data = usePaneData();
  const computerId = data.agent.computerId ?? "";
  return computerId === "" ? <HeaderBar deps={deps} role={role} status={status} computerState={undefined} menu={menu} /> : <HeaderWithComputer deps={deps} role={role} status={status} computerId={computerId} menu={menu} />;
}

function HeaderWithComputer({ deps, role, status, computerId, menu }: { deps: PaneDeps; role: string | undefined; status: string | undefined; computerId: string; menu: ReturnType<typeof useMenu> }): ReactElement {
  const q = useScreenQuery<CapMap["computers.get"]["out"]>(COMPUTER_SCREEN, "computer", { computerId });
  return <HeaderBar deps={deps} role={role} status={status} computerState={q.status === "ready" ? q.data.computer.state : undefined} menu={menu} />;
}

/** The header's actions for an agent: Message always; Poke and Share only where the shell can do them (a button is never drawn for something that cannot work). */
export function agentActions(nav: Pick<RightPaneNav, "openThread" | "poke" | "share">, threadId: string, agentId: string, name: string): HeaderAction[] {
  return [
    { key: "message", icon: "chat", label: "Message", hint: `Chat with ${name}`, onPress: () => nav.openThread(threadId, "here") },
    ...(nav.poke ? [{ key: "poke", icon: "bolt" as const, label: "Poke", hint: `Ask ${name} to read the latest and answer now`, onPress: () => nav.poke?.(agentId, threadId) }] : []),
    ...(nav.share ? [{ key: "share", icon: "share" as const, label: "Share", hint: `Share ${name}`, onPress: () => nav.share?.(agentId) }] : []),
  ];
}

function HeaderBar({ deps, role, status, computerState, menu }: { deps: PaneDeps; role: string | undefined; status: string | undefined; computerState: string | undefined; menu: ReturnType<typeof useMenu> }): ReactElement {
  const data = usePaneData();
  const name = data.agent.name;
  const presence: Presence = computerState === "asleep" || status === "asleep" ? "asleep" : status === "paused" ? "away" : "on";
  const actions = agentActions(data.nav, data.threadId, data.agent.agentId, name);
  const awake = data.agent.computerId !== undefined && data.agent.computerId !== "" && computerState !== undefined && computerState !== "asleep" && computerState !== "provisioning" && computerState !== "error";
  const more = (x: number, y: number): void => {
    menu.show([
      ...(awake ? [{ label: "Sleep Now", onSelect: () => void sleep(deps, data.agent.computerId ?? "", name) }, { separator: true as const }] : []),
      { label: `Open ${name}'s Page`, onSelect: () => data.nav.openAgentPage(data.agent.agentId) },
    ] as MenuEntry[], x, y, "other");
  };
  return <ProfileHeader name={name} seedId={data.agent.agentId} kind="agent" presence={presence} pulse={status === "working"} line={roleLine("Agent", role)} actions={actions} onMore={more} />;
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--side)" as string },
  gone: { display: "none" },
  tabs: { marginTop: 10, paddingTop: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  offline: { paddingHorizontal: 12, paddingBottom: 4, fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { flex: 1, minHeight: 0 },
  sk: { padding: 10, gap: 12 },
  skFace: { width: 30, height: 30, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skScreen: { height: 150, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
