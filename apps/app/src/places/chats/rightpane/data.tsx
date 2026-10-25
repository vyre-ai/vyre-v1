// What the Chats right pane reads: one context. Lists are live queries over the local copy (client hooks from the generated screen index), so the pane paints from what the
// device keeps and updates when the copy changes. Writes go through `call`, one capability per action. The shell supplies the agent of the open chat and the navigation.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { Clock } from "./model.ts";

/** Where a click goes. The shell decides how a thing opens (in place, beside, full screen); the pane only says what. */
export interface RightPaneNav {
  /** A thread, helper or chat from the Threads tab: in place, or beside the chat as a side tab. */
  openThread(threadId: string, how: "here" | "side"): void;
  openHelper(threadId: string): void;
  /** The computer popup (P-L9b_08). */
  openComputer(computerId: string): void;
  openTerminal(computerId: string): void;
  openFile(fileId: string, how: "side" | "full"): void;
  /** Puts text in the open chat's composer and focuses it. */
  fillComposer(text: string): void;
  /** Where a fact came from: the chat, channel, task or record. */
  openSource(kind: string, ref: string, link?: string): void;
  openAgentPage(agentId: string): void;
  /** routines/<name>.md in the agent's folder, as a tab. */
  openRoutineFile(agentId: string, title: string): void;
  /** "Make a Skill from Here": drafts a skill from a step to the end. */
  skillFromStep(computerId: string, stepId: string): void;
}

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

/** The agent of the open chat. The pane follows it: change chats and the pane shows the other agent. */
export interface PaneAgent {
  agentId: string;
  name: string;
  /** Its computer, when it has one. Absent in a Personal Space and for an agent that never needed one. */
  computerId?: string;
}

export interface ChatRightPaneData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  /** The open chat or channel's thread, and the agent the pane follows. */
  threadId: string;
  agent: PaneAgent;
  /** The Space the chat is in. A Personal Space has no agent computers: the Computer tab says so. */
  space: { name: string; personal: boolean };
  nav: RightPaneNav;
  clock(): Clock;
}

const Ctx = createContext<ChatRightPaneData | null>(null);

export function RightPaneDataProvider({ value, children }: { value: ChatRightPaneData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalPaneData(): ChatRightPaneData | null {
  return useContext(Ctx);
}

export function usePaneData(): ChatRightPaneData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Chats right pane needs a RightPaneDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts): `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = usePaneData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = usePaneData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
