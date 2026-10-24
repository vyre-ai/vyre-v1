// Files list model (spec 2.4, 2.16, 3.5, ARCH 7.5).
// Rows are the local replica. The list paints a window, so a 10,000-file folder stays inside the scroll budget.

export const ROW_HEIGHT = 44;
export const OVERSCAN = 2;
/** ARCH 9 scroll budget: p95 frame under 16.7 ms. perf/budgets.json is not in this tree. */
export const SCROLL_FRAME_MS = 16.7;
/** Finder spring-load: a folder hovered during a drag opens after this many milliseconds. */
export const SPRING_LOAD_MS = 500;

export const FILE_KINDS = [
  "text",
  "markdown",
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "image",
  "video",
  "audio",
  "code",
  "archive",
  "google_native",
  "other",
] as const;

export type FileKind = (typeof FILE_KINDS)[number];
export type Section = "personal" | "shared" | "space";
export type Via = "owner" | "grant" | "folder" | "space";
export type SortKey = "name" | "updated" | "size" | "kind";

export interface StoredSource {
  mountId: string;
  provider: string;
}

/** Replica row. `section` and `via` are the access projection, not columns of files.list. */
export interface StoredFile {
  id: string;
  fileId: string;
  folderId: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  version: number;
  label: number;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  thumb: boolean;
  holds: number;
  section: Section;
  via: Via;
  deletedAt?: number;
  source?: StoredSource;
}

export interface StoredFolder {
  id: string;
  folderId: string;
  name: string;
  path: string;
  parentId?: string;
  fileCount: number;
  folderCount: number;
  scope: "personal" | "space";
  section: Section;
  via: Via;
  label: number;
  git: boolean;
  reviewChanges: boolean;
  deletedAt?: number;
  source?: StoredSource;
}

export type FilesView =
  | { mode: "folder"; section?: Section; folderId?: string }
  | { mode: "shared" }
  | { mode: "recent" }
  | { mode: "trash" }
  | { mode: "knowledge"; key: "memory" | "graph" };

export interface ListQuery {
  section?: Section;
  folder?: string;
  kind?: FileKind;
  sort?: SortKey;
  dir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
}

export function isGranted(via: string): boolean {
  return via === "grant" || via === "folder";
}

export function visibleRange(count: number, scrollTop: number, viewport: number): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT);
  const start = Math.max(0, first - OVERSCAN);
  const shown = Math.max(1, Math.ceil(Math.max(viewport, ROW_HEIGHT) / ROW_HEIGHT));
  const end = Math.min(count, first + shown + OVERSCAN);
  return { start, end };
}

export function viewKey(view: FilesView): string {
  if (view.mode === "folder") return `folder:${view.section ?? ""}:${view.folderId ?? ""}`;
  if (view.mode === "knowledge") return `knowledge:${view.key}`;
  return view.mode;
}

export function queryFor(view: FilesView): ListQuery {
  if (view.mode === "shared") return { section: "shared", sort: "name", dir: "asc" };
  if (view.mode === "folder") {
    const query: ListQuery = { sort: "name", dir: "asc" };
    if (view.section) query.section = view.section;
    if (view.folderId) query.folder = view.folderId;
    return query;
  }
  return { sort: "name", dir: "asc" };
}
