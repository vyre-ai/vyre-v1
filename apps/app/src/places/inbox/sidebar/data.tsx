// Inbox data: the one context the sidebar and the list read. Every list is a live query over the local copy (client hooks from the generated screen index), so a section
// paints from what is kept on the device and updates when the copy changes. Writes go through `call`, one capability per action. The shell supplies navigation.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

/** Where a click goes. The shell supplies these (tabs, the Calendar view, the dialer); the Inbox never decides how a thing opens. */
export interface InboxNav {
  /** Double click or Enter on a row: the contact's tab with the whole history. */
  openConversation(conversationId: string): void;
  openThread(threadId: string): void;
  openCall(callId: string): void;
  openCalendar(): void;
  openDialer(): void;
  /** The "Match to a record" link on a row that needs a match. */
  openMatch(conversationId: string): void;
  /** The pencil at the top of the sidebar: a new message. */
  compose(): void;
  /** The plus at the top: connect a mailbox or claim a number. */
  connect(kind: "gmail" | "outlook" | "imap" | "number"): void;
  /** "Mailbox Settings" or "Number Settings" from an inbox row's menu. */
  openInboxSettings(inboxId: string): void;
}

/** What a line shows beyond the list capability's row: the person's organisation, do-not-disturb, a bounced email, an agent's draft. Read from the replica's record, deliverability and draft tables. */
export interface RowExtras {
  org?: string;
  /** The organisation is a guess the person has not confirmed (drawn in the warning colour). */
  orgUnsure?: boolean;
  /** Why the person is on do-not-disturb (the DND tag's tip). */
  dnd?: string;
  /** The address an email bounced from. */
  bounced?: string;
  /** An agent has a draft reply waiting. */
  draftReady?: boolean;
}

/** How a number is named and grouped in the sidebar (an agent's number sits under Agents and is named for the agent). */
export interface NumberInfo { label: string; group: "mine" | "agent" }

export interface InboxData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  clock(): { now: number; offsetMin: number };
  nav: InboxNav;
  /** Extras for one line (the line's key). Absent: the line shows only what the list capability returns. */
  extras?(key: string): RowExtras | undefined;
  /** Naming and grouping for the Space's numbers. */
  numbers?(): ReadonlyMap<string, NumberInfo>;
}

const DataCtx = createContext<InboxData | null>(null);

export function InboxDataProvider({ value, children }: { value: InboxData; children: ReactNode }): ReactElement {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

/** The data the shell provided, or null before it has (the Inbox then draws its loading frame). */
export function useOptionalInboxData(): InboxData | null {
  return useContext(DataCtx);
}

export function useInboxData(): InboxData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("The Inbox needs an InboxDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useInboxData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useInboxData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
