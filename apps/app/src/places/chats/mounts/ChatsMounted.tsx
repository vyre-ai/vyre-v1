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
import { AgentPane } from "../AgentPane.tsx";
import { ChatsSidebar, ChatsSidebarSlot } from "../sidebar/ChatsSidebar.tsx";
import { TerminalList } from "../terminal/TerminalList.tsx";
import { TerminalRules } from "../terminal/TerminalRules.tsx";
import { TerminalTab } from "../terminal/TerminalTab.tsx";
import { AllAgents } from "./AllAgents.tsx";
import { ConnectOutsideAgent } from "./ConnectOutsideAgent.tsx";
import type { ConnectProps } from "./ConnectOutsideAgent.tsx";
import { SearchPage } from "../search/SearchPage.tsx";
import type { SearchData } from "../search/SearchPage.tsx";
import { TextButton } from "../conversation/parts.tsx";
import { channelThread, isChannelId, copy, threadDoor, agentPageData, askWith, chatOpening, chatWith, createCapture, createGo, helperData, needsData, newKey, popupData, terminalData, wireConversation, wirePane, wireSidebar } from "./data.ts";
import type { CaptureCounter, Go, LineAction } from "./data.ts";
import { useLive } from "./live.ts";
import { noteThreadKind } from "../../../shell/ask/screen.ts";
import { START, fromHash, openKeyOf, step, workOf } from "./route.ts";
import { Landing } from "../landing/Landing.tsx";
import { ThreadsPage } from "./ThreadsPage.tsx";
import { ThreadSide } from "./ThreadSide.tsx";
import { ArtifactsPage } from "./ArtifactsPage.tsx";
import { NotesPage } from "../notes/NotesPage.tsx";
import type { NotesInitial } from "../notes/NotesPage.tsx";
import { AgentForm } from "../agentform/AgentForm.tsx";
import { setAgentFaces } from "../../../../../../ui/src/Avatar/assistant.ts";
import { useDirectory } from "../../../shell/providers/automations-parts.tsx";
import { ProfilePane, afterClose, profileTab, withTab } from "../rightpane/ProfilePane.tsx";
import type { ProfileTab } from "../rightpane/ProfilePane.tsx";
import { ReplyDetailsPane } from "../details/ReplyDetailsPane.tsx";
import { readReplyDetails } from "../details/read.ts";
import type { Call } from "../details/read.ts";
import { Avatar, avatarOf } from "../../../../../../ui/src/Avatar/index.tsx";
import { WORKSPACE_MIN_W, Workspace } from "./Workspace.tsx";
import { ChatWork } from "../tasks/ChatWork.tsx";
import { TasksPage } from "../tasks/TasksPage.tsx";
import { TaskDetail } from "../tasks/TaskDetail.tsx";
import { GoalPage } from "../goals/GoalPage.tsx";
import type { Act, Shown } from "./route.ts";
import { nameOr } from "../names.ts";
import { LoadFailed } from "../../../../../../ui/src/States/Loads.tsx";
import type { LoadFailure } from "../../../../../../ui/src/States/Loads.tsx";
import { offered } from "../../../shell/session/private-agents.ts";

/** A channel id; the place shows a channel as its main thread. */

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
  opened?: (target: { subject?: { type: string; id: string }; screen?: string; args?: Record<string, unknown> }) => void;
  /** The middle is about to change: the shell keeps a still copy on screen until the next view is ready. */
  onSwitch?: () => void;
  /** Closes the tab this page sits in: a page that is finished leaves no stale tab behind. */
  closeSelf?: () => void;
  /** A phone: what opens from the first screen goes on top of its history, so Back returns here. */
  stacked?: boolean;
  /** Opens a link of this place in a tab behind this one (a row's "Open in a new tab"). Left out where the shell has no tabs. */
  openInNewTab?: (hash: string) => void;
  /** Where Notes starts: a sheet, a menu or the bar open (tests and screenshots). */
  notesInitial?: NotesInitial;
}

export function ChatsMounted({ rt, hash = "", initial, window, opened, onSwitch, closeSelf, stacked = false, openInNewTab, notesInitial }: ChatsMountedProps): ReactElement {
  const [shown, setShown] = useState<Shown>(() => initial ?? (hash === "" ? START : fromHash(hash)));
  const [line, setLineState] = useState<{ text: string; action?: LineAction } | null>(null);
  const setLine = useCallback((text: string, action?: LineAction): void => setLineState(action ? { text, action } : { text }), []);
  const [counter] = useState<CaptureCounter>(createCapture);
  // what a pane or the agent's page asks the composer to hold (Ask about this file, Change by Asking)
  const [fill] = useState<ComposerFill>(createComposerFill);

  const live = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const list = live.status === "ready" ? live.data : NO_PEOPLE;
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p] as const)), [list]);
  const pickList = useMemo(() => list.filter((p) => p.kind === "person" || p.kind === "agent").map((p) => ({ id: p.id, name: p.name, kind: p.kind === "agent" ? "agent" as const : "person" as const })), [list]);
  const nameOf = useCallback((id: string): string => (id === rt.assistant.id ? rt.assistant.name : nameOr(byId.get(id)?.name, id)), [byId, rt.assistant.id, rt.assistant.name]);

  // what someone picked on an agent's page shows on every face of that agent
  useEffect(() => {
    let live = true;
    void Promise.resolve(rt.call("agents.list", { section: "space" })).then((o) => { if (live) setAgentFaces((o as CapMap["agents.list"]["out"]).agents.map((a) => ({ id: a.agentId, face: a.face }))); }, () => undefined);
    return () => { live = false; };
  }, [rt, shown.route.view]);

  useEffect(() => {
    if (line === null) return undefined;
    const t = setTimeout(() => setLineState(null), LINE_MS);
    return () => clearTimeout(t);
  }, [line]);

  const routeNow = useRef(shown.route.view);
  routeNow.current = shown.route.view;
  const act = useCallback((a: Act): void => {
    if (stacked && a.t === "chat" && routeNow.current === "new" && a.threadId !== "") { opened?.({ subject: { type: "thread", id: a.threadId } }); return; }
    if (a.t === "chat" || a.t === "new" || a.t === "tasks" || a.t === "task" || a.t === "threads" || a.t === "artifacts" || (a.t === "notes" && routeNow.current !== "notes") || a.t === "agent-form" || a.t === "agent" || a.t === "needs") onSwitch?.();
    setShown((s) => step(s, a));
  }, [onSwitch, stacked, opened]);
  // a link from another place, a notification or the Space menu while Chats is already open
  const linked = useRef(hash);
  useEffect(() => {
    if (hash === linked.current) return;
    linked.current = hash;
    // a tab switch or a link: the same thing already on screen keeps its pane and its place
    setShown((s) => { const next = hash === "" ? START : fromHash(hash); return JSON.stringify(next.route) === JSON.stringify(s.route) ? s : { ...next, pane: s.pane, terminalId: s.terminalId }; });
  }, [hash]);
  // what is open follows into the tab and the address (the Chats tab moves with it; tabs/store.ts moveTab), so coming back lands on it
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const routeKey = shown.route.view === "agent-form" ? `a:${shown.route.agentId ?? ""}` : shown.route.view === "chat" ? `t:${shown.route.threadId ?? ""}` : shown.route.view === "new" ? "new" : shown.route.view === "task" ? `k:${shown.route.taskId}` : shown.route.view === "tasks" ? "tasks" : shown.route.view === "threads" ? "threads" : shown.route.view === "artifacts" ? "artifacts" : shown.route.view === "notes" ? "notes" : "";
  useEffect(() => {
    const report = openedRef.current;
    if (!report || routeKey === "") return;
    if (routeKey === "new") report({});
    else if (routeKey === "tasks") report({ screen: "tasks.my-work" });
    else if (routeKey === "threads") report({ screen: "chats.threads" });
    else if (routeKey === "artifacts") report({ screen: "chats.artifacts" });
    else if (routeKey === "notes") report({ screen: "chats.notes" });
    else if (routeKey.startsWith("a:")) report({ screen: "chats.agent-form", ...(routeKey.length > 2 ? { args: { agentId: routeKey.slice(2) } } : {}) });
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
  // right tabs: what was opened from a chat, closable, after the pane's own. Pressing any face or name opens that profile here, person or agent.
  const [rightTabs, setRightTabs] = useState<readonly ProfileTab[]>([]);
  const [rightOn, setRightOn] = useState<string | null>(null);
  // the task open beside the chat it was pressed in; it closes when the chat changes
  const [sideTask, setSideTask] = useState<string | null>(null);
  const openSideTask = useCallback((id: string): void => setSideTask(id), []);
  const chatShown = shown.route.view === "chat" ? shown.route.threadId : null;
  useEffect(() => { setSideTask(null); }, [chatShown]);
  const profile = useCallback((id: string): void => {
    const agent = id === rt.assistant.id ? "assistant" as const : byId.get(id)?.kind === "person" ? "person" as const : "agent" as const;
    const tab = profileTab(id, nameOf(id), agent);
    setRightTabs((t) => withTab(t, tab));
    setRightOn(tab.key);
  }, [rt.assistant.id, byId, nameOf]);
  // a reply's Details: one tab, which shows the reply asked for last (opening another reply's Details moves the tab to it)
  const replyDetails = useCallback((threadId: string, messageId: string, agentId?: string): void => {
    const tab: ProfileTab = { key: "details", id: messageId, title: "Details", kind: "details", threadId, ...(agentId ? { agentId } : {}) };
    setRightTabs((t) => (t.some((x) => x.key === "details") ? t.map((x) => (x.key === "details" ? tab : x)) : [...t, tab]));
    setRightOn("details");
    // the details sit in the agent pane's tabs: a task open beside the chat steps aside so they show
    setSideTask(null);
    go.openPane();
  }, [go]);
  const closeRight = useCallback((key: string): void => {
    setRightOn((on) => { if (on !== key) return on; return afterClose(rightTabs, key); });
    setRightTabs((t) => t.filter((x) => x.key !== key));
  }, [rightTabs]);
  const route = shown.route;
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < WIDE;
  // the sidebar draws the row of what the middle shows, however it was opened (a row, a tab, a link, Cmd-K)
  const openKey = openKeyOf(route);
  // Cmd/Ctrl+Shift+F searches every chat, from anywhere in the place
  useEffect(() => {
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault: () => void }) => void) => void; removeEventListener?: (t: string, f: unknown) => void };
    const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault: () => void }): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); go.search(); }
    };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, [go]);
  const directory = useDirectory(rt);

  /* ---------- the sidebar: registered in the shell's shared place sidebar slot (collapse, search and the phone list are the slot's) ---------- */
  const side = useMemo(() => {
    const base = wireSidebar(rt, go);
    return { ...base, people: list.filter((p) => p.kind === "person" && p.id !== rt.me.id).map((p) => ({ id: p.id, name: p.name })), nav: { ...base.nav, openTasks: () => act({ t: "tasks" }), openThreads: () => act({ t: "threads" }), ...(base.nav.openArtifacts ? { openArtifacts: () => act({ t: "artifacts" }) } : {}), openNotes: () => act({ t: "notes" }), takeNote: () => act({ t: "notes", take: true }), ...(openInNewTab ? { openNotesTab: () => openInNewTab("screen=chats.notes") } : {}), openNew: () => act({ t: "new" }), openNewAgent: () => act({ t: "agent-form" }), openGoal: (goalId: string) => rt.open({ subject: { type: "goal", id: goalId } }) }, ...(rt.changes ? { changes: rt.changes } : {}) };
  }, [rt, go, act, list, openInNewTab]);

  /* ---------- the open chat ---------- */
  const recent = useLive<RecentOut>(rt.screens, "chats.sidebar", "recent", { filter: "all" });
  // A channel is opened by its id (the sidebar row, a new channel, Browse, a project's channel, a chat:channel link) but shown as its main thread: the thread capabilities refuse a channel id.
  // The id is turned into the thread here, once, for every way in; until then the middle waits, and a channel that cannot be read says so with Retry.
  const channelOpen = route.view === "chat" && route.threadId !== null && isChannelId(route.threadId) ? route.threadId : null;
  const [channelFailed, setChannelFailed] = useState<{ id: string; failure: LoadFailure } | null>(null);
  const [channelTry, setChannelTry] = useState(0);
  useEffect(() => {
    if (channelOpen === null) return undefined;
    const asked = channelOpen;
    let live = true;
    setChannelFailed(null);
    void channelThread(rt.call as (cap: string, input: unknown) => Promise<unknown>, asked).then((r) => {
      if (!live) return;
      if ("threadId" in r) act({ t: "chat", threadId: r.threadId, ...(route.view === "chat" && route.focus ? { focus: route.focus } : {}) });
      else setChannelFailed({ id: asked, failure: r.failure });
    });
    return () => { live = false; };
  }, [channelOpen, channelTry, rt, act]);   // eslint-disable-line react-hooks/exhaustive-deps
  const threadId = route.view === "chat" && channelOpen === null ? route.threadId : null;
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

  // A reply thread opened as a chat (a link, a notification, an old tab) opens beside its message instead; a task's thread opens on its task.
  const door = thread.status === "ready" && threadId !== null && thread.data.thread.threadId === threadId ? threadDoor(thread.data.thread) : null;
  useEffect(() => {
    if (door === null || threadId === null) return;
    if (door.t === "side") act({ t: "chat", threadId: door.parent, focus: door.messageId, side: threadId });
    else if (door.t === "task") act({ t: "task", taskId: door.taskId });
  }, [door?.t, threadId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const focus = route.view === "chat" ? route.focus : undefined;
  const focusN = route.view === "chat" ? route.focusN : undefined;
  const conv = useMemo(
    () => {
      if (threadId === null) return null;
      const wired = wireConversation(rt, go, { threadId, list, nameOf, leadId, fill, ...(focus ? { focus } : {}), ...(focusN ? { focusN } : {}) });
      // a task link in the chat opens beside it, where it was pressed
      const openBeside = (kind: string, id: string): void => { if (kind === "task") openSideTask(id); else wired.nav.openBeside(kind, id); };
      return { ...wired, nav: { ...wired.nav, openAgent: profile, openBeside, openDetails: (tid: string, mid: string) => replyDetails(tid, mid) } };
    },
    [rt, go, threadId, list, nameOf, leadId, fill, focus, focusN, profile, openSideTask, replyDetails],
  );
  // the thread beside the chat: its parent box goes back to the message in the chat (on a phone the sheet steps aside first)
  const sideId = route.view === "chat" && threadId !== null ? shown.side ?? null : null;
  const sideConv = useMemo(() => {
    if (sideId === null) return null;
    const wired = wireConversation(rt, go, { threadId: sideId, list, nameOf, leadId: rt.assistant.id, fill });
    return { ...wired, nav: { ...wired.nav, openAgent: profile, openThread: (id: string, messageId?: string) => { if (messageId) { if (narrow) go.closeSide(); go.message(id, messageId); } else go.thread(id); } } };
  }, [rt, go, sideId, list, nameOf, fill, profile, narrow]);
  const conversationFor = useCallback((id: string) => wireConversation(rt, go, { threadId: id, list, nameOf, leadId: rt.assistant.id, fill }), [rt, go, list, nameOf, fill]);
  const searchData = useMemo<SearchData>(() => ({
    call: rt.call, me: { id: rt.me.id, name: rt.me.name }, nameOf, kindOf: (id) => (byId.get(id)?.kind === "agent" || id === rt.assistant.id ? "agent" : "person"), clock: rt.clock,
    query: route.view === "search" ? route.q : "", openMessage: go.message, openThread: go.chat, close: go.closeSearch, copy,
  }), [rt, nameOf, byId, route, go]);
  const terminal = useMemo(() => terminalData(rt, go, { agent: leadAgent, nameOf, newKey }), [rt, go, leadAgent, nameOf]);
  const paneCtx = useMemo(() => (threadId === null ? null : wirePane(rt, go, threadId, leadAgent, fill, terminal)), [rt, go, threadId, leadAgent, fill, terminal]);

  /* ---------- the other pages ---------- */
  const importedData = useMemo<ImportedData>(() => ({ call: rt.call, clock: rt.clock, spaceId: rt.space.id, assistantId: rt.assistant.id, openChat: go.chat }), [rt, go]);
  const helperId = route.view === "helper" ? route.threadId : "";
  const helper = useMemo(() => helperData(rt, go, helperId, nameOf), [rt, go, helperId, nameOf]);
  const agentId = route.view === "agent" ? route.agentId : "";
  const agentQ = useLive<AgentOut>(rt.screens, "chats.agent-page", "agent", agentId !== "" ? { agentId } : null);
  const agentRow = agentQ.status === "ready" && agentId !== "" ? agentQ.data.agent : null;
  const agentComputer = computerOf(agentId);
  const agentPage = useMemo(
    () => agentPageData(rt, go, { agent: { agentId, name: agentId === rt.assistant.id ? rt.assistant.name : agentRow?.name ?? nameOf(agentId), ...(agentComputer ? { computerId: agentComputer } : {}) }, canEdit: agentRow !== null && agentRow.ownerId === rt.me.id, nameOf, fill }),
    [rt, go, agentId, agentRow, agentComputer, nameOf, fill],
  );

  /* ---------- the middle ---------- */
  let main: ReactElement;
  if (route.view === "tasks") main = <TasksPage rt={rt} openTask={go.task} openAgent={(id) => go.agent(id)} openChat={(text) => rt.open({ screen: "chats.ask", args: { with: "assistant", first: text } })} {...(window ? { window } : {})} />;
  else if (route.view === "task") main = <TaskDetail key={route.taskId} rt={rt} taskId={route.taskId} conversationFor={conversationFor} openTask={go.task} openAgent={(id) => go.agent(id)} openChat={(id) => rt.open({ screen: "chats.conversation", args: { threadId: id } })} back={() => act({ t: "tasks" })} />;
  else if (route.view === "goal") main = <GoalPage key={route.goalId} goalId={route.goalId} call={rt.call as (cap: string, input: unknown) => Promise<unknown>} changes={rt.changes} me={rt.me.id} nameOf={nameOf} clock={rt.clock} conversationFor={conversationFor} openTask={go.task} openAgent={(id) => go.agent(id)} openFolder={(id) => rt.open({ subject: { type: "folder", id } })} openFile={(id) => rt.open({ subject: { type: "file", id } })} fill={(t) => fill.set(t)} directory={pickList} />;
  else if (route.view === "search") main = <SearchPage key={route.q} data={searchData} />;
  else if (route.view === "needs") main = <TasksPage rt={rt} openTask={go.task} openAgent={(id) => go.agent(id)} openChat={(text) => rt.open({ screen: "chats.ask", args: { with: "assistant", first: text } })} {...(window ? { window } : {})} />;
  else if (route.view === "imported") main = <ImportedSession key={route.conversationId} conversationId={route.conversationId} data={importedData} />;
  else if (route.view === "helper") main = helperId === "" ? <HelperChatLoading /> : <HelperChat key={helperId} data={helper} />;
  else if (route.view === "agent") main = agentId === "" ? <AgentPageLoading /> : <AgentPage key={agentId} data={agentPage} {...(route.tab ? { initialTab: route.tab } : {})} {...(window ? { window } : {})} />;
  else if (route.view === "agent-form") main = <AgentForm key={route.agentId ?? "new"} agentId={route.agentId} call={rt.call as (cap: string, input: unknown) => Promise<unknown>} newKey={newKey} onDone={(id) => { closeSelf?.(); go.agentChat(id); }} onCancel={() => act({ t: "new" })} say={setLine} openVault={() => rt.open({ screen: "vault.providers" })} {...(rt.space.kind === "personal" ? {} : { sharing: { directory, meName: rt.me.name, meId: rt.me.id, nameOf } })} />;
  else if (route.view === "threads") main = <ThreadsPage rt={rt} nameOf={nameOf} openChat={go.thread} say={setLine} />;
  else if (route.view === "artifacts") main = <ArtifactsPage rt={rt} />;
  else if (route.view === "notes") main = <NotesPage rt={rt} nameOf={nameOf} noteId={route.noteId ?? null} {...(route.take ? { takeNonce: route.take } : {})} {...(notesInitial ? { initial: notesInitial } : {})} />;
  else if (route.view === "new") {
    const agentRows = list.filter((p) => p.kind === "agent" && offered(p)).map((p) => ({ id: p.id, name: p.name }));
    const people = list.filter((p) => p.kind === "person" && p.id !== rt.me.id).map((p) => ({ id: p.id, name: p.name }));
    main = <Landing rt={rt} nameOf={nameOf} kindOf={(id) => (byId.get(id)?.kind === "agent" || id === rt.assistant.id ? "agent" : "person")} agents={agentRows} people={people} openChat={go.chat} openTasks={() => act({ t: "tasks" })} openNeed={(id) => go.needs(id)} openProfile={profile} fill={(t) => fill.set(t)} newKey={newKey} say={setLine} {...(stacked ? { list: <ChatsSidebar data={side} open={openKey} {...(window ? { window } : {})} /> } : {})} />;
  }
  else if (conv) {
    const work = thread.status === "ready" ? workOf(thread.data.thread) : null;
    const live = { ...conv, tail: <ChatWork rt={rt} threadId={conv.threadId} nameOf={nameOf} openTask={openSideTask} openProfile={(who) => { if (who.kind === "agent") go.agent(who.id); else rt.open({ subject: { type: "contact", id: who.id } }); }} /> };
    main = work && width >= WORKSPACE_MIN_W ? <Workspace rt={rt} work={work}><Conversation key={conv.threadId} data={live} /></Workspace> : <Conversation key={conv.threadId} data={live} />;
  }
  else if (channelOpen !== null && channelFailed?.id === channelOpen) main = <LoadFailed what="this channel" failure={channelFailed.failure} onRetry={() => setChannelTry((n) => n + 1)} testID="channel-failed" />;
  else main = <ConversationLoading />;

  /* ---------- the right ---------- */
  const rightTab = rightTabs.find((t) => t.key === rightOn);
  const rightSpecs = rightTabs.map((t) => ({ key: t.key, title: t.title, ...(t.kind === "details" ? {} : { lead: <Avatar {...avatarOf({ id: t.id, name: nameOf(t.id), kind: t.kind })} size={16} /> }) }));
  const rightBody = rightTab?.kind === "details" ? (
    <ReplyDetailsPane
      key={`details:${rightTab.id}`} messageId={rightTab.id}
      details={{ read: (mid) => readReplyDetails(rt.call as Call, rightTab.threadId ?? "", mid), open: (mid) => replyDetails(rightTab.threadId ?? "", mid), meId: rt.me.id, nameOf }}
      copy={(text, what) => { copy(text); setLine(`Copied the ${what}`); }}
    />
  ) : rightTab ? (
    <ProfilePane
      key={rightTab.key} tab={rightTab} name={nameOf(rightTab.id)} call={rt.call as (cap: string, input: unknown) => Promise<unknown>}
      onMessage={() => { if (rightTab.kind === "person") void Promise.resolve(rt.call("chat.start", { kind: "chat", agentIds: [], personId: rightTab.id, idempotencyKey: `dm_${rightTab.id}` })).then((o) => { const id = (o as { thread?: { threadId?: string } }).thread?.threadId; if (id) go.chat(id); }, () => setLine("Could not start the chat. Try again.")); else go.agentChat(rightTab.id); }}
      onMention={() => fill.set(`@${nameOf(rightTab.id)} `)}
      onEdit={() => act({ t: "agent-form", agentId: rightTab.id })}
    />
  ) : null;
  let right: ReactElement | null = null;
  const beside = sideId !== null && sideConv !== null ? <ThreadSide key={sideId} rt={rt} threadId={sideId} data={sideConv} narrow={narrow} onClose={go.closeSide} say={setLine} /> : null;
  if (beside !== null && !narrow) {
    right = <View testID="chats-thread-side" style={st.pane}>{beside}</View>;
  } else if (sideTask !== null && route.view === "chat" && shown.terminalId === null) {
    // a task pressed in a chat opens beside it, in the right pane; Open full page takes it to its own page
    right = (
      <View testID="chats-task-pane" style={narrow ? st.terminalFull : st.pane}>
        <SidePane paneKey="chats-task-pane" toggle={{ open: true, onPress: () => setSideTask(null) }} title="Task" tabs={[{ key: "task", title: "Task" }]} activeTab="task" onCloseTab={() => setSideTask(null)} defaultWidth={460}>
          <TaskDetail key={sideTask} rt={rt} taskId={sideTask} rail={false} conversationFor={conversationFor} openTask={openSideTask} openAgent={(id) => go.agent(id)} openChat={(id) => go.chat(id)} openFull={(id) => { setSideTask(null); act({ t: "task", taskId: id }); }} />
        </SidePane>
      </View>
    );
  } else if (shown.terminalId !== null) {
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
    right = <View style={st.pane}><AgentPane data={paneCtx} open onToggle={go.togglePane} {...(window ? { window } : {})} extra={{ tabs: rightSpecs, active: rightOn, onSelect: setRightOn, onClose: closeRight, body: rightBody }} /></View>;
  } else if (rightOn !== null) {
    right = (
      <View style={st.pane}>
        <SidePane paneKey="chats-right-pane" toggle={{ open: true, onPress: () => setRightOn(null) }} title="Profile" tabs={rightSpecs} activeTab={rightOn} onSelectTab={setRightOn} onCloseTab={closeRight} defaultWidth={372}>
          {rightBody}
        </SidePane>
      </View>
    );
  }

  const showMain = !(narrow && right !== null);
  return (
    <View testID="chats-place" style={st.row}>
      <ChatsSidebarSlot data={side} open={openKey} {...(window ? { window } : {})} />
      {showMain ? (
        <View testID="chats-main" style={st.main}>
          <View style={st.fill}>{main}</View>
        </View>
      ) : null}
      {right}
      {narrow ? beside : null}
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
    case "connect": return <ConnectOutsideAgent call={rt.call as ConnectProps["call"]} onClose={go.closeLayer} say={go.say} />;
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
