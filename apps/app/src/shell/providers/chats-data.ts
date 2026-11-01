// The data contexts the Chats place hands its three parts, built from the Space's runtime. Each part reads the same ScreenHooks and `call`; what differs is the nav: a click
// says what to open and this place decides (the open chat is local state of the place, the pane is a toggle). Nothing here touches the network.
import { askVaultUnlock } from "../session/vault-gate.ts";
import { computersAvailableNow } from "../computers-available.ts";
import type { ComposerLists, ListItem } from "../../../../../ui/src/Composer/index.tsx";
import type { ChatsNav, ChatsSidebarData } from "../../places/chats/sidebar/data.tsx";
import type { ComposerFill, ConversationData, ConversationNav, PluginCommand } from "../../places/chats/conversation/data.tsx";
import { othersNeedingYou } from "../spaces/model.ts";
import type { Candidate } from "../../places/chats/conversation/model.ts";
import type { ChatRightPaneData, RightPaneNav } from "../../places/chats/rightpane/data.tsx";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import { createMemoryStore } from "../../places/chats/memory/data.tsx";
import type { ChatMemoryData, MemoryStore } from "../../places/chats/memory/data.tsx";
import { KNOW_SCREEN, routeToArgs } from "../../places/files/memory/know.ts";
import { nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";
import { nameOr } from "../../places/chats/names.ts";
import { requestChannelSheet } from "../../places/chats/channels/request.ts";

export interface ChatsActions {
  /** Open a chat or channel's thread in the main column. */
  openThread(threadId: string): void;
  togglePane(): void;
  /** Opens the pane and leaves it open (the Knows tab asks for it). Absent where the place only toggles. */
  openPane?(): void;
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

/** A file the person keeps: a download in the browser. Other platforms leave `saveFile` out and the text is copied. */
export function saveFile(name: string, mime: string, content: string): void {
  const g = globalThis as { document?: { createElement(t: string): { href: string; download: string; click(): void; remove(): void }; body?: { appendChild(n: unknown): unknown } }; URL?: { createObjectURL(b: unknown): string; revokeObjectURL(u: string): void }; Blob?: new (p: string[], o: { type: string }) => unknown };
  if (!g.document || !g.URL || !g.Blob) return;
  const url = g.URL.createObjectURL(new g.Blob([content], { type: mime }));
  const a = g.document.createElement("a");
  a.href = url; a.download = name;
  g.document.body?.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => g.URL!.revokeObjectURL(url), 10_000);
}

const canSave = (): boolean => typeof (globalThis as { document?: unknown }).document !== "undefined" && typeof (globalThis as { Blob?: unknown }).Blob !== "undefined";

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
    openNewChannel: () => requestChannelSheet("new"),
  };
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection,
    space: { name: rt.space.name, otherNeedsYou: othersNeedingYou(rt.knownSpaces ?? [], rt.space.id).length > 0, ...(rt.space.kind === "personal" ? { personal: true } : {}), assistant: { agentId: rt.assistant.id, name: rt.assistant.name } },
    nav, me: { id: rt.me.id }, clock: rt.clock,
  };
}

const stores = new WeakMap<ShellRuntime, MemoryStore>();

/** One memory store per Space runtime: the conversation and the right pane share it, so a Forget in one shows in the other. */
export function memoryStore(rt: ShellRuntime): MemoryStore {
  let s = stores.get(rt);
  if (!s) { s = createMemoryStore(rt.call); stores.set(rt, s); }
  return s;
}

/** The memory surfaces of a chat: reads and writes are capabilities as the person; a click on a source, a page or the graph opens Files Knowledge or the chat at that line. */
export function chatMemory(rt: ShellRuntime, a: ChatsActions): ChatMemoryData {
  const know = (route: Parameters<typeof routeToArgs>[0]): void => rt.open({ screen: KNOW_SCREEN, args: routeToArgs(route) });
  return {
    store: memoryStore(rt),
    now: () => rt.clock().now,
    me: { id: rt.me.id, name: rt.me.name },
    nameOf: nameLookup(rt),
    nav: {
      openLink: (link) => rt.openUrl(link),
      openPage: (pageId) => know({ v: "page", pageId }),
      openGraph: (pageId) => know({ v: "graph", focus: pageId }),
      openKnowledge: () => know({ v: "learned" }),
      openSource: (kind, ref, link) => { if (link) rt.openUrl(link); else rt.open({ subject: { type: kind, id: ref } }); },
    },
    ...(a.openPane ? { showKnows: a.openPane } : {}),
  };
}

/** Plugin slash commands of this Space (chat-ecosystem's plugins.commands.list), read once per runtime and kept a minute; a Space without the capability simply has none. */
const pluginCache = new WeakMap<object, { at: number; list: PluginCommand[]; loading: boolean }>();
function pluginCommandsOf(rt: ShellRuntime): PluginCommand[] {
  let c = pluginCache.get(rt);
  if (!c) { c = { at: 0, list: [], loading: false }; pluginCache.set(rt, c); }
  const entry = c;
  if (!entry.loading && Date.now() - entry.at > 60_000) {
    entry.loading = true;
    void Promise.resolve(rt.call("plugins.commands.list", {})).then(
      (out) => {
        const cmds = (out as { commands?: Array<{ name: string; description?: string; pluginId?: string }> }).commands ?? [];
        entry.list = cmds.map((x) => ({
          name: x.name, description: x.description ?? "", ...(x.pluginId ? { pluginId: x.pluginId } : {}),
          render: async (arg: string) => ((await rt.call("plugins.command.render", { name: x.name, ...(arg ? { args: arg } : {}) })) as { prompt: string }).prompt,
        }));
      },
      () => undefined,
    ).finally(() => { entry.at = Date.now(); entry.loading = false; });
  }
  return entry.list;
}

export function conversationData(rt: ShellRuntime, a: ChatsActions, threadId: string, principals: readonly Principal[], fill?: ComposerFill): ConversationData {
  const byId = new Map(principals.map((p) => [p.id, p] as const));
  const nav: ConversationNav = {
    openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    openThread: a.openThread,
    togglePane: a.togglePane,
    openBeside: (kind, id) => rt.open({ subject: { type: kind, id } }),
    openAiSetup: () => rt.open({ screen: "vault.layout", args: { addProvider: "true" } }),   // the same page the Needs you sign-in opens
    ...(rt.unlockVault ? { unlockVault: () => askVaultUnlock(rt.unlockVault!) } : {}),
  };
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, threadId, me: { id: rt.me.id, name: rt.me.name },
    nameOf: (id) => nameOr(byId.get(id)?.name, id),
    kindOf: (id) => kindOf(byId.get(id)),
    nav, clock: rt.clock, spaceName: rt.space.name, ...(rt.baseUrl ? { spaceUrl: rt.baseUrl } : {}), ...(rt.space.kind === "personal" ? { personal: true } : {}),
    ...(fill ? { fill } : {}),
    memory: chatMemory(rt, a),
    lists: composerLists(principals, rt.me.id),
    directory: candidates(principals, rt.me.id),
    newKey,
    streamOf: (id) => rt.turns?.streamOf(id),
    ...(rt.turns ? { live: { turnsOf: (t: string) => rt.turns!.turnsOf(t), subscribe: (l: () => void) => rt.turns!.subscribe(l), settle: (id: string) => rt.turns!.settle(id), seed: (t: string, l: readonly { turnId: string; agentId: string; text: string }[]) => rt.turns!.seed(t, l), onGap: (l: (t: string) => void) => rt.turns!.onGap(l) } } : {}),
    copy,
    toast: () => undefined,
    ...(rt.callIn && rt.knownSpaces && rt.knownSpaces.some((x) => x.spaceId !== rt.space.id)
      ? { elsewhere: { spaces: rt.knownSpaces.filter((x) => x.spaceId !== rt.space.id).map((x) => ({ id: x.spaceId, name: x.name })), call: (id: string, cap: string, input: unknown) => rt.callIn!(id, cap, input) } }
      : {}),
    ...(rt.putBlob ? { putBlob: (url: string, bytes: Uint8Array) => rt.putBlob!(url, bytes) } : {}),
    ...(canSave() ? { saveFile } : {}),
    pluginCommands: () => (rt.pluginCommands ? rt.pluginCommands() : pluginCommandsOf(rt)),
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
    space: { name: rt.space.name, personal: rt.space.kind === "personal", computers: computersAvailableNow(rt.space) },
    nav, clock: rt.clock,
    memory: chatMemory(rt, a),
    ...(rt.baseUrl ? { spaceUrl: rt.baseUrl } : {}),
  };
}
