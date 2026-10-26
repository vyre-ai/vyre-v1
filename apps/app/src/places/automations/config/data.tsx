// What the config pane and the Journey designer need beyond the Automations data: who can be picked (people, groups, roles, agents, channels), and where a link goes. The shell supplies it;
// without it the pick menus are empty and the links do nothing.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { TaskState } from "../journeys/model.ts";

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
export type FieldType = "person" | "rel" | "date" | "choice" | "num" | "text" | "check" | "file" | "formula";
export interface FieldEntry { name: string; type: FieldType }
/** The fields of a Journey's record type: those it inherits from the template it was made from, and those of its own. */
export interface RecordFields { template: string; inherited: readonly FieldEntry[]; own: readonly FieldEntry[] }
export interface ConfigExtras {
  directory: ConfigDirectory;
  /** The fields of a record type (a Journey's records), for the Fields tab. Without it the tab says there are none. */
  recordFields?(recordType: string): RecordFields;
  /** Opens the Automation's folder in Files. */
  openFiles?(path: string): void;
  /** Opens the Automation's run history in the main view. */
  openRuns?(automationId: string): void;
  /** Opens a record type in Records (a Journey's records). */
  openRecords?(recordType: string, stage?: string): void;
  /** Opens the Automation behind a stage or an alert. */
  openAutomation?(id: string): void;
  /** Where each task of a Journey stands (by task key). A task not listed is To do. Task progress lives on the records, so the shell supplies it. */
  taskStates?(journeyId: string): Readonly<Record<string, TaskState>>;
  /** Sets a task's state; the designer shows it at once and the shell keeps it. */
  setTaskState?(journeyId: string, taskKey: string, state: TaskState): void;
  /** The Automations that run when a record leaves each stage (by stage key). */
  leaving?(journeyId: string): Readonly<Record<string, readonly string[]>>;
  /** Saves the Automations that run when a record leaves a stage. */
  setLeaving?(journeyId: string, stageKey: string, automations: readonly string[]): void;
}

export const EMPTY_DIRECTORY: ConfigDirectory = { people: [], groups: [], roles: [], agents: [], channels: [], automations: [] };
const Ctx = createContext<ConfigExtras>({ directory: EMPTY_DIRECTORY });

export function ConfigExtrasProvider({ value, children }: { value: ConfigExtras; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useConfigExtras(): ConfigExtras {
  return useContext(Ctx);
}
