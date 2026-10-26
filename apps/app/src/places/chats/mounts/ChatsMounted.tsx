// The Chats place with every screen mounted (P-L9b_23, spec 3.2, 2.5, 2.6, 2.7). The sidebar is on the left; the middle shows what `Shown` says (a chat, the Needs you page, an agent's
// page, a helper's chat); the right shows the agent's pane or a terminal; layers (the computer popup, the recording sheet, Connect an outside agent, All agents, the terminal list and
// rules) sit over it. Every door is one `Go` function over the pure `step`: a face's "Open Intake's Page", the helper icon, the channel menu's "Connect an Outside Agent", the Computer
// chip, a face in the sidebar, a request in Needs you all end in the same place. The data comes from the runtime the shell built for the open Space (live queries over the kept copy
// and `call`), never from sample data. A link from another place arrives as `hash` and becomes the first thing shown.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Principal } from "../../home/sections-a/data.tsx";
import { conversationData } from "../../../shell/providers/chats-data.ts";
import type { ChatsActions } from "../../../shell/providers/chats-data.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { AgentPage, AgentPageLoading } from "../agentpage/AgentPage.tsx";
import { ComputerPopup, ComputerPopupLoading } from "../computer/ComputerPopup.tsx";
import { NO_CAPTURE } from "../computer/model.ts";
import { Conversation, ConversationLoading } from "../conversation/Conversation.tsx";
import { HelperChat, HelperChatLoading } from "../helper/HelperChat.tsx";
import { NeedsYou } from "../needsyou/NeedsYou.tsx";
import { ChatRightPane } from "../rightpane/ChatRightPane.tsx";
import { Icon } from "../rightpane/parts.tsx";
import { ChatsSidebar } from "../sidebar/ChatsSidebar.tsx";
import { TerminalList } from "../terminal/TerminalList.tsx";
import { TerminalRules } from "../terminal/TerminalRules.tsx";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { AllAgents } from "./AllAgents.tsx";
import { ConnectOutsideAgent } from "./ConnectOutsideAgent.tsx";
import { agentPageData, chatWith, createCapture, createGo, helperData, needsData, newKey, popupData, terminalData, wireConversation, wirePane, wireSidebar } from "./data.ts";
import type { CaptureCounter, Go } from "./data.ts";
import { useLive } from "./live.ts";
import { START, fromHash, newestThread, step } from "./route.ts";
import type { Act, Shown } from "./route.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type RecentOut = CapMap["chat.recent"]["out"];
type AgentOut = CapMap["agents.get"]["out"];
type ComputersOut = CapMap["computers.list"]["out"];
type ComputerOut = CapMap["computers.get"]["out"];
type RecordingOut = CapMap["computers.recording.get"]["out"];

export const SIDEBAR_W = 264;
export const PANE_W = 340;
export const TERMINAL_W = 480;
/** Under this width the sidebar is a screen of its own and every page fills the window. */
export const WIDE = 640;
const LINE_MS = 4000;
/** The terminal glyph of the tab (the same drawing ui/Terminal uses). */
const TERMINAL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 6.5l2 1.8-2 1.8M8.8 10.2H11"/></svg>';

const NO_PEOPLE: Principal[] = [];

export interface ChatsMountedProps {
  rt: ShellRuntime;
  /** The link another place opened this one with: `screen=chats.agent-page&agentId=...`. */
  hash?: string;
  /** What to show first, instead of the link (tests and screenshots). */
  initial?: Shown;
  /** Pins which rows are drawn (tests and screenshots draw them all). */
  window?: VirtualWindow;
}

export function ChatsMounted({ rt, hash = "", initial, window }: ChatsMountedProps): ReactElement {
  const [shown, setShown] = useState<Shown>(() => initial ?? (hash === "" ? START : fromHash(hash)));
  const [line, setLine] = useState<string | null>(null);
  const [counter] = useState<CaptureCounter>(createCapture);

  const live = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const list = live.status === "ready" ? live.data : NO_PEOPLE;
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p] as const)), [list]);
  const nameOf = useCallback((id: string): string => (id === rt.assistant.id ? rt.assistant.name : byId.get(id)?.name ?? id), [byId, rt.assistant.id, rt.assistant.name]);

  useEffect(() => {
    if (line === null) return undefined;
    const t = setTimeout(() => setLine(null), LINE_MS);
    return () => clearTimeout(t);
  }, [line]);

  const act = useCallback((a: Act): void => setShown((s) => step(s, a)), []);
  const go = useMemo<Go>(() => createGo(rt, act, nameOf, setLine), [rt, act, nameOf]);
  const route = shown.route;
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < WIDE;
  // On a phone the list is the screen until something is opened; an open page has a way back to it.
  const listOnly = narrow && route.view === "chat" && route.threadId === null;

  /* ---------- the sidebar ---------- */
  const side = useMemo(() => wireSidebar(rt, go), [rt, go]);

  /* ---------- the open chat ---------- */
  const recent = useLive<RecentOut>(rt.screens, "chats.sidebar", "recent", { filter: "all" });
  const threadId = route.view === "chat" ? (route.threadId ?? newestThread(recent.status === "ready" ? recent.data : undefined)) : null;
  const thread = useLive<ThreadOut>(rt.screens, "chats.conversation", "thread", { threadId: threadId ?? "" });
  const lead = thread.status === "ready" && threadId !== null ? (thread.data.thread.agents.find((a) => a.mode === "lead") ?? thread.data.thread.agents[0]) : undefined;
  const leadId = lead?.agentId ?? rt.assistant.id;
  const computers = useLive<ComputersOut>(rt.screens, "console.agent-computers", "computers", {});
  const computerOf = (agentId: string): string | undefined => (computers.status === "ready" ? computers.data.computers.find((c) => c.agentId === agentId)?.computerId : undefined);
  const leadComputer = computerOf(leadId);
  const leadAgent = useMemo(() => ({ agentId: leadId, name: nameOf(leadId), ...(leadComputer ? { computerId: leadComputer } : {}) }), [leadId, nameOf, leadComputer]);

  const conv = useMemo(
    () => (threadId === null ? null : wireConversation(rt, go, { threadId, list, nameOf, leadId })),
    [rt, go, threadId, list, nameOf, leadId],
  );
  const paneCtx = useMemo(() => (threadId === null ? null : wirePane(rt, go, threadId, leadAgent)), [rt, go, threadId, leadAgent]);

  /* ---------- the other pages ---------- */
  const needs = useMemo(() => needsData(rt, go, nameOf), [rt, go, nameOf]);
  const helperId = route.view === "helper" ? route.threadId : "";
  const helper = useMemo(() => helperData(rt, go, helperId, nameOf), [rt, go, helperId, nameOf]);
  const agentId = route.view === "agent" ? route.agentId : "";
  const agentQ = useLive<AgentOut>(rt.screens, "chats.agent-page", "agent", { agentId: agentId !== "" ? agentId : leadId });
  const agentRow = agentQ.status === "ready" && agentId !== "" ? agentQ.data.agent : null;
  const agentComputer = computerOf(agentId);
  const agentPage = useMemo(
    () => agentPageData(rt, go, { agent: { agentId, name: agentRow?.name ?? nameOf(agentId), ...(agentComputer ? { computerId: agentComputer } : {}) }, canEdit: agentRow !== null && agentRow.ownerId === rt.me.id, nameOf }),
    [rt, go, agentId, agentRow, agentComputer, nameOf],
  );
  const terminal = useMemo(() => terminalData(rt, go, { agent: leadAgent, newKey }), [rt, go, leadAgent]);

  /* ---------- the middle ---------- */
  let main: ReactElement;
  if (route.view === "needs") main = <NeedsYou data={needs} {...(route.taskId ? { initialSelected: route.taskId } : {})} {...(window ? { window } : {})} />;
  else if (route.view === "helper") main = helperId === "" ? <HelperChatLoading /> : <HelperChat key={helperId} data={helper} />;
  else if (route.view === "agent") main = agentId === "" ? <AgentPageLoading /> : <AgentPage key={agentId} data={agentPage} initialTab={route.tab ?? "chats"} {...(window ? { window } : {})} />;
  else main = conv ? <Conversation key={conv.threadId} data={conv} /> : <ConversationLoading />;

  /* ---------- the right ---------- */
  let right: ReactElement | null = null;
  if (shown.terminalId !== null) {
    right = (
      <View testID="chats-terminal" style={narrow ? st.terminalFull : st.terminal}>
        <SidePane
          paneKey="chats-terminal" toggle={{ open: true, onPress: () => go.closeTerminal() }} title="Terminal" tabs={[{ key: "terminal", title: "Terminal", icon: TERMINAL_ICON }]} activeTab="terminal"
          onCloseTab={() => go.closeTerminal()} defaultWidth={TERMINAL_W}
        >
          <TerminalTab key={shown.terminalId} data={terminal} terminalId={shown.terminalId} />
        </SidePane>
      </View>
    );
  } else if (shown.pane && paneCtx && route.view === "chat") {
    right = <View style={st.pane}><ChatRightPane data={paneCtx} open onToggle={go.togglePane} {...(window ? { window } : {})} /></View>;
  }

  const showMain = !listOnly && !(narrow && right !== null);
  return (
    <View testID="chats-place" style={st.row}>
      {!narrow || listOnly ? <View style={narrow ? st.sideFull : st.side}><ChatsSidebar data={side} {...(window ? { window } : {})} /></View> : null}
      {showMain ? (
        <View testID="chats-main" style={st.main}>
          {narrow ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to the list" testID="chats-back" onPress={() => go.chat("")} style={({ hovered }: { hovered?: boolean }) => [st.back, hovered === true && st.backOver]}>
              <Icon name="back" size={14} color="var(--ink-2)" /><Text style={st.backText}>Chats</Text>
            </Pressable>
          ) : null}
          <View style={st.fill}>{main}</View>
        </View>
      ) : null}
      {right}
      <Layer shown={shown} rt={rt} go={go} nameOf={nameOf} list={list} counter={counter} terminal={terminal} window={window} />
      {line ? <View testID="chats-line" accessibilityRole="alert" accessibilityLiveRegion="polite" style={st.toast}><Text style={st.toastText}>{line}</Text></View> : null}
    </View>
  );
}

/* ---------- the layer over the place ---------- */

function Layer({ shown, rt, go, nameOf, list, counter, terminal, window }: {
  shown: Shown; rt: ShellRuntime; go: Go; nameOf: (id: string) => string; list: readonly Principal[]; counter: CaptureCounter; terminal: ReturnType<typeof terminalData>; window: VirtualWindow | undefined;
}): ReactElement | null {
  const l = shown.layer;
  if (l === null) return null;
  switch (l.kind) {
    case "computer": return <ComputerLayer key={l.computerId} rt={rt} go={go} nameOf={nameOf} list={list} counter={counter} computerId={l.computerId} chat={l.chat} />;
    case "recording": return <RecordingLayer key={l.recordingId} rt={rt} go={go} nameOf={nameOf} list={list} counter={counter} recordingId={l.recordingId} />;
    case "connect": return <ConnectOutsideAgent screens={rt.screens} call={rt.call} newKey={newKey} clock={rt.clock} channelId={l.channelId} onClose={go.closeLayer} say={go.say} />;
    case "all-agents":
      return (
        <AllAgents
          screens={rt.screens} space={{ name: rt.space.name }} x={l.x} y={l.y} onChat={go.agentChat} onOpenPage={(id) => go.agent(id)}
          onNewAgent={() => rt.open({ screen: "console.agents-register" })} onClose={go.closeLayer} {...(window ? { window } : {})}
        />
      );
    case "terminals": return <TerminalList data={terminal} x={l.x} y={l.y} onClose={go.closeLayer} {...(window ? { window } : {})} />;
    case "rules": return <TerminalRules data={terminal} onClose={go.closeLayer} />;
  }
}

/** The chat with the agent, drawn beside the screen while the popup's chat icon is on. */
function AgentChat({ rt, go, agentId, list }: { rt: ShellRuntime; go: Go; agentId: string; list: readonly Principal[] }): ReactElement {
  const [threadId, setThreadId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void chatWith(rt, agentId).then((id) => { if (alive && id) setThreadId(id); });
    return () => { alive = false; };
  }, [rt, agentId]);
  const data = useMemo(() => {
    if (threadId === null) return null;
    const actions: ChatsActions = { openThread: (id) => go.thread(id), togglePane: () => undefined, openAgentChat: (id) => go.agentChat(id), fillComposer: () => undefined };
    return conversationData(rt, actions, threadId, list);
  }, [rt, go, threadId, list]);
  return data ? <Conversation key={data.threadId} data={data} /> : <ConversationLoading />;
}

function ComputerLayer({ rt, go, nameOf, list, counter, computerId, chat }: {
  rt: ShellRuntime; go: Go; nameOf: (id: string) => string; list: readonly Principal[]; counter: CaptureCounter; computerId: string; chat: boolean;
}): ReactElement {
  const q = useLive<ComputerOut>(rt.screens, "chats.computer-popup", "computer", { computerId });
  const agentId = q.status === "ready" ? q.data.computer.agentId : "";
  const data = useMemo(
    () => (agentId === "" ? null : popupData(rt, go, { computerId, agent: { agentId, name: nameOf(agentId) }, counter, renderChat: (a) => <AgentChat rt={rt} go={go} agentId={a.agentId} list={list} /> })),
    [rt, go, computerId, agentId, nameOf, counter, list],
  );
  return data ? <ComputerPopup data={data} {...(chat ? { initial: { chat: true } } : {})} /> : <ComputerPopupLoading />;
}

/** The recording sheet: the popup's own sheet, opened on a recording that was stopped, asking what the agent should do with it. */
function RecordingLayer({ rt, go, nameOf, list, counter, recordingId }: {
  rt: ShellRuntime; go: Go; nameOf: (id: string) => string; list: readonly Principal[]; counter: CaptureCounter; recordingId: string;
}): ReactElement {
  const q = useLive<RecordingOut>(rt.screens, "chats.recording-sheet", "recording", { recordingId });
  const rec = q.status === "ready" ? q.data.recording : null;
  const data = useMemo(
    () => (rec === null ? null : popupData(rt, go, { computerId: rec.computerId, agent: { agentId: rec.agentId, name: nameOf(rec.agentId) }, counter, renderChat: (a) => <AgentChat rt={rt} go={go} agentId={a.agentId} list={list} /> })),
    [rt, go, rec, nameOf, counter, list],
  );
  if (data === null || rec === null) return <ComputerPopupLoading />;
  return <ComputerPopup data={data} initial={{ sheet: { recording: rec, capture: NO_CAPTURE, secs: Math.max(1, Math.round((rec.durationMs ?? 0) / 1000)) } }} />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  pane: { width: PANE_W, minHeight: 0 },
  sideFull: { flex: 1, minHeight: 0 },
  fill: { flex: 1, minHeight: 0 },
  back: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  backOver: { backgroundColor: "var(--hover)" as string },
  backText: { fontSize: 13, color: "var(--ink-2)" as string },
  terminal: { width: TERMINAL_W, minHeight: 0 },
  terminalFull: { flex: 1, minWidth: 0, minHeight: 0 },
  toast: { position: "absolute", left: 16, bottom: 16, maxWidth: 420, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string },
  toastText: { fontSize: 12.5, color: "var(--ink)" as string },
});
