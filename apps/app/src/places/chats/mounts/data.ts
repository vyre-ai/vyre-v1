// The data contexts the mounted screens read, built from the Space's runtime (P-L9b_23). Each screen already built under places/chats (the agent page, the helper chat, Needs you, the
// computer popup) reads one context of the same shape: the runtime's screen hooks and `call`, the connection, who is looking, and a nav that says what a click opens. Here the
// nav is `Go`: the place's own doors, so a click on a face or a helper or the Computer chip changes what the place shows instead of asking the shell to open somewhere else.
// Nothing here touches the network.
import { createElement } from "react";
import type { QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { conversationData, paneData, sidebarData } from "../../../shell/providers/chats-data.ts";
import type { ChatsActions } from "../../../shell/providers/chats-data.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import type { Principal } from "../../home/sections-a/data.tsx";
import type { ChatsSidebarData } from "../sidebar/data.tsx";
import type { ConversationData } from "../conversation/data.tsx";
import type { ChatRightPaneData } from "../rightpane/data.tsx";
import { LOCAL_PREFIX } from "../sidebar/model.ts";
import { openSession } from "../terminal/session.ts";
import { anchorOfFocus } from "./route.ts";
import type { Act } from "./route.ts";
import { WaitingLine } from "./WaitingOn.tsx";
import type { AgentPageData } from "../agentpage/data.tsx";
import type { TabKey } from "../agentpage/model.ts";
import type { ComputerPopupData } from "../computer/data.tsx";
import type { CaptureStore, Capture } from "../computer/model.ts";
import { NO_CAPTURE } from "../computer/model.ts";
import type { HelperChatData } from "../helper/data.tsx";
import type { NeedsYouData } from "../needsyou/data.tsx";
import type { PaneAgent } from "../rightpane/data.tsx";
import type { TerminalData } from "../terminal/data.ts";

type RecentOut = CapMap["chat.recent"]["out"];
type ThreadOut = CapMap["threads.get"]["out"];
type ComputersOut = CapMap["computers.list"]["out"];

let keySeq = 0;
/** A fresh idempotency key for one write. */
export const newKey = (): string => `k_${Date.now().toString(36)}_${(keySeq++).toString(36)}`;

/** The place's doors. Every click that opens something in the Chats place goes through one of these. */
export interface Go {
  chat(threadId: string): void;
  /** A thread of any kind: a helper opens as the helper chat, anything else as a chat. */
  thread(threadId: string): void;
  agent(agentId: string, tab?: TabKey): void;
  needs(taskId?: string): void;
  /** The agent's own chat (chat.start returns it). */
  agentChat(agentId: string): void;
  computer(computerId: string, chat?: boolean): void;
  /** The computer of an agent, when it has one; the place says so when it has not. */
  computerOfAgent(agentId: string): void;
  terminal(terminalId: string): void;
  /** A terminal on this agent computer: the one already open, else a new one. */
  terminalOfComputer(computerId: string): void;
  terminals(): void;
  rules(): void;
  connect(channelId: string): void;
  recording(recordingId: string): void;
  allAgents(): void;
  closeLayer(): void;
  closeTerminal(): void;
  togglePane(): void;
  /** A line the place shows for a moment. */
  say(text: string): void;
}

const copy = (text: string): void => {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (clip) void clip.writeText(text);
};
export { copy };

/** The title of the chat, channel or thread a request or a fact came from, read from the sidebar's kept list; absent when the copy does not have it. */
export function titleFrom(rt: ShellRuntime, kind: string, id: string): string | undefined {
  if (kind !== "chat" && kind !== "thread" && kind !== "channel") return undefined;
  const snap = rt.screens.query("chats.sidebar", "recent", { filter: "all" }).getSnapshot() as QueryState<RecentOut>;
  if (snap.status !== "ready") return undefined;
  for (const g of [snap.data.starred, snap.data.today, snap.data.yesterday, snap.data.earlier]) {
    const hit = g.find((i) => i.threadId === id);
    if (hit) return hit.title;
  }
  return undefined;
}

export function agentPageData(rt: ShellRuntime, go: Go, o: { agent: PaneAgent; canEdit: boolean; nameOf: (id: string) => string }): AgentPageData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, agent: o.agent, me: { id: rt.me.id, name: rt.me.name }, nameOf: o.nameOf, canEdit: o.canEdit,
    space: { name: rt.space.name, personal: rt.space.kind === "personal" },
    nav: {
      openThread: (id) => go.thread(id),
      openHelper: (id) => go.thread(id),
      openComputer: (computerId) => go.computer(computerId),
      openTerminal: (computerId) => go.terminalOfComputer(computerId),
      openFile: (fileId) => rt.open({ subject: { type: "file", id: fileId } }),
      fillComposer: () => undefined,
      openSource: (kind, ref) => rt.open({ subject: { type: kind, id: ref } }),
      openAgentPage: (agentId) => go.agent(agentId),
      openRoutineFile: (agentId) => go.agent(agentId, "settings"),
      skillFromStep: (computerId, stepId) => rt.open({ screen: "chats.agent-computer", args: { computerId, stepId } }),
      openChat: (id) => go.chat(id),
      openFolder: (folderId) => rt.open({ subject: { type: "folder", id: folderId } }),
      openAgentFile: (agentId, file) => rt.open({ subject: { type: "agent", id: agentId }, args: { file } }),
      openAutomationRuns: (agentId) => rt.open({ screen: "runs.history", subject: { type: "agent", id: agentId } }),
      closePage: () => go.chat(""),
    },
    clock: rt.clock,
  };
}

export function helperData(rt: ShellRuntime, go: Go, threadId: string, nameOf: (id: string) => string): HelperChatData {
  return { screens: rt.screens, call: rt.call, connection: rt.connection, threadId, nameOf, nav: { openThread: (id) => go.thread(id) }, clock: rt.clock };
}

export function needsData(rt: ShellRuntime, go: Go, nameOf: (id: string) => string): NeedsYouData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, me: rt.me.id, space: { name: rt.space.name }, nameOf,
    sourceTitle: (kind, id) => titleFrom(rt, kind, id),
    nav: {
      openSource: (kind, id) => { if (kind === "chat" || kind === "thread" || kind === "channel") go.thread(id); else rt.open({ subject: { type: kind, id } }); },
      openFile: (fileId) => rt.open({ subject: { type: "file", id: fileId } }),
      openComputer: (agentId) => go.computerOfAgent(agentId),
    },
    clock: rt.clock,
  };
}

/** The counters under the screen while a recording runs. The stream carries no counters in this version, so the store counts what the person does: every click they send to the screen. */
export interface CaptureCounter { store: CaptureStore; click(): void; reset(): void }

export function createCapture(): CaptureCounter {
  let cap: Capture = NO_CAPTURE;
  const ls = new Set<() => void>();
  const set = (next: Capture): void => { cap = next; for (const l of [...ls]) l(); };
  return {
    store: { get: () => cap, subscribe: (l) => { ls.add(l); return () => void ls.delete(l); } },
    click: () => set({ ...cap, clicks: cap.clicks + 1 }),
    reset: () => set(NO_CAPTURE),
  };
}

/** A `call` that counts the clicks sent to the agent's screen, so the recording's counter moves as the person works. */
export function countingCall(call: ShellRuntime["call"], counter: CaptureCounter): ShellRuntime["call"] {
  return (cap, input) => {
    if (cap === "computers.screen.click") counter.click();
    if (cap === "computers.record_start") counter.reset();
    return call(cap, input);
  };
}

export function popupData(rt: ShellRuntime, go: Go, o: { computerId: string; agent: { agentId: string; name: string }; counter: CaptureCounter; renderChat?: ComputerPopupData["renderChat"] }): ComputerPopupData {
  return {
    screens: rt.screens, call: countingCall(rt.call, o.counter), connection: rt.connection, computerId: o.computerId, agent: o.agent, capture: o.counter.store,
    ...(o.renderChat ? { renderChat: o.renderChat } : {}), nav: { close: () => go.closeLayer() }, clock: rt.clock,
  };
}

export function terminalData(rt: ShellRuntime, go: Go, o: { agent?: { agentId: string; name: string; computerId?: string }; owner?: string; newKey: () => string }): TerminalData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, space: { id: rt.space.id, name: rt.space.name }, ...(o.owner ? { owner: o.owner } : {}), ...(o.agent ? { agent: o.agent } : {}),
    newKey: o.newKey, clock: rt.clock,
    nav: { openTerminal: (id) => go.terminal(id), closeTab: () => go.closeTerminal(), openList: () => go.terminals(), openRules: () => go.rules(), openAgent: (id) => go.agent(id) },
  };
}

/* ---------- the doors: what each click does ---------- */

/** The chat to open for an agent: the newest open chat it leads, else a new one (chat.start). Null when neither could be had. */
export async function chatWith(rt: Pick<ShellRuntime, "call">, agentId: string): Promise<string | null> {
  try {
    const out = (await rt.call("threads.list", { kind: ["chat"], limit: 50 })) as CapMap["threads.list"]["out"];
    const mine = out.threads
      .filter((t) => t.closedAt === undefined && t.agents.some((a) => a.agentId === agentId && a.mode === "lead"))
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))[0];
    if (mine) return mine.threadId;
  } catch {
    // no list to read from: a new chat is started below
  }
  try {
    const out = await rt.call("chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: newKey() });
    return (out as { thread?: { threadId?: string } } | null)?.thread?.threadId ?? null;
  } catch {
    return null;
  }
}

/** The place's doors over `act`. A thread that is a helper opens as the helper chat; a computer is found from its agent; a terminal on a computer is the open one or a new one. */
export function createGo(rt: ShellRuntime, act: (a: Act) => void, nameOf: (id: string) => string, say: (text: string) => void): Go {
  return {
    chat: (threadId) => act({ t: "chat", threadId }),
    thread: (threadId) => {
      if (threadId.startsWith(LOCAL_PREFIX)) return;
      void rt.call("threads.get", { threadId }).then(
        (out) => act({ t: (out as ThreadOut).thread.kind === "helper" ? "helper" : "chat", threadId }),
        () => act({ t: "chat", threadId }),
      );
    },
    agent: (agentId, tab) => act({ t: "agent", agentId, ...(tab ? { tab } : {}) }),
    needs: (taskId) => act({ t: "needs", ...(taskId ? { taskId } : {}) }),
    agentChat: (agentId) => {
      void chatWith(rt, agentId).then((id) => { if (id) act({ t: "chat", threadId: id }); else say("Could not start the chat. Try again."); });
    },
    computer: (computerId, chat = false) => act({ t: "layer", layer: { kind: "computer", computerId, chat } }),
    computerOfAgent: (agentId) => {
      void rt.call("computers.list", {}).then(
        (out) => {
          const c = (out as ComputersOut).computers.find((x) => x.agentId === agentId);
          if (c) act({ t: "layer", layer: { kind: "computer", computerId: c.computerId, chat: false } });
          else say(`${nameOf(agentId)} has no computer yet.`);
        },
        () => say("Could not reach the computer. Try again."),
      );
    },
    terminal: (terminalId) => act({ t: "terminal", terminalId }),
    terminalOfComputer: (computerId) => {
      void rt.call("terminal.list", { host: "agent_computer", state: ["running", "idle"] }).then(
        (out) => {
          const have = (out as CapMap["terminal.list"]["out"]).terminals.find((t) => t.computerId === computerId);
          if (have) { act({ t: "terminal", terminalId: have.terminalId }); return undefined; }
          return openSession({ call: rt.call, newKey }, "agent", { computerId }).then((t) => act({ t: "terminal", terminalId: t.terminalId }));
        },
      ).catch(() => say("Could not open a terminal on that computer."));
    },
    terminals: () => act({ t: "layer", layer: { kind: "terminals", ...anchorOfFocus() } }),
    rules: () => act({ t: "layer", layer: { kind: "rules" } }),
    connect: (channelId) => act({ t: "layer", layer: { kind: "connect", channelId } }),
    recording: (recordingId) => act({ t: "layer", layer: { kind: "recording", recordingId } }),
    allAgents: () => act({ t: "layer", layer: { kind: "all-agents", ...anchorOfFocus() } }),
    closeLayer: () => act({ t: "layer-close" }),
    closeTerminal: () => act({ t: "terminal-close" }),
    togglePane: () => act({ t: "pane" }),
    say,
  };
}

/** What the sidebar and the chat ask the place for. */
export const chatsActions = (go: Go): ChatsActions => ({ openThread: go.chat, togglePane: go.togglePane, openAgentChat: go.agentChat, fillComposer: () => undefined });

/** The sidebar: its rows open in this place; Needs you and All agents are this place's own pages. */
export function wireSidebar(rt: ShellRuntime, go: Go): ChatsSidebarData {
  const base = sidebarData(rt, chatsActions(go));
  return { ...base, nav: { ...base.nav, openNeedsYou: (taskId?: string) => go.needs(taskId), openAllAgents: () => go.allAgents() } };
}

/** The open chat: a face's page, a helper, the Computer chip, a channel's Connect sheet and the Waiting on line are all this place's doors. */
export function wireConversation(rt: ShellRuntime, go: Go, o: { threadId: string; list: readonly Principal[]; nameOf: (id: string) => string; leadId: string }): ConversationData {
  const base = conversationData(rt, chatsActions(go), o.threadId, o.list);
  return {
    ...base,
    nav: {
      ...base.nav, openAgent: (id: string) => go.agent(id), openThread: (id: string) => go.thread(id), togglePane: () => go.togglePane(),
      openBeside: (kind: string, id: string) => (kind === "computer" ? go.computerOfAgent(id) : base.nav.openBeside(kind, id)),
      openConnectOutsideAgent: (channelId: string) => go.connect(channelId),
    },
    toast: (text: string) => go.say(text),
    waitingLine: createElement(WaitingLine, { screens: rt.screens, call: rt.call, threadId: o.threadId, agent: o.nameOf(o.leadId) }),
  };
}

/** The agent's pane: its Computer tab pops the computer out and opens a terminal on it, its Threads tab opens a helper as the helper chat. */
export function wirePane(rt: ShellRuntime, go: Go, threadId: string, agent: PaneAgent): ChatRightPaneData {
  const base = paneData(rt, chatsActions(go), threadId, agent);
  return {
    ...base,
    agent,
    nav: {
      ...base.nav, openThread: (id: string) => go.thread(id), openHelper: (id: string) => go.thread(id), openComputer: (id: string) => go.computer(id),
      openTerminal: (id: string) => go.terminalOfComputer(id), openAgentPage: (id: string) => go.agent(id),
    },
  };
}
