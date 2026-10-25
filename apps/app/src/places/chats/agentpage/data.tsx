// What the agent page reads: one context. The agent, its summary, routines, suggestions, config and chats are live queries over the local copy (client hooks from the generated
// screen index, screen chats.agent-page), so the page paints from what the device keeps and updates as the agent works. Writes go through `call`, one capability per action.
// The shell supplies who is looking and whether they may change the agent, and how a click opens (a chat, the folder, the runs, a file).
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { ChatRightPaneData, Connection, PaneAgent, RightPaneNav } from "../rightpane/data.tsx";
import type { Clock } from "./model.ts";

export type { Connection };

/** Where a click goes. The shell decides how a thing opens; the page only says what. The first ten are the same ones the Chats right pane's tabs use. */
export interface AgentPageNav extends RightPaneNav {
  /** A chat from the Chats tab, or the one a Chat press just started. */
  openChat(threadId: string): void;
  /** The agent's folder in Files (Agents/<name>). */
  openFolder(folderId: string): void;
  /** AGENT.md or agent.toml in the agent's folder, as a tab. */
  openAgentFile(agentId: string, file: "AGENT.md" | "agent.toml"): void;
  /** "Automation runs": every run of this agent's routines, as a place of its own. */
  openAutomationRuns(agentId: string): void;
  /** After the agent moved to Trash: leave the page. */
  closePage(): void;
}

export interface AgentPageData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  agent: PaneAgent;
  /** The signed-in person. Routines show only the ones they set. */
  me: { id: string; name: string };
  nameOf(id: string): string;
  /** Whether this person may change the agent (agents.manage or an editor of it). Without it the role line is read-only with a lock. */
  canEdit: boolean;
  space: { name: string; personal: boolean };
  nav: AgentPageNav;
  clock(): Clock;
}

const Ctx = createContext<AgentPageData | null>(null);

export function AgentPageDataProvider({ value, children }: { value: AgentPageData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalAgentPageData(): AgentPageData | null {
  return useContext(Ctx);
}

export function useAgentPageData(): AgentPageData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The agent page needs an AgentPageDataProvider above it");
  return v;
}

/** The same data the Chats right pane tabs (Memory, Files, Computer) read, so the page shows them without a second copy of their code. */
export function paneDataOf(d: AgentPageData): ChatRightPaneData {
  return { screens: d.screens, call: d.call, connection: d.connection, threadId: "", agent: d.agent, space: d.space, nav: d.nav, clock: d.clock };
}

export const AGENT_PAGE_SCREEN = "chats.agent-page";

/** A live screen query: `screens.query(screenId, name, state)`. Re-subscribes only when the screen, query or state changes. */
export function useScreenQuery<T>(name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useAgentPageData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(AGENT_PAGE_SCREEN, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useAgentPageData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}
