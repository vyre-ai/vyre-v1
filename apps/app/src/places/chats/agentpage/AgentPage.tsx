// The agent page (spec 3.2 Agent page, 2.6 Agent): a photo, a name, the role line that edits in place, the status, and a Chat button with "Automation runs" beside it; under them
// the strip of what the agent has done (chats this week, open tasks, runs today, spend against its limit, memory facts, proposed facts); then the tabs Chats, Memory, Files,
// Computer and Settings in the shared tab strip. Memory, Files and Computer are the same tabs the Chats right pane shows, read from the same data, so the page adds no second copy.
// Every change says so in one quiet line at the foot, with Undo where it can be taken back.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { RightPaneDataProvider } from "../rightpane/data.tsx";
import { ComputerTab } from "../rightpane/ComputerTab.tsx";
import { FilesTab } from "../rightpane/FilesTab.tsx";
import { MemoryTab } from "../rightpane/MemoryTab.tsx";
import { Face, Notice, TextButton, Tool } from "../rightpane/parts.tsx";
import { pause, resume, saveRoleLine, startChat } from "./actions.ts";
import type { PageDeps } from "./actions.ts";
import { AgentPageDataProvider, paneDataOf, useAgentPageData, useOnline, useOptionalAgentPageData, useScreenQuery } from "./data.tsx";
import type { AgentPageData } from "./data.tsx";
import { ChatsTab } from "./ChatsTab.tsx";
import { TabMeasure, useFittedTabs, useTitleWidths } from "../rightpane/fit.tsx";
import { RoleLine } from "./RoleLine.tsx";
import { SettingsTab } from "./SettingsTab.tsx";
import { DEFAULT_TAB, TABS, collect, spendRatio, statusLine, stripOf } from "./model.ts";
import type { TabKey } from "./model.ts";

type AgentOut = CapMap["agents.get"]["out"];
type SummaryOut = CapMap["agents.summary"]["out"];

export interface AgentPageProps {
  /** The data context; the shell wraps the page in a provider instead when it shares one. */
  data?: AgentPageData;
  /** The tab shown. Leave `tab` out and the page keeps its own; `initialTab` is where it starts. */
  tab?: TabKey;
  initialTab?: TabKey;
  onTab?: (tab: TabKey) => void;
  /** Pins which rows are drawn (tests and screenshots draw them all); the shell leaves it out and the lists window by scroll. */
  window?: VirtualWindow;
}

export const NOTICE_MS = 8000;
/** Below this window width the header stacks and the strip wraps. */
export const NARROW = 640;
/** What the strip keeps besides tabs: its 6 px padding each side and the options button (26 px) with its gap, rounded up. */
const STRIP_PADDING = 52;

export function AgentPage(props: AgentPageProps): ReactElement {
  const ctx = useOptionalAgentPageData();
  const value = props.data ?? ctx;
  if (!value) return <AgentPageLoading />;
  return <AgentPageDataProvider value={value}><PageView {...props} /></AgentPageDataProvider>;
}

/** The frame before data: a header and a strip the size of the real ones, so nothing moves when the data arrives. */
export function AgentPageLoading(): ReactElement {
  return (
    <View testID="agent-page-loading" accessibilityLabel="Loading" style={st.root}>
      <View style={st.col}>
        <View style={st.skHead}><View style={st.skFace} /><View style={{ gap: 8 }}><View style={st.skName} /><View style={st.skRole} /></View></View>
        <View style={st.skStrip} />
      </View>
    </View>
  );
}

function PageView({ tab: controlled, initialTab, onTab, window }: AgentPageProps): ReactElement {
  const data = useAgentPageData();
  const online = useOnline();
  const menu = useMenu();
  const win = useWindowDimensions();
  const narrow = win.width > 0 && win.width < NARROW;
  const [own, setOwn] = useState<TabKey>(initialTab ?? DEFAULT_TAB);
  const tab = controlled ?? own;
  const [colW, setColW] = useState(0);
  const titles = useTitleWidths();
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<void> | void } | null>(null);
  const deps: PageDeps = useMemo(() => ({
    call: data.call,
    note: (text: string, undo?: () => Promise<void> | void) => setNotice(undo ? { text, undo } : { text }),
  }), [data.call]);
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // The page's tab strip folds like the pane's: the same fit and More menu (rightpane/fit.tsx), at the page column's own width (390 px phone: Settings never clips).
  const pageW = colW > 0 ? colW : win.width > 0 ? Math.min(win.width, 760) : 760;
  const { strip, select } = useFittedTabs(TABS, tab, pageW, {
    chrome: STRIP_PADDING, measured: titles.widths,
    menu, left: Math.max(0, (win.width - pageW) / 2) + 16, top: 330,
    pick: (key) => { setOwn(key); onTab?.(key); },
  });

  const agentId = data.agent.agentId;
  const agentQ = useScreenQuery<AgentOut>("agent", { agentId });
  const summaryQ = useScreenQuery<SummaryOut>("summary", { agentId });
  if (agentQ.status === "loading") return <AgentPageLoading />;
  const agent = agentQ.data.agent;
  const summary = summaryQ.status === "ready" ? summaryQ.data : null;
  const name = agent.name;
  const paused = agent.status === "paused";

  const chat = (): void => { void startChat(deps, agentId, name).then((id) => { if (id !== null) data.nav.openChat(id); }); };
  const moreMenu = (x: number, y: number): void => {
    menu.show([
      { label: "Chat", onSelect: chat },
      { label: "Automation Runs", onSelect: () => data.nav.openAutomationRuns(agentId) },
      { label: "Open Folder", onSelect: () => data.nav.openFolder(agent.folderId) },
      ...(agent.hasComputer && data.agent.computerId ? [{ label: "Open Computer", onSelect: () => data.nav.openComputer(data.agent.computerId ?? "") }] : []),
      ...(data.canEdit ? [{ separator: true as const }, paused ? { label: "Resume", onSelect: () => void resume(deps, agentId, name) } : { label: "Pause", onSelect: () => void pause(deps, agentId, name, "Paused from the agent page") }] : []),
    ], x, y, "other", { label: `${name}'s page` });
  };

  const stats = summary ? stripOf(summary) : [];
  const ratio = summary ? spendRatio(summary) : 0;
  return (
    <View testID="agent-page" accessibilityLabel={`${name}, agent page`} style={st.root}>
      <View style={[st.col, narrow && st.colNarrow]} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== colW) setColW(w); }}>
        <View testID="agent-head" style={[st.head, narrow && st.headNarrow]}>
          <Face name={name} seedId={agentId} size={narrow ? 48 : 56} pulse={agent.status === "working"} />
          <View style={st.who}>
            <View style={st.nameRow}>
              <Text accessibilityRole="header" testID="agent-name" numberOfLines={1} style={st.name}>{name}</Text>
              <View testID="agent-status" style={[st.status, agent.status === "working" && st.statusLive, paused && st.statusPaused]}>
                <View style={[st.dot, agent.status === "working" && st.dotLive, paused && st.dotPaused]} />
                <Text numberOfLines={1} style={st.statusText}>{statusLine(agent, data.nameOf)}</Text>
              </View>
            </View>
            <RoleLine value={agent.role ?? ""} canEdit={data.canEdit} onSave={(next) => void saveRoleLine(deps, agentId, next, agent.role ?? "")} />
          </View>
          <View style={[st.actions, narrow && st.actionsNarrow]}>
            <TextButton label="Chat" primary testID="chat-button" onPress={chat} />
            <TextButton label="Automation runs" testID="runs-button" onPress={() => data.nav.openAutomationRuns(agentId)} />
            <Tool icon="folder" label="Open folder" testID="folder-button" onPress={() => data.nav.openFolder(agent.folderId)} />
            {agent.hasComputer && data.agent.computerId ? <Tool icon="watch" label="Computer" testID="computer-button" onPress={() => data.nav.openComputer(data.agent.computerId ?? "")} /> : null}
            <Tool icon="more" label="More" testID="more-button" onPress={moreMenu} />
          </View>
        </View>
        {online ? null : <Text testID="agent-offline" style={st.offline}>Offline. Showing what this device keeps.</Text>}
        {summary ? (
          <View testID="agent-strip" accessibilityRole="summary" style={st.strip}>
            {collect(stats, (s) => (
              <View key={s.key} testID={`stat-${s.key}`} style={st.stat}>
                <Text style={st.statValue}>{s.value}</Text>
                <Text style={st.statLabel}>{s.label}</Text>
                {s.key === "spend" && ratio > 0 ? <View testID="spend-bar" style={st.bar}><View style={[st.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: (ratio >= 1 ? "var(--danger)" : "var(--accent)") as string }]} /></View> : null}
              </View>
            ))}
          </View>
        ) : <View testID="agent-strip-loading" style={st.skStrip} />}
        <TabMeasure titles={TAB_TITLES} onWidth={titles.set} />
        <TabStrip tabs={strip} active={tab} onSelect={select} label={`${name}'s page`} />
        <View testID={`page-body-${tab}`} style={st.body}>
          <RightPaneDataProvider value={paneDataOf(data)}>
            {tab === "chats" ? (summary ? <ChatsTab summary={summary} {...(window ? { window } : {})} /> : <View testID="chats-loading" accessibilityLabel="Loading" style={st.skStrip} />) : null}
            {tab === "memory" ? <MemoryTab deps={deps} spaceName={data.space.name} {...(window ? { window } : {})} /> : null}
            {tab === "files" ? <FilesTab deps={deps} folderId={agent.folderId} {...(window ? { window } : {})} /> : null}
            {tab === "computer" ? <ComputerTab deps={deps} {...(window ? { window } : {})} /> : null}
          </RightPaneDataProvider>
          {tab === "settings" ? <SettingsTab agent={agent} deps={deps} {...(window ? { window } : {})} /> : null}
        </View>
        {notice ? <Notice text={notice.text} onClose={() => setNotice(null)} {...(notice.undo ? { onUndo: () => { const u = notice.undo; setNotice(null); void u?.(); } } : {})} /> : null}
      </View>
      {menu.element}
    </View>
  );
}

const TAB_TITLES: readonly string[] = TABS.map((x) => x.title);

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, alignItems: "center", backgroundColor: "var(--win)" as string },
  col: { flex: 1, minHeight: 0, width: "100%", maxWidth: 760, paddingHorizontal: 24 },
  colNarrow: { paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 24, paddingBottom: 12 },
  headNarrow: { flexWrap: "wrap", paddingTop: 16 },
  who: { flex: 1, minWidth: 180, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  name: { flexShrink: 1, fontSize: 22, lineHeight: 28, fontWeight: "600", color: "var(--ink)" as string },
  status: { flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: "var(--sunk)" as string },
  statusLive: { backgroundColor: "var(--accent-wash)" as string },
  statusPaused: { backgroundColor: "color-mix(in srgb, var(--warn) 14%, transparent)" as string },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ink-4)" as string },
  dotLive: { backgroundColor: "var(--ok)" as string },
  dotPaused: { backgroundColor: "var(--warn)" as string },
  statusText: { fontSize: 12, color: "var(--ink-2)" as string },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionsNarrow: { width: "100%" },
  offline: { paddingBottom: 6, fontSize: 11.5, color: "var(--ink-3)" as string },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingVertical: 10, marginBottom: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "var(--line)" as string },
  stat: { minWidth: 92, gap: 1 },
  statValue: { fontSize: 18, lineHeight: 24, fontWeight: "600", color: "var(--ink)" as string },
  statLabel: { fontSize: 11.5, color: "var(--ink-3)" as string },
  bar: { marginTop: 3, height: 3, borderRadius: 2, backgroundColor: "var(--line-2)" as string, overflow: "hidden" },
  barFill: { height: 3, borderRadius: 2 },
  body: { flex: 1, minHeight: 0 },
  skHead: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 24, paddingBottom: 12 },
  skFace: { width: 56, height: 56, borderRadius: 16, backgroundColor: "var(--sunk)" as string },
  skName: { height: 16, width: 140, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  skRole: { height: 12, width: 260, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  skStrip: { height: 56, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
});
