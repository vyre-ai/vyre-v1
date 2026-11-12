// Chats sidebar data: the one context the sidebar reads. Lists are live queries over the local copy (client hooks from the generated screen index), so the sidebar
// paints from what the device keeps and updates when the copy changes. Writes go through `call`, one capability per action.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";

/** Where a click goes. The shell supplies these (tabs, the conversation, the right pane); the sidebar never decides how a thing opens. */
export interface ChatsNav {
  openChat(threadId: string): void;
  /** "A click returns to the last chat" with this agent; starts one when there is none. */
  openAgentChat(agentId: string): void;
  openChannel(channelId: string): void;
  openNeedsYou(taskId?: string): void;
  /** An imported coding session's transcript (its row in the Imported group). Left out where the shell has no such page. */
  openImported?(conversationId: string): void;
  openAllAgents(): void;
  /** One agent's page. Left out where the shell has none (the menu then has no Open Profile). */
  openAgent?(agentId: string, section?: "instructions" | "computer"): void;
  /** A chat in a tab of its own. Left out where the shell has none (the menu then has no Open in New Tab). */
  openChatTab?(threadId: string): void;
  /** Everything made to show: artifacts, opened in the app. Left out where the shell has no such page. */
  openArtifacts?(): void;
  openSearch(): void;
  openSpaceSwitcher(): void;
  /** Opens the New channel sheet. */
  openNewChannel(): void;
  /** One goal's page, from its row in the Goals group. */
  openGoal?(goalId: string): void;
  openProject?(projectId: string): void;
  /** The group's +: the same new-project path Home uses (Records, Projects, create). */
  openNewProject?(): void;
  /** The two rows at the top of the list: everything you owe, and the threads you are in. */
  openTasks?(): void;
  /** Notes: the grid of your notes; the same in a tab behind this one; the grid with Take a note open. Left out where the shell has no Notes page. */
  openNotes?(): void;
  openNotesTab?(): void;
  /** Call a teammate from the Space's softphone, at the phone they set for teammates. Left out where the Space has no telephony. */
  callPerson?(personId: string, name: string): void;
  takeNote?(): void;
  /** The first screen: a new chat. */
  openNew?(): void;
  /** The one agent page, empty. */
  openNewAgent?(): void;
  /** Hides the sidebar (the panel button in its header). Left out where the shell keeps the sidebar always. */
  toggleSidebar?(): void;
  /** Open anything by what it is (a run, a record, a task): the place it lives in decides how. Left out where the shell has no such door. */
  openSubject?(subject: { type: string; id: string }): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface ChatsSidebarData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** Something changed in the Space (the same tick that re-reads the live queries). Left out where nothing announces changes. */
  changes?: { subscribe(listener: () => void): () => void } | undefined;
  connection: Connection;
  /** The Space's name and whether another Space needs you (the red dot). */
  space: { name: string; otherNeedsYou: boolean; /** A Personal Space: no channels */ personal?: boolean; /** your assistant: the new-chat icon starts a chat with it */ assistant: { agentId: string; name: string } };
  nav: ChatsNav;
  /** The Space's people, for the People section. */
  people?: readonly { id: string; name: string }[];
  /** You: left out of the people a channel can add (you are always in), and the test for "a channel you are not in". */
  me?: { id: string };
  /** The Space changed: what a group that reads by capability (Goals) follows. */
  changes?: { subscribe(listener: () => void): () => void };
  clock(): { now: number; offsetMin: number };
}

const Ctx = createContext<ChatsSidebarData | null>(null);

export function ChatsSidebarDataProvider({ value, children }: { value: ChatsSidebarData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalSidebarData(): ChatsSidebarData | null {
  return useContext(Ctx);
}

export function useSidebarData(): ChatsSidebarData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Chats sidebar needs a ChatsSidebarDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useSidebarData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useSidebarData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
