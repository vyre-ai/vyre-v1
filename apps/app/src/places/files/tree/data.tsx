// Files data: the one context the tree and the list read. The lists the screens declare come from the generated screen hooks; the lists the contract gives no screen (Recent, Shared with me,
// Knowledge, the folder tree from the local copy) come through `live`. Writes go through `call`, one capability per action. The shell supplies navigation.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FolderNode } from "../../../../../../ui/src/FolderTree/index.tsx";

export interface Connection { get(): "online" | "offline"; subscribe(l: () => void): () => void }

/** The capabilities the list reads live that no screen declares. */
export type LiveCap = "files.list" | "files.recent" | "files.shared_with_me" | "files.knowledge" | "files.trash.list" | "files.tree" | "changesets.list" | "stars.list";

/** Where a click goes. The shell supplies these (tabs, the viewer, the share sheet, the Knowledge screens); Files never decides how a thing opens. */
export interface FilesNav {
  /** Double click or Enter on a file: the viewer tab. */
  openFile(fileId: string): void;
  /** Share a folder: the shell opens ui/ShareSheet for it. */
  shareFolder(folderId: string): void;
  /** Rename and Move need a name or a place; the shell asks for it and calls the capability. */
  renameEntry(kind: "file" | "folder", id: string, current: string): void;
  newFolder(scope: "personal" | "space", parentId: string | null): void;
  openMemory(): void;
  openGraph(): void;
  /** Upload into a folder (null is the top of Files): the shell opens its picker and sends the bytes through files.upload_url. */
  upload?(folderId: string | null): void;
  /** Review a change set an agent staged: the shell opens its review surface. */
  reviewChanges?(changesetId: string): void;
  /** Resolve the two edits of a file (the Conflict tag): the shell opens the conflict choice for it. */
  resolveConflict?(fileId: string): void;
}

/** The side pane that belongs to this place: the list shows its toggle in the header. */
export interface PaneControl { open: boolean; toggle(): void }

export interface FilesData {
  screens: ScreenHooks;
  /** A live query for a capability and input over the kept copy. */
  live<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]>;
  /** Every folder the person can see, with its section and count, from the local copy (the replica's folders joined with my_access). */
  folders: LiveQuery<readonly FolderNode[]>;
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  connection: Connection;
  clock(): { now: number; offsetMin: number };
  nameOf(id: string): string;
  nav: FilesNav;
  /** The side pane's state, when the shell has one. */
  pane?: PaneControl;
}

const DataCtx = createContext<FilesData | null>(null);

export function FilesDataProvider({ value, children }: { value: FilesData; children: ReactNode }): ReactElement {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useOptionalFilesData(): FilesData | null {
  return useContext(DataCtx);
}

export function useFilesData(): FilesData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("Files needs a FilesDataProvider above it");
  return v;
}

/** A live screen query (generated/screens.ts). */
export function useScreenQuery<T>(screenId: string, name: string, state: Record<string, unknown> = {}): QueryState<T> {
  const { screens } = useFilesData();
  const key = JSON.stringify(state);
  const q = useMemo(() => screens.query(screenId, name, JSON.parse(key) as Record<string, unknown>) as LiveQuery<T>, [screens, screenId, name, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

/** A live capability query. The input is compared by value. */
export function useLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): QueryState<CapMap[C]["out"]> {
  const { live } = useFilesData();
  const key = JSON.stringify(input);
  const q = useMemo(() => live(cap, JSON.parse(key) as CapMap[C]["in"]), [live, cap, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}

export function useFolderNodes(): QueryState<readonly FolderNode[]> {
  const { folders } = useFilesData();
  return useSyncExternalStore(folders.subscribe, folders.getSnapshot, folders.getSnapshot);
}

export function useOnline(): boolean {
  const { connection } = useFilesData();
  const online = (): boolean => connection.get() === "online";
  return useSyncExternalStore(connection.subscribe, online, online);
}

/** What a list source answers: files, and folders where the source has them. */
export interface ListOut { files: CapMap["files.list"]["out"]["files"]; folders?: CapMap["files.list"]["out"]["folders"] }
export interface Source { cap: LiveCap; input: Record<string, unknown> }

/** A live list over any source the list can show. The source is compared by value. */
export function useSource(src: Source): QueryState<ListOut> {
  const { live } = useFilesData();
  const key = JSON.stringify(src);
  const q = useMemo(() => {
    const s = JSON.parse(key) as Source;
    return live(s.cap, s.input as never) as unknown as LiveQuery<ListOut>;
  }, [live, key]);
  return useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
}
