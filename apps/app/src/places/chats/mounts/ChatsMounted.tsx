// The Chats place with every screen mounted (P-L9b_23, spec 3.2, 2.5, 2.6, 2.7). The sidebar is on the left; the middle shows what `Shown` says (a chat, the Needs you page, an agent's
// page, a helper's chat); the right shows the agent's pane or a terminal; layers (the computer popup, the recording sheet, Connect an outside agent, All agents, the terminal list and
// rules) sit over it. Every door is one `Go` function over the pure `step`: a face's "Open Intake's Page", the helper icon, the channel menu's "Connect an Outside Agent", the Computer
// chip, a face in the sidebar, a request in Needs you all end in the same place. The data comes from the runtime the shell built for the open Space (live queries over the kept copy
// and `call`), never from sample data. A link from another place arrives as `hash` and becomes the first thing shown.
import { useComputersAvailable } from "../../../shell/computers-available.ts";
import { ImportedSession } from "../imported/ImportedSession.tsx";
import type { ImportedData } from "../imported/ImportedSession.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
import { createComposerFill } from "../conversation/data.tsx";
import type { ComposerFill } from "../conversation/data.tsx";
import { HelperChat, HelperChatLoading } from "../helper/HelperChat.tsx";
import { NeedsYou } from "../needsyou/NeedsYou.tsx";
import { AgentPane } from "../AgentPane.tsx";
import { ChatsSidebarSlot } from "../sidebar/ChatsSidebar.tsx";
import { TerminalList } from "../terminal/TerminalList.tsx";
import { TerminalRules } from "../terminal/TerminalRules.tsx";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { AllAgents } from "./AllAgents.tsx";
import { ConnectOutsideAgent } from "./ConnectOutsideAgent.tsx";
import { SearchPage } from "../search/SearchPage.tsx";
import type { SearchData } from "../search/SearchPage.tsx";
import { TextButton } from "../conversation/parts.tsx";
import { copy, agentPageData, askWith, chatOpening, chatWith, createCapture, createGo, helperData, needsData, newKey, popupData, terminalData, wireConversation, wirePane, wireSidebar } from "./data.ts";
import type { CaptureCounter, Go, LineAction } from "./data.ts";
import { useLive } from "./live.ts";
import { noteThreadKind } from "../../../shell/ask/screen.ts";
import { START, fromHash, step, workOf } from "./route.ts";
import { Landing } from "../landing/Landing.tsx";
import { TasksRoute, TaskRouteLeaf } from "./TasksRoute.tsx";
import { ThreadsPage } from "./ThreadsPage.tsx";
import { WORKSPACE_MIN_W, Workspace } from "./Workspace.tsx";
import type { Act, Shown } from "./route.ts";
import { nameOr } from "../names.ts";

type ThreadOut = CapMap["threads.get"]["out"];
type RecentOut = CapMap["chat.recent"]["out"];
type AgentOut = CapMap["agents.get"]["out"];
type ComputersOut = CapMap["computers.list"]["out"];
type ComputerOut = CapMap["computers.get"]["out"];
type RecordingOut = CapMap["computers.recording.get"]["out"];

export const SIDEBAR_W = 264;
export const PANE_W = 340;
export const TERMINAL_W = 480;
/** Under this width the agent's pane and the terminal fill the window (the sidebar is the shell's slot, which has its own phone view). */
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
  /** What is open, as a hash, for the tab strip and the address: a chat is a tab of its own. */
  opened?: (target: { subject?: { type: string; id: string }; screen?: string }) => void;
  /** The middle is about to change: the shell keeps a still copy on screen until the next view is ready. */
  onSwitch?: () => void;
}

export function ChatsMounted({ rt, hash = "", initial, window, opened, onSwitch }: ChatsMountedProps): ReactElement {
  const [shown, setShown] = useState<Shown>(() => initial ?? (hash === "" ? START : fromHash(hash)));
  const [line, setLineState] = useState<{ text: string; action?: LineAction } | null>(null);
  const setLine = useCallback((text: string, action?: LineAction): void => setLineState(action ? { text, action } : { text }), []);
  const [counter] = useState<CaptureCounter>(createCapture);
  // what a pane or the agent's page asks the composer to hold (Ask about this file, Change by Asking)
  const [fill] = useState<ComposerFill>(createComposerFill);

  const live = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const list = live.status === "ready" ? live.data : NO_PEOPLE;
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p] as const)), [list]);
  const nameOf = useCallback((id: string): string => (id === rt.assistant.id ? rt.assistant.name : nameOr(byId.get(id)?.name, id)), [byId, rt.assistant.id, rt.assistant.name]);

  useEffect(() => {
    if (line === null) return undefined;
    const t = setTimeout(() => setLineState(null), LINE_MS);
    return () => clearTimeout(t);
  }, [line]);

  const act = useCallback((a: Act): void => { if (a.t === "chat" || a.t === "new" || a.t === "tasks" || a.t === "task" || a.t === "threads" || a.t === "agent" || a.t === "needs") onSwitch?.(); setShown((s) => step(s, a)); }, [onSwitch]);
  // a link from another place, a notification or the Space menu while Chats is already open
  const linked = useRef(hash);
  useEffect(() => {
    if (hash === linked.current) return;
    linked.current = hash;
    // a tab switch or a link: the same thing already on screen keeps its pane and its place
    setShown((s) => { const next = hash === "" ? START : fromHash(hash); return JSON.stringify(next.route) === JSON.stringify(s.route) ? s : { ...next, pane: s.pane, terminalId: s.terminalId }; });
  }, [hash]);
  // what is open follows into the tab strip and the address, so each chat is a tab and coming back lands on it
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const routeKey = shown.route.view === "chat" ? `t:${shown.route.threadId ?? ""}` : shown.route.view === "new" ? "new" : shown.route.view === "task" ? `k:${shown.route.taskId}` : shown.route.view === "tasks" ? "tasks" : shown.route.view === "threads" ? "threads" : "";
  useEffect(() => {
    const report = openedRef.current;
    if (!report || routeKey === "") return;
    if (routeKey === "new") report({});
    else if (routeKey === "tasks") report({ screen: "tasks.my-work" });
    else if (routeKey === "threads") report({ screen: "chats.threads" });
    else if (routeKey.startsWith("t:") && routeKey !== "t:") report({ subject: { type: "thread", id: routeKey.slice(2) } });
    else if (routeKey.startsWith("k:")) report({ subject: { type: "task", id: routeKey.slice(2) } });
  }, [routeKey]);
  // An Ask link names an agent and an object; the thread it opens is found or made, then shown as a chat.
  const asking = shown.route.view === "ask" ? shown.route : null;
  useEffect(() => {
    if (asking === null) return undefined;
    let live = true;
    const who = asking.agentId === "assistant" ? rt.assistant.id : asking.agentId;
    const found = asking.scopeType === "" ? (asking.first ? chatOpening(rt, who, asking.first) : chatWith(rt, who)) : askWith(rt, who, asking.scopeType, asking.scopeId, asking.bringFrom, asking.first);
    void found.then((id) => {
      if (!live) return;
      if (id) { if (asking.draft) fill.set(asking.draft); act({ t: "chat", threadId: id, pane: true }); }
      else { setLine("Could not open the Ask. You may not see that yet."); act({ t: "agent", agentId: who, tab: "chats" }); }
    });
    return () => { live = false; };
  }, [asking?.agentId, asking?.scopeType, asking?.scopeId, asking?.bringFrom, asking?.draft, asking?.first, rt, act, fill]);
  const go = useMemo<Go>(() => createGo(rt, act, nameOf, setLine), [rt, act, nameOf]);
  const route = shown.route;
  // Cmd/Ctrl+Shift+F searches every chat, from anywhere in the place
  useEffect(() => {
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault: () => void }) => void) => void; removeEventListener?: (t: string, f: unknown) => void };
    const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault: () => void }): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); go.search(); }
    };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, [go]);
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < WIDE;

  /* ---------- the sidebar: registered in the shell's shared place sidebar slot (collapse, search and the phone list are the slot's) ---------- */
  const side = useMemo(() => {
    const base = wireSidebar(rt, go);
    return { ...base, people: list.filter((p) => p.kind === "person" && p.id !== rt.me.id).map((p) => ({ id: p.id, name: p.name })), nav: { ...base.nav, openTasks: () => act({ t: "tasks" }), openThreads: () => act({ t: "threads" }), openNew: () => act({ t: "new" }) } };
  }, [rt, go, act, list]);

  /* ---------- the open chat ---------- */
  const recent = useLive<RecentOut>(rt.screens, "chats.sidebar", "recent", { filter: "all" });
  const threadId = route.view === "chat" ? route.threadId : null;
  const thread = useLive<ThreadOut>(rt.screens, "chats.conversation", "thread", threadId === null ? null : { threadId });
  if (thread.status === "ready" && threadId !== null) noteThreadKind(threadId, thread.data.thread.kind);
  const lead = thread.status === "ready" && threadId !== null ? (thread.data.thread.agents.find((a) => a.mode === "lead") ?? thread.data.thread.agents[0]) : undefined;
  const leadId = lead?.agentId ?? rt.assistant.id;
  // agent computers run on a capable host: a Personal Space with none never asks for them and draws nothing about them
  const canRunComputers = useComputersAvailable(rt);
  const computers = useLive<ComputersOut>(rt.screens, "console.agent-computers", "computers", canRunComputers ? {} : null);
  const computerOf = (agentId: string): string | undefined => (computers.status === "ready" ? computers.data.computers.find((c) => c.agentId === agentId)?.computerId : undefined);
  const leadComputer = computerOf(leadId);
  const leadAgent = useMemo(() => ({ agentId: leadId, name: nameOf(leadId), ...(leadComputer ? { computerId: leadComputer } : {}) }), [leadId, nameOf, leadComputer]);

  const focus = route.view === "chat" ? route.focus : undefined;
  const conv = useMemo(
    () => (threadId === null ? null : wireConversation(rt, go, { threadId, list, nameOf, leadId, fill, ...(focus ? { focus } : {}) })),
    [rt, go, threadId, list, nameOf, leadId, fill, focus],
  );
  const searchData = useMemo<SearchData>(() => ({
    call: rt.call, me: { id: rt.me.id, name: rt.me.name }, nameOf, kindOf: (id) => (byId.get(id)?.kind === "agent" || id === rt.assistant.id ? "agent" : "person"), clock: rt.clock,
    query: route.view === "search" ? route.q : "", openMessage: go.message, openThread: go.chat, close: go.closeSearch, copy,
  }), [rt, nameOf, byId, route, go]);
  const terminal = useMemo(() => terminalData(rt, go, { agent: leadAgent, nameOf, newKey }), [rt, go, leadAgent, nameOf]);
  const paneCtx = useMemo(() => (threadId === null ? null : wirePane(rt, go, threadId, leadAgent, fill, terminal)), [rt, go, threadId, leadAgent, fill, terminal]);

  /* ---------- the other pages ---------- */
  const needs = useMemo(() => needsData(rt, go, nameOf), [rt, go, nameOf]);
  const importedData = useMemo<ImportedData>(() => ({ call: rt.call, clock: rt.clock, spaceId: rt.space.id, assistantId: rt.assistant.id, openChat: go.chat }), [rt, go]);
  const helperId = route.view === "helper" ? route.threadId : "";
  const helper = useMemo(() => helperData(rt, go, helperId, nameOf), [rt, go, helperId, nameOf]);
  const agentId = route.view === "agent" ? route.agentId : "";
  const agentQ = useLive<AgentOut>(rt.screens, "chats.agent-page", "agent", agentId !== "" ? { agentId } : null);
  const agentRow = agentQ.status === "ready" && agentId !== "" ? agentQ.data.agent : null;
  const agentComputer = computerOf(agentId);
  const agentPage = useMemo(
    () => agentPageData(rt, go, { agent: { agentId, name: agentRow?.name ?? nameOf(agentId), ...(agentComputer ? { computerId: agentComputer } : {}) }, canEdit: agentRow !== null && agentRow.ownerId === rt.me.id, nameOf, fill }),
    [rt, go, agentId, agentRow, agentComputer, nameOf, fill],
  );

  /* ---------- the middle ---------- */
  let main: ReactElement;
  if (route.view === "search") main = <SearchPage key={route.q} data={searchData} />;
  else if (route.view === "needs") main = <NeedsYou data={needs} {...(route.taskId ? { initialSelected: route.taskId } : {})} {...(window ? { window } : {})} />;
  else if (route.view === "imported") main = <ImportedSession key={route.conversationId} conversationId={route.conversationId} data={importedData} />;
  else if (route.view === "helper") main = helperId === "" ? <HelperChatLoading /> : <HelperChat key={helperId} data={helper} />;
  else if (route.view === "agent") main = agentId === "" ? <AgentPageLoading /> : <AgentPage key={agentId} data={agentPage} initialTab={route.tab ?? "chats"} {...(window ? { window } : {})} />;
  else if (route.view === "tasks") main = <TasksRoute rt={rt} />;
  else if (route.view === "task") main = <TaskRouteLeaf rt={rt} taskId={route.taskId} onBack={() => act({ t: "tasks" })} />;
  else if (route.view === "threads") main = <ThreadsPage rt={rt} nameOf={nameOf} openChat={go.thread} />;
  else if (route.view === "new") {
    const agentRows = list.filter((p) => p.kind === "agent").map((p) => ({ id: p.id, name: p.name }));
    const people = list.filter((p) => p.kind === "person" && p.id !== rt.me.id).map((p) => ({ id: p.id, name: p.name }));
    main = <Landing rt={rt} nameOf={nameOf} kindOf={(id) => (byId.get(id)?.kind === "agent" || id === rt.assistant.id ? "agent" : "person")} agents={agentRows} people={people} openChat={go.chat} openTasks={() => act({ t: "tasks" })} openNeed={(id) => go.needs(id)} openProfile={(id) => { if (byId.get(id)?.kind === "agent") go.agent(id); }} fill={(t) => fill.set(t)} newKey={newKey} say={setLine} />;
  }
  else if (conv) {
    const work = thread.status === "ready" ? workOf(thread.data.thread) : null;
    main = work && width >= WORKSPACE_MIN_W ? <Workspace rt={rt} work={work}><Conversation key={conv.threadId} data={conv} /></Workspace> : <Conversation key={conv.threadId} data={conv} />;
  }
  else main = <ConversationLoading />;

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
    right = <View style={st.pane}><AgentPane data={paneCtx} open onToggle={go.togglePane} {...(window ? { window } : {})} /></View>;
  }

  const showMain = !(narrow && right !== null);
  return (
    <View testID="chats-place" style={st.row}>
      <ChatsSidebarSlot data={side} {...(window ? { window } : {})} />
      {showMain ? (
        <View testID="chats-main" style={st.main}>
          <View style={st.fill}>{main}</View>
        </View>
      ) : null}
      {right}
      <Layer shown={shown} rt={rt} go={go} nameOf={nameOf} list={list} counter={counter} terminal={terminal} window={window} />
      {line ? <View testID="chats-line" accessibilityRole="alert" accessibilityLiveRegion="polite" style={st.toast}><Text style={st.toastText}>{line.text}</Text>{line.action ? <TextButton label={line.action.label} testID="chats-line-action" onPress={() => { const run = line.action?.run; setLineState(null); run?.(); }} /> : null}</View> : null}
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
          onCreate={(name) => Promise.resolve(rt.call("agents.create", { name, idempotencyKey: newKey() })).then((o) => (o as { agent: { agentId: string } }).agent.agentId)} onClose={go.closeLayer} {...(window ? { window } : {})}
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
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  // No pixel width on the wrappers: the SidePane inside owns its width (dragged, remembered), so the wrapper must follow it.
  pane: { minHeight: 0 },
  fill: { flex: 1, minHeight: 0 },
  terminal: { minHeight: 0 },
  terminalFull: { flex: 1, minWidth: 0, minHeight: 0 },
  toast: { position: "absolute", left: 16, bottom: 16, maxWidth: 420, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string },
  toastText: { fontSize: 12.5, color: "var(--ink)" as string },
});
