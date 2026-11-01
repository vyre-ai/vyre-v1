// What the conversation reads: one context. The thread, its messages and its helpers are live queries over the kept copy, so the page paints from what the device keeps and
// updates as the agents work. Writes go through `call`, one capability per action. A message that is still being written has a stream store (deltas in, one append per frame).
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { ComposerLists } from "../../../../../../ui/src/Composer/index.tsx";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { ChatMemoryData } from "../memory/data.tsx";
import type { LiveTurn } from "../../../shell/session/turn-streams.ts";
import type { Candidate, Clock } from "./model.ts";

/** Where a click goes. The shell supplies these (tabs, the pane, the agent page); the conversation never decides how a thing opens. */
export interface ConversationNav {
  /** An agent's name in the header or on a message: its page. */
  openAgent(agentId: string): void;
  /** A helper from the Helpers list, or a thread from "Open thread". With a message id the chat opens on that message and marks it. */
  openThread(threadId: string, messageId?: string): void;
  /** Search every chat (the page of results). Left out where the shell has no such page. */
  openSearch?(query: string): void;
  /** Shows or hides the pane on the right (Computer, Threads, Files, Memory, Routines). */
  togglePane(): void;
  /** A card's file, record or diff opens beside the chat. A "computer" card or the Computer chip passes the agent's id. */
  openBeside(kind: string, id: string): void;
  /** The channel menu's "Connect an outside agent": the sheet for this channel (P-L9b_23). Left out where the shell has no such sheet. */
  openConnectOutsideAgent?(channelId: string): void;
  /** "Connect your AI" on a reply that could not start: the sign-in and key page. Left out where the shell has none. */
  openAiSetup?(): void;
  /** "Unlock" on a reply that stopped because the Vault is locked: asks for the password in place. True once the key is open. Left out where the shell has no Vault key to open. */
  unlockVault?(): Promise<boolean>;
}

/** A slash command a plugin adds. It runs `run` when it has one, else its `prompt` is sent as the message ($ARGUMENTS is replaced by what follows the name). */
export interface PluginCommand { name: string; description: string; pluginId?: string; prompt?: string; run?(arg: string): Promise<string | void>;
  /** Fills the command's prompt with what was typed after its name; the result is sent as the person's message. */
  render?(arg: string): Promise<string> }

/** The live replies of a chat: a row for each reply that is being written or just finished and not yet saved. */
export interface LiveTurns {
  turnsOf(threadId: string): readonly LiveTurn[];
  subscribe(l: () => void): () => void;
  /** The saved message is on screen: its stream can go. */
  settle(messageId: string): void;
  /** Take the turns the host says are being written now (engine.live_turns), and hear when a piece arrives for a turn this device never saw begin. */
  seed(threadId: string, turns: readonly { turnId: string; agentId: string; text: string }[]): void;
  onGap(l: (threadId: string) => void): () => void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface ConversationData {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  threadId: string;
  
  /** A message to open on and mark (from a memory quote's link `vyre://thread/<id>?m=<messageId>`, a search result or a fork's link back): the page loads the messages around it. */
  focus?: string;
  /** The signed-in person: messages from them are the right-hand bubbles. */
  me: { id: string; name: string };
  nameOf(id: string): string;
  kindOf(id: string): "person" | "agent";
  nav: ConversationNav;
  clock(): Clock;
  /** The @ # / tables of the composer. */
  lists: ComposerLists;
  /** Everyone and every agent an @ can name, with ids: what a mention in the text becomes in chat.post. */
  directory: readonly Candidate[];
  /** A fresh idempotency key for one send; the same key is reused if the send is retried. */
  newKey(): string;
  /** The stream of a message that is still being written; none once it is complete. A row id `turn:<id>` is a reply that has no saved message yet. */
  streamOf(messageId: string): StreamStore | undefined;
  /** Put bytes at a one-time upload address (files.upload_url). Left out where the shell cannot: a large file is then refused with a clear line. */
  putBlob?(url: string, bytes: Uint8Array): Promise<void>;
  /** Hand the person a file: a download in the browser, a save sheet on a phone. Left out: the text is copied instead. */
  saveFile?(name: string, mime: string, content: string): void;
  /** The name of the Space this chat lives in. */
  spaceName?: string;
  /** A Personal Space has no agent computers: the composer draws no computer button. */
  personal?: boolean;
  /** The other Spaces this person is in on this device, and a way to act in them. Left out when there is only this one. */
  elsewhere?: { spaces: readonly { id: string; name: string }[]; call(spaceId: string, cap: string, input: unknown): Promise<unknown> };
  /** Slash commands that plugins add (name, one line, and what to run). Left out when no plugin offers any. */
  pluginCommands?(): readonly PluginCommand[];
  /** Replies being written in this chat, from the live socket. Left out where there is no live link: the reply then lands whole. */
  live?: LiveTurns;
  /** Copy to the clipboard (Copy in the hover bar, Copy trace id). */
  copy(text: string): void;
  /** A line the app shows for a moment ("Copied"). */
  toast(text: string): void;
  /** Text another part of the place asks the composer to hold (Ask about this file, Change by Asking). Absent: the composer is only written in by its own person. */
  fill?: ComposerFill;
  /** A line above the composer for work that waits in the background ("Waiting on: build 42"); the shell draws it from the thread's runs (P-L9b_23). */
  waitingLine?: ReactElement;
  /** The shell has a terminal: a Run this card can type a command into one. */
  terminal?: boolean;
  /** The mount sheet for a Mount card in the chat: connect a folder from the source the card named, then hand back what was mounted. The shell draws it over the page. Left out where the shell has no Files. */
  mountSheet?(p: { source: string; onMounted(info: { folderId: string; name: string }): void; onClose(): void }): ReactElement;
  /** What the chat's memory surfaces read and write (Used N memories, quote cards, Learned lines, underlined subjects, the message menu's memory items). Left out where the shell has none: every surface then draws nothing. */
  memory?: ChatMemoryData;
}

/**
 * What a pane or a page asks the composer to hold. One value waits until a conversation takes it, so asking from a page that has no conversation open (the agent's page) still lands in the chat
 * that opens next; a conversation that is open takes it at once and puts it after what the person had typed.
 */
export interface ComposerFill {
  set(text: string): void;
  /** The waiting text, once; undefined when nothing waits. */
  take(): string | undefined;
  subscribe(onChange: () => void): () => void;
}

export function createComposerFill(): ComposerFill {
  let waiting: string | undefined;
  const listeners = new Set<() => void>();
  return {
    set(text) { waiting = text; for (const l of [...listeners]) l(); },
    take() { const t = waiting; waiting = undefined; return t; },
    subscribe(onChange) { listeners.add(onChange); return () => { listeners.delete(onChange); }; },
  };
}

const Ctx = createContext<ConversationData | null>(null);

export function ConversationDataProvider({ value, children }: { value: ConversationData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalConversationData(): ConversationData | null {
  return useContext(Ctx);
}

export function useConversationData(): ConversationData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The conversation needs a ConversationDataProvider above it");
  return v;
}

export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useConversationData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useConversationData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
