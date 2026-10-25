// The data contexts the Chats place hands its three parts, built from the Space's runtime. Each part reads the same ScreenHooks and `call`; what differs is the nav: a click
// says what to open and this place decides (the open chat is local state of the place, the pane is a toggle). Nothing here touches the network.
import type { ComposerLists, ListItem } from "../../../../../ui/src/Composer/index.tsx";
import type { ChatsNav, ChatsSidebarData } from "../../places/chats/sidebar/data.tsx";
import type { ConversationData, ConversationNav } from "../../places/chats/conversation/data.tsx";
import type { Candidate } from "../../places/chats/conversation/model.ts";
import type { ChatRightPaneData, RightPaneNav } from "../../places/chats/rightpane/data.tsx";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export interface ChatsActions {
  /** Open a chat or channel's thread in the main column. */
  openThread(threadId: string): void;
  togglePane(): void;
  /** Start (or return to) a chat with an agent. */
  openAgentChat(agentId: string): void;
  fillComposer(text: string): void;
}

const kindOf = (p: Principal | undefined): "person" | "agent" => (p && p.kind === "agent" ? "agent" : "person");

export function candidates(list: readonly Principal[], meId: string): Candidate[] {
  const out: Candidate[] = [];
  for (const p of list) if (p.id !== meId && (p.kind === "person" || p.kind === "agent")) out.push({ id: p.id, name: p.name, kind: p.kind });
  return out;
}

export function composerLists(list: readonly Principal[], meId: string): ComposerLists {
  const people: ListItem[] = [];
  const agents: ListItem[] = [];
  for (const p of list) {
    if (p.id === meId) continue;
    if (p.kind === "person") people.push(p.name);
    else if (p.kind === "agent") agents.push(p.name);
  }
  return { people, agents, commands: ["later", "memory", "fork"] };
}

let keySeq = 0;
const newKey = (): string => `k_${Date.now().toString(36)}_${(keySeq++).toString(36)}`;

const copy = (text: string): void => {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (clip) void clip.writeText(text);
};

export function sidebarData(rt: ShellRuntime, a: ChatsActions): ChatsSidebarData {
  const nav: ChatsNav = {
    openChat: a.openThread,
    openAgentChat: a.openAgentChat,
    openChannel: a.openThread,
    openNeedsYou: (taskId) => rt.open({ screen: "tasks.needs-you", ...(taskId ? { args: { taskId } } : {}) }),
    openAllAgents: () => rt.open({ screen: "chats.all-agents" }),
    openSearch: () => rt.open({ screen: "shell.cmdk" }),
    openSpaceSwitcher: () => rt.open({ screen: "spaces.switcher" }),
    openNewChannel: () => rt.open({ screen: "chats.sidebar" }),
  };
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection,
    space: { name: rt.space.name, otherNeedsYou: false, assistant: { agentId: rt.assistant.id, name: rt.assistant.name } },
    nav, clock: rt.clock,
  };
}

export function conversationData(rt: ShellRuntime, a: ChatsActions, threadId: string, principals: readonly Principal[]): ConversationData {
  const byId = new Map(principals.map((p) => [p.id, p] as const));
  const nav: ConversationNav = {
    openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    openThread: a.openThread,
    togglePane: a.togglePane,
    openBeside: (kind, id) => rt.open({ subject: { type: kind, id } }),
  };
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, threadId, me: { id: rt.me.id, name: rt.me.name },
    nameOf: (id) => byId.get(id)?.name ?? id,
    kindOf: (id) => kindOf(byId.get(id)),
    nav, clock: rt.clock,
    lists: composerLists(principals, rt.me.id),
    directory: candidates(principals, rt.me.id),
    newKey,
    streamOf: () => undefined,
    copy,
    toast: () => undefined,
  };
}

export function paneData(rt: ShellRuntime, a: ChatsActions, threadId: string, agent: { agentId: string; name: string }): ChatRightPaneData {
  const nav: RightPaneNav = {
    openThread: (id) => a.openThread(id),
    openHelper: (id) => a.openThread(id),
    openComputer: (computerId) => rt.open({ screen: "chats.agent-computer", args: { computerId } }),
    openTerminal: (computerId) => rt.open({ screen: "chats.terminal-tab", args: { computerId } }),
    openFile: (fileId) => rt.open({ subject: { type: "file", id: fileId } }),
    fillComposer: a.fillComposer,
    openSource: (kind, ref) => rt.open({ subject: { type: kind, id: ref } }),
    openAgentPage: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    openRoutineFile: (agentId, title) => rt.open({ screen: "chats.agent-page", args: { agentId, routine: title } }),
    skillFromStep: (computerId, stepId) => rt.open({ screen: "chats.agent-computer", args: { computerId, stepId } }),
  };
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, threadId,
    agent: { agentId: agent.agentId, name: agent.name },
    space: { name: rt.space.name, personal: rt.space.kind === "personal" },
    nav, clock: rt.clock,
  };
}
