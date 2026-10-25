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
  openAllAgents(): void;
  openSearch(): void;
  openSpaceSwitcher(): void;
  openNewChannel(): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

export interface ChatsSidebarData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** The Space's name and whether another Space needs you (the red dot). */
  space: { name: string; otherNeedsYou: boolean; /** your assistant: the new-chat icon starts a chat with it */ assistant: { agentId: string; name: string } };
  nav: ChatsNav;
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
