// What the conversation reads: one context. The thread, its messages and its helpers are live queries over the kept copy, so the page paints from what the device keeps and
// updates as the agents work. Writes go through `call`, one capability per action. A message that is still being written has a stream store (deltas in, one append per frame).
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { ComposerLists } from "../../../../../../ui/src/Composer/index.tsx";
import type { StreamStore } from "../../../../../../ui/src/stream/index.ts";
import type { Candidate, Clock } from "./model.ts";

/** Where a click goes. The shell supplies these (tabs, the pane, the agent page); the conversation never decides how a thing opens. */
export interface ConversationNav {
  /** An agent's name in the header or on a message: its page. */
  openAgent(agentId: string): void;
  /** A helper from the Helpers list, or a thread from "Open thread". */
  openThread(threadId: string): void;
  /** Shows or hides the pane on the right (Computer, Threads, Files, Memory, Routines). */
  togglePane(): void;
  /** A card's file, record or diff opens beside the chat. A "computer" card or the Computer chip passes the agent's id. */
  openBeside(kind: string, id: string): void;
  /** The channel menu's "Connect an outside agent": the sheet for this channel (P-L9b_23). Left out where the shell has no such sheet. */
  openConnectOutsideAgent?(channelId: string): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface ConversationData {
  screens: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  threadId: string;
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
  /** The stream of a message that is still being written; none once it is complete. */
  streamOf(messageId: string): StreamStore | undefined;
  /** Copy to the clipboard (Copy in the hover bar, Copy trace id). */
  copy(text: string): void;
  /** A line the app shows for a moment ("Copied"). */
  toast(text: string): void;
  /** A line above the composer for work that waits in the background ("Waiting on: build 42"); the shell draws it from the thread's runs (P-L9b_23). */
  waitingLine?: ReactElement;
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
