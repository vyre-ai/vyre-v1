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
import {
  RightPaneDataProvider,
  hasComputers,
  useOnline,
  useOptionalPaneData,
  usePaneData,
  useScreenQuery,
} from "./data.tsx";
import type { ChatRightPaneData, RightPaneNav } from "./data.tsx";
import { COMPUTER_SCREEN } from "./ComputerTab.tsx";
import { ComputerPane } from "./ComputerPane.tsx";
import { WorkSections, usesWorkModel } from "./WorkSections.tsx";
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
import { useSession } from "../session/context.tsx";
import { SessionOverview } from "../session/Overview.tsx";
import { sessionTabs, timeWords } from "../session/model.ts";
import { SkillsTab } from "../install/SkillsTab.tsx";
import { onOpenSkills } from "../install/open.ts";
import { DEFAULT_TAB, OVERVIEW_TAB, PANE_KEY, PANE_WIDTH_GUESS, TABS, kindTabs, tabsOf } from "./model.ts";
import { TabMeasure, useFittedTabs, useTitleWidths } from "./fit.tsx";
import type { PaneKind, TabKey } from "./model.ts";
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
  /**
   * What the chat is. Given, the pane is the chat's own (G5, G6): its tabs follow the kind (agent and group chat: Crew, Computer, Threads, Files, Kept; channel: Threads, Files, Kept, People; one other
   * person: Files, Kept), they sit in the pane's header row beside what was opened from the chat, and there is no agent header above them. Left out, the pane is the agent's profile as it always was.
   */
  kind?: PaneKind;
  /** The People tab's body (who is here), drawn by the shell. Without it the pane has no People tab. */
  people?: ReactNode;
  /** The Kept tab's body (decisions and kept notes), drawn by the lane that owns it. Without it the pane has no Kept tab. */
  kept?: ReactNode;
  /** The hook to show and flash when the Hooks tab was opened from a line in the chat. */
  hookSel?: string | null;
  onTab?: (tab: TabKey) => void;
  /** Pins which rows are drawn (tests and screenshots draw them all); the shell leaves it out and the lists window by scroll. */
  window?: VirtualWindow;
  /** Pins the width the tab strip is fitted to (tests and screenshots); the shell leaves it out and the pane measures itself. */
  paneWidth?: number;
  /** Opens one routine on the Routines tab (tests and screenshots). */
  openRoutine?: string;
  /** What was opened from the chat, after the pane's own: closable right tabs. The shown one replaces the pane's body. */
  /** `first` names the one of these tabs that comes before the pane's own: the thing the chat is (the other person, the channel), ahead of the agent. */
  extra?: {
    first?: string;
    tabs: readonly { key: string; title: string; lead?: ReactNode }[];
    active: string | null;
    onSelect(key: string | null): void;
    onClose(key: string): void;
    body: ReactNode;
  };
}

/** "Show what the agent knew here" on a message pins the store's Knows focus and asks for the tab: switch to it (also when the pane opens because of the request). */
function useKnowsRequest(store: ChatMemoryData["store"] | undefined, show: () => void): void {
  const seq = useKnowsFocus(store ?? null).seq;
  useEffect(() => {
    if (store && store.takeKnowsRequest()) show(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, seq]);
}

export const NOTICE_MS = 8000;
/** What the pane header holds besides tabs: the toggle, the strip's padding and the options button. */
export const PANE_CHROME = 56;
const withMore = (w: ReadonlyMap<string, number>): ReadonlyMap<string, number> =>
  new Map(w).set("More", 14).set("More tabs", 14);
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
  return (
    <RightPaneDataProvider value={value}>
      <PaneView {...props} />
    </RightPaneDataProvider>
  );
}

/** The frame before data: the pane header and a body the size of the real one, so nothing moves when the data arrives. */
export function ChatRightPaneLoading({ open, onToggle }: { open: boolean; onToggle: () => void }): ReactElement {
  return (
    <SidePane paneKey={PANE_KEY} toggle={{ open, onPress: onToggle }} title="Agent" tabs={TABS} activeTab={DEFAULT_TAB}>
      <View testID="right-pane-loading" accessibilityLabel="Loading" style={st.sk}>
        <View style={st.skFace} />
        <View style={st.skScreen} />
      </View>
    </SidePane>
  );
}

function PaneView({
  open,
  onToggle,
  tab: controlled,
  initialTab,
  hookSel,
  onTab,
  window,
  paneWidth,
  openRoutine,
  extra,
  embedded,
  kind,
  people,
  kept,
}: ChatRightPaneProps): ReactElement {
  const data = usePaneData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  // no capable host, no agent computers: no Computer tab and no offer to set one up
  const work = usesWorkModel(data);
  const noComputers = !work && !hasComputers(data.space);
  // every agent has a workspace once the work model is bound: the Computer tab is always there, with nothing to set up
  const hasComputer = work || (data.agent.computerId ?? "") !== "";
  const showComputer = hasComputer;
  // a long session opens on its Overview (lane l-session); any other chat on About
  const session = useSession();
  const longSession = session?.summary.long === true;
  const [own, setOwn] = useState<TabKey | null>(initialTab ?? null);
  const mine = kind !== undefined && embedded !== true;
  const wanted = controlled ?? own ?? (longSession ? "overview" : DEFAULT_TAB);
  // Open on an install card: the Skills tab, with that skill lit
  const [lit, setLit] = useState<string | undefined>(undefined);
  // the Skills tab appears once the person has skills (their own, an agent's they own, or shared with them)
  const [hasSkills, setHasSkills] = useState(false);
  useEffect(
    () =>
      onOpenSkills((name) => {
        setHasSkills(true);
        setLit(name);
        setOwn("skills");
        onTab?.("skills");
      }),
    [onTab],
  );
  useKnowsRequest(data.memory?.store, (): void => {
    setOwn("memory");
    onTab?.("memory");
  });
  const [paneW, setPaneW] = useState(PANE_WIDTH_GUESS);
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<void> | void } | null>(null);
  const deps: PaneDeps = useMemo(
    () => ({
      call: data.call,
      note: (text: string, undo?: () => Promise<void> | void) => setNotice(undo ? { text, undo } : { text }),
    }),
    [data.call],
  );
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const agentQ = useScreenQuery<AgentOut>(AGENT_PAGE_SCREEN, "agent", { agentId: data.agent.agentId });
  const agent = agentQ.status === "ready" ? agentQ.data.agent : null;
  const summaryQ = useScreenQuery<CapMap["agents.summary"]["out"]>(AGENT_PAGE_SCREEN, "summary", {
    agentId: data.agent.agentId,
  });
  const facts = summaryQ.status === "ready" ? summaryQ.data.memoryFacts : 0;
  // the Crew tab appears once teammates work for this chat
  const crewQ = useScreenQuery<CapMap["engine.crew.list"]["out"]>(PANE_SCREEN, "crew", { threadId: data.threadId });
  const crewLive = useCrew();
  const hasCrew =
    (crewQ.status === "ready" && crewQ.data.jobs.length > 0) || (crewLive?.status?.members.length ?? 0) > 0;
  // "Show it in the pane" on a helper row or the strip: this tab, and nothing else changes
  useEffect(() => {
    if (crewLive && crewLive.seq > 0) {
      setOwn("crew");
      onTab?.("crew");
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewLive?.seq]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(data.call("skills.page", {})).then(
      (p) => {
        const pg = p as { mine?: unknown[]; shared?: unknown[] } | undefined;
        if (live) setHasSkills((pg?.mine?.length ?? 0) + (pg?.shared?.length ?? 0) > 0);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [data]);
  // the Hooks tab appears once the chat has hooks, or when a hook line opened it
  const hooksQ = useScreenQuery<CapMap["hooks.list"]["out"]>(PANE_SCREEN, "hooks", { threadId: data.threadId });
  const hasHooks = (hooksQ.status === "ready" && hooksQ.data.hooks.length > 0) || wanted === "hooks";
  const baseTabs = useMemo(
    () =>
      (mine
        ? [
            ...(longSession ? [OVERVIEW_TAB] : []),
            ...kindTabs(kind, {
              crew: hasCrew,
              computer: showComputer && !noComputers,
              kept: kept !== undefined,
              people: people !== undefined,
              terminal: data.terminal !== undefined,
              skills: hasSkills,
              hooks: hasHooks,
            }),
          ]
        : tabsOf(data.terminal !== undefined, hasCrew, hasComputer, hasSkills, hasHooks, longSession).filter(
            (t) => !(noComputers && t.key === "computer"),
          )
      ).map((t) => ({ ...t, pinned: true, ...(t.key === "memory" && facts > 0 ? { title: `Knows ${facts}` } : {}) })),
    [
      mine,
      kind,
      kept !== undefined,
      people !== undefined,
      facts,
      noComputers,
      data.terminal,
      hasCrew,
      showComputer,
      hasSkills,
      hasHooks,
      longSession,
    ],
  );
  // a long session shows the chat's own pane: Overview, Threads, Files, Kept, then the rest behind More (the agent's profile is one tap away on its page)
  const tabs = useMemo(() => (longSession && !mine ? sessionTabs(baseTabs) : baseTabs), [baseTabs, longSession, mine]);
  // a tab that the chat does not have (Crew once the helpers are gone, About in the chat's own pane) gives way to the first one it does
  const tab: TabKey = mine
    ? tabs.some((t) => t.key === wanted)
      ? wanted
      : (tabs[0]?.key ?? DEFAULT_TAB)
    : wanted === "computer" && !showComputer
      ? "about"
      : wanted;
  const titles = useTitleWidths();
  const paneNow = paneWidth ?? (narrow ? win.width : paneW);
  // in the chat's own pane the tabs share the header row with what was opened from the chat (a profile, a thread): each of those takes a tab's room
  const room = paneNow - (mine ? (extra?.tabs.length ?? 0) * 110 : 0);
  const { strip, select } = useFittedTabs(tabs, tab, room, {
    extra: PANE_TAB_EXTRA,
    chrome: PANE_CHROME,
    dots: true,
    menu,
    left: Math.max(0, win.width - paneNow) + 40,
    top: 118,
    measured: withMore(titles.widths),
    pick: (key) => {
      setOwn(key);
      onTab?.(key);
    },
  });
  /** The pane's top row: the open item as a tab, the agent with its face and a close x, as the prototype draws it above the agent's header. */
  const openTab = longSession
    ? { key: "open", title: "This chat" }
    : {
        key: "open",
        title: data.agent.name,
        lead: <Face name={data.agent.name} seedId={data.agent.agentId} size={16} />,
      };
  const inner = (
    <View
      testID="chats-right-pane"
      style={[st.root, extra?.active ? st.gone : null]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== paneW) setPaneW(w);
      }}
    >
      <TabMeasure titles={tabs.map((x) => x.title)} onWidth={titles.set} />
      {longSession || mine ? null : <AgentHeader deps={deps} role={agent?.role} status={agent?.status} menu={menu} />}
      {mine ? null : (
        <View style={st.tabs}>
          <TabStrip
            tabs={strip}
            active={tab}
            onSelect={select}
            tight
            bare
            underline
            noOptions
            label={`${data.agent.name}'s tabs`}
          />
        </View>
      )}
      {online ? null : (
        <Text testID="pane-offline" style={st.offline}>
          Offline. Showing what this device keeps.
        </Text>
      )}
      <View testID={`pane-body-${tab}`} style={st.body}>
        {tab === "overview" && session ? (
          <SessionOverview
            call={data.call}
            threadId={data.threadId}
            agentId={data.agent.agentId}
            summary={session.summary}
            status={crewLive?.status ?? null}
            clock={(ts) => timeWords(ts, data.clock())}
            onHelper={(id) => crewLive?.show(id)}
            who={(id) => (data.me && id === data.me.id ? "You" : (data.nameOf?.(id) ?? id))}
            onJump={(id) => session.jump(id)}
          />
        ) : null}
        {tab === "about" ? (
          <AboutTab
            agent={agent}
            name={data.agent.name}
            hasComputer={showComputer}
            onOpenFiles={() => {
              setOwn("files");
              onTab?.("files");
            }}
            onOpenKnows={() => {
              setOwn("memory");
              onTab?.("memory");
            }}
          />
        ) : null}
        {tab === "people" ? people : null}
        {tab === "kept" ? kept : null}
        {tab === "computer" ? <ComputerPane deps={deps} {...(window ? { window } : {})} /> : null}
        {tab === "threads" ? <ThreadsTab deps={deps} {...(window ? { window } : {})} /> : null}
        {tab === "hooks" ? <HooksTab deps={deps} selected={hookSel ?? null} {...(window ? { window } : {})} /> : null}
        {tab === "crew" ? <CrewTab deps={deps} {...(window ? { window } : {})} /> : null}
        {tab === "files" ? (
          <FilesTab deps={deps} folderId={agent?.folderId ?? ""} {...(window ? { window } : {})} />
        ) : null}
        {tab === "terminal" && data.terminal ? <TerminalPaneTab data={data.terminal} /> : null}
        {tab === "memory" ? (
          data.memory ? (
            <KnowsTab deps={deps} memory={data.memory} spaceName={data.space.name} {...(window ? { window } : {})} />
          ) : (
            <MemoryTab deps={deps} spaceName={data.space.name} {...(window ? { window } : {})} />
          )
        ) : null}
        {tab === "skills" ? (
          <SkillsTab
            deps={deps}
            {...(data.nameOf ? { nameOf: data.nameOf } : {})}
            {...(lit ? { highlight: lit } : {})}
            {...(data.renderShare ? { renderShare: data.renderShare } : {})}
          />
        ) : null}
        {tab === "routines" ? (
          <RoutinesTab
            deps={deps}
            {...(window ? { window } : {})}
            {...(openRoutine ? { initial: { routineId: openRoutine } } : {})}
          />
        ) : null}
      </View>
      {notice ? (
        <Notice
          text={notice.text}
          onClose={() => setNotice(null)}
          {...(notice.undo
            ? {
                onUndo: () => {
                  const u = notice.undo;
                  setNotice(null);
                  void u?.();
                },
              }
            : {})}
        />
      ) : null}
      {menu.element}
    </View>
  );
  if (embedded === true) return inner;
  return (
    <SidePane
      paneKey={PANE_KEY}
      toggle={{ open, onPress: onToggle }}
      title={data.agent.name}
      tabs={mine ? [...strip, ...(extra?.tabs ?? [])] : orderedTabs(openTab, extra)}
      activeTab={mine ? (extra?.active ?? tab) : (extra?.active ?? "open")}
      onSelectTab={(key) => {
        if (mine) {
          // a tab of the pane's own (or its More) selects here and puts what was opened from the chat away; a tab that was opened from the chat shows it
          if (extra?.tabs.some((t) => t.key === key)) extra.onSelect(key);
          else {
            extra?.onSelect(null);
            select(key);
          }
          return;
        }
        extra?.onSelect(key === "open" ? null : key);
      }}
      onCloseTab={(key) => {
        if (!mine && key === "open") onToggle();
        else extra?.onClose(key);
      }}
      {...(mine ? { tight: true } : {})}
      {...(narrow ? { max: 1, defaultWidth: win.width } : { defaultWidth: WIDE_PANE_W })}
    >
      {extra?.active ? (
        <View testID="right-tab-body" style={st.root}>
          {extra.body}
        </View>
      ) : null}
      {inner}
    </SidePane>
  );
}

type PaneTabLike = { key: string; title: string; lead?: ReactNode };
/** The pane's own tab, and what was opened beside it; the one named `first` leads, so a one-to-one chat reads Person, Agent and a channel reads Details, Agent. */
export function orderedTabs(
  open: PaneTabLike,
  extra: { first?: string; tabs: readonly PaneTabLike[] } | undefined,
): PaneTabLike[] {
  const rest = extra?.tabs ?? [];
  const lead = extra?.first === undefined ? undefined : rest.find((t) => t.key === extra.first);
  return lead === undefined ? [open, ...rest] : [lead, open, ...rest.filter((t) => t !== lead)];
}

/** The agent's header: its face with presence, one role line, Message and what the shell can do (Poke, Share), and one "..." menu. Sleep now is in the menu; the Computer tab has no button for it. */
function AgentHeader({
  deps,
  role,
  status,
  menu,
}: {
  deps: PaneDeps;
  role: string | undefined;
  status: string | undefined;
  menu: ReturnType<typeof useMenu>;
}): ReactElement {
  const data = usePaneData();
  const computerId = data.agent.computerId ?? "";
  return computerId === "" ? (
    <HeaderBar deps={deps} role={role} status={status} computerState={undefined} menu={menu} />
  ) : (
    <HeaderWithComputer deps={deps} role={role} status={status} computerId={computerId} menu={menu} />
  );
}

function HeaderWithComputer({
  deps,
  role,
  status,
  computerId,
  menu,
}: {
  deps: PaneDeps;
  role: string | undefined;
  status: string | undefined;
  computerId: string;
  menu: ReturnType<typeof useMenu>;
}): ReactElement {
  const q = useScreenQuery<CapMap["computers.get"]["out"]>(COMPUTER_SCREEN, "computer", { computerId });
  return (
    <HeaderBar
      deps={deps}
      role={role}
      status={status}
      computerState={q.status === "ready" ? q.data.computer.state : undefined}
      menu={menu}
    />
  );
}

/** The header's actions for an agent: Message always; Poke and Share only where the shell can do them (a button is never drawn for something that cannot work). */
export function agentActions(
  nav: Pick<RightPaneNav, "openThread" | "poke" | "share">,
  threadId: string,
  agentId: string,
  name: string,
): HeaderAction[] {
  return [
    {
      key: "message",
      icon: "chat",
      label: "Message",
      hint: `Chat with ${name}`,
      onPress: () => nav.openThread(threadId, "here"),
    },
    ...(nav.poke
      ? [
          {
            key: "poke",
            icon: "bolt" as const,
            label: "Poke",
            hint: `Ask ${name} to read the latest and answer now`,
            onPress: () => nav.poke?.(agentId, threadId),
          },
        ]
      : []),
    ...(nav.share
      ? [
          {
            key: "share",
            icon: "share" as const,
            label: "Share",
            hint: `Share ${name}`,
            onPress: () => nav.share?.(agentId),
          },
        ]
      : []),
  ];
}

function HeaderBar({
  deps,
  role,
  status,
  computerState,
  menu,
}: {
  deps: PaneDeps;
  role: string | undefined;
  status: string | undefined;
  computerState: string | undefined;
  menu: ReturnType<typeof useMenu>;
}): ReactElement {
  const data = usePaneData();
  const name = data.agent.name;
  const presence: Presence =
    computerState === "asleep" || status === "asleep" ? "asleep" : status === "paused" ? "away" : "on";
  const actions = agentActions(data.nav, data.threadId, data.agent.agentId, name);
  const awake =
    data.agent.computerId !== undefined &&
    data.agent.computerId !== "" &&
    computerState !== undefined &&
    computerState !== "asleep" &&
    computerState !== "provisioning" &&
    computerState !== "error";
  const more = (x: number, y: number): void => {
    menu.show(
      [
        ...(awake
          ? [
              { label: "Sleep Now", onSelect: () => void sleep(deps, data.agent.computerId ?? "", name) },
              { separator: true as const },
            ]
          : []),
        { label: `Open ${name}'s Page`, onSelect: () => data.nav.openAgentPage(data.agent.agentId) },
      ] as MenuEntry[],
      x,
      y,
      "other",
    );
  };
  return (
    <ProfileHeader
      name={name}
      seedId={data.agent.agentId}
      kind="agent"
      presence={presence}
      pulse={status === "working"}
      line={roleLine("Agent", role)}
      actions={actions}
      onMore={more}
    />
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--side)" as string },
  gone: { display: "none" },
  tabs: {
    marginTop: 10,
    paddingTop: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  offline: { paddingHorizontal: 12, paddingBottom: 4, fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { flex: 1, minHeight: 0 },
  sk: { padding: 10, gap: 12 },
  skFace: { width: 30, height: 30, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skScreen: { height: 150, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
