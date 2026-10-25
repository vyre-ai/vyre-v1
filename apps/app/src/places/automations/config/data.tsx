// What the config pane and the Journey designer need beyond the Automations data: who can be picked (people, groups, roles, agents, channels), and where a link goes. The shell supplies it;
// without it the pick menus are empty and the links do nothing.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export interface DirEntry { id: string; name: string }
export interface ConfigDirectory {
  people: readonly DirEntry[];
  groups: readonly DirEntry[];
  roles: readonly DirEntry[];
  agents: readonly DirEntry[];
  channels: readonly DirEntry[];
  /** Automations that can run when a record enters a Journey stage. */
  automations: readonly DirEntry[];
}
export interface ConfigExtras {
  directory: ConfigDirectory;
  /** Opens the Automation's folder in Files. */
  openFiles?(path: string): void;
  /** Opens the Automation's run history in the main view. */
  openRuns?(automationId: string): void;
  /** Opens a record type in Records (a Journey's records). */
  openRecords?(recordType: string, stage?: string): void;
  /** Opens the Automation behind a stage or an alert. */
  openAutomation?(id: string): void;
}

export const EMPTY_DIRECTORY: ConfigDirectory = { people: [], groups: [], roles: [], agents: [], channels: [], automations: [] };
const Ctx = createContext<ConfigExtras>({ directory: EMPTY_DIRECTORY });

export function ConfigExtrasProvider({ value, children }: { value: ConfigExtras; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useConfigExtras(): ConfigExtras {
  return useContext(Ctx);
}
