// What the project page needs from the shell: the capability door, who people are, the clock, and where a click goes outside the page. The shell fills it in (the project comes from the tab
// hash, `subject=project:<id>`); the screenshot mount and the tests pass their own.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";

export type ImportedSessionArchive = CapMap["sessions.list"]["out"]["sessions"][number];
export type ImportedSessionTranscript = CapMap["sessions.get"]["out"];

export interface ProjectImports {
  list(projectId: string): Promise<ImportedSessionArchive[]>;
  read(conversationId: string): Promise<ImportedSessionTranscript>;
  continue(conversationId: string): Promise<string>;
}

export async function listProjectImports(call: ProjectPageData["call"], projectId: string): Promise<ImportedSessionArchive[]> {
  const found: ImportedSessionArchive[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const input = { limit: 100, ...(cursor ? { cursor } : {}) };
    const out = await call("sessions.list", input) as CapMap["sessions.list"]["out"];
    found.push(...out.sessions.filter((session) => session.projectId === projectId));
    if (!out.next || seen.has(out.next)) break;
    seen.add(out.next);
    cursor = out.next;
  } while (true);
  return found;
}

export interface ProjectNav {
  /** The project's one channel opens in Chats. */
  openChannel(channelId: string): void;
  /** A thread of that channel opens as its own chat. */
  openThread(threadId: string): void;
  /** The project's folder opens in Files. */
  openFolder(folderId: string): void;
  /** A file of the folder opens in the Files viewer. */
  openFile(fileId: string): void;
  /** A linked record opens on its own page. */
  openRecord(type: string, recordId: string): void;
  /** The project as a record page (its Overview fields). */
  openRecordPage(type: string, recordId: string): void;
}

export interface ProjectPageData {
  call(cap: string, input: unknown): Promise<unknown>;
  nameOf(id: string): string;
  now(): number;
  nav: ProjectNav;
  /** Names of files by id, for the pinned files. */
  fileName?(fileId: string): string;
  /** Present only in a Personal Space, where imported coding history is private to its owner. */
  imports?: ProjectImports;
}

const Ctx = createContext<ProjectPageData | null>(null);
export function ProjectPageDataProvider({ value, children }: { value: ProjectPageData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useProjectPageData(): ProjectPageData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The project page needs a ProjectPageDataProvider above it");
  return v;
}
