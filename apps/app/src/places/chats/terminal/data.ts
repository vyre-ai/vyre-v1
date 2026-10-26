// What the terminal screens read: the Space's screen hooks and `call`, who is looking, which agent a new agent-computer session belongs to, and where a click goes. The sessions and
// the rules are live queries of the registry screens chats.terminal-tab, chats.terminal-list and chats.terminal-rules; every write is one capability through `call`.
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import type { Connection } from "../mounts/live.ts";

export const TAB_SCREEN = "chats.terminal-tab";
export const LIST_SCREEN = "chats.terminal-list";
export const RULES_SCREEN = "chats.terminal-rules";
/** The Starred section of Home reads the same stars; a terminal is starred when its id is in the list. */
export const STARS_SCREEN = "home.today-starred-ask";

export interface TerminalNav {
  /** Show this session as the terminal tab (a new one just opened, one from the list, a starred one from Home). */
  openTerminal(terminalId: string): void;
  /** Close the terminal tab; the session keeps running on its host. */
  closeTab(): void;
  /** The list of sessions. */
  openList(): void;
  /** The allow, ask and deny lists. */
  openRules(): void;
  /** The agent whose computer a session runs on: its page. */
  openAgent(agentId: string): void;
}

export interface TerminalData {
  screens: ScreenHooks;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  space: { id: string; name: string };
  /** Who a locked server shell asks for access ("Ask Maya Chen for access"), when the copy knows. */
  owner?: string;
  /** The agent of the open chat: a new agent-computer session opens on its computer. */
  agent?: { agentId: string; name: string; computerId?: string };
  newKey(): string;
  clock(): { now: number; offsetMin: number };
  nav: TerminalNav;
}
