// What the Files Viewer needs from the shell: the capability door, who people and agents are by id, the clock, and where a click goes outside the viewer. The shell fills this in
// (the file id comes from the tab hash, `subject=file:<id>`); the screenshot mount and the tests pass their own.
import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export interface FilesViewerData {
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** A person, agent or Automation by id, as a name. */
  name(id: string): string;
  clock(): { now: number };
  /** Where the file sits, for the line under its name ("Marketing / Brand"). */
  pathOf?(folderId: string): string | undefined;
  /** The agents the Ask control offers, the assistant first. */
  agents: readonly { id: string; name: string; assistant?: boolean }[];
  /** Ask an agent about the file or its markup. */
  ask?(agentId: string, mode: "chat" | "do", about: { kind: string; id: string; title: string }): void;
  /** Another file of the same folder opens in this viewer. */
  openFile?(fileId: string): void;
  /** Files in the same folder, for the strip under an image. */
  siblings?(folderId: string): readonly { id: string; title: string }[];
}

const Ctx = createContext<FilesViewerData | null>(null);

export function FilesViewerDataProvider({ value, children }: { value: FilesViewerData; children: ReactNode }): ReactElement {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilesViewerData(): FilesViewerData {
  const v = useContext(Ctx);
  if (!v) throw new Error("The Files viewer needs a FilesViewerDataProvider above it");
  return v;
}
