// Read files.list, files.recent and files.trash.list from the local replica.
// Shared with me is the grant projection: via grant or via folder. Owners stay in Personal.

import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import { isGranted } from "./types.ts";
import type { FileKind, ListQuery, Section, SortKey, StoredFile, StoredFolder, StoredSource, Via } from "./types.ts";

const KINDS = new Set<string>([
  "text", "markdown", "document", "spreadsheet", "presentation", "pdf", "image", "video", "audio", "code", "archive", "google_native", "other",
]);

export interface FileOut {
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
  deletedAt?: number;
  source?: StoredSource;
}

export interface FolderOut {
  folderId: string;
  parentId?: string;
  name: string;
  path: string;
  fileCount: number;
  folderCount: number;
  scope: "personal" | "space";
  label: number;
  git: boolean;
  reviewChanges: boolean;
  source?: StoredSource;
}

export interface ListOut {
  files: FileOut[];
  folders: FolderOut[];
  total?: number;
  next?: string;
}

function str(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function num(row: Row, key: string, fallback: number): number {
  const value = row[key];
  return typeof value === "number" ? value : fallback;
}

function sourceOf(row: Row): StoredSource | undefined {
  const value = row.source;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.mountId !== "string" || typeof record.provider !== "string") return undefined;
  return { mountId: record.mountId, provider: record.provider };
}

function sectionOf(row: Row): Section {
  const value = str(row, "section");
  if (value === "personal" || value === "shared" || value === "space") return value;
  return "personal";
}

function viaOf(row: Row): Via {
  const value = str(row, "via");
  if (value === "owner" || value === "grant" || value === "folder" || value === "space") return value;
  return "owner";
}

export function asFile(row: Row): StoredFile | null {
  const fileId = str(row, "fileId") ?? str(row, "id");
  const name = str(row, "name");
  if (!fileId || !name) return null;
  const kindRaw = str(row, "kind") ?? "other";
  const kind = (KINDS.has(kindRaw) ? kindRaw : "other") as FileKind;
  const file: StoredFile = {
    id: str(row, "id") ?? fileId,
    fileId,
    folderId: str(row, "folderId") ?? "",
    name,
    kind,
    mime: str(row, "mime") ?? "application/octet-stream",
    size: num(row, "size", 0),
    version: num(row, "version", 1),
    label: num(row, "label", 0),
    ownerId: str(row, "ownerId") ?? "",
    createdAt: num(row, "createdAt", 0),
    updatedAt: num(row, "updatedAt", 0),
    updatedBy: str(row, "updatedBy") ?? "",
    thumb: row.thumb === true,
    holds: num(row, "holds", 0),
    section: sectionOf(row),
    via: viaOf(row),
  };
  if (typeof row.deletedAt === "number") file.deletedAt = row.deletedAt;
  const source = sourceOf(row);
  if (source) file.source = source;
  return file;
}

export function asFolder(row: Row): StoredFolder | null {
  const folderId = str(row, "folderId") ?? str(row, "id");
  const name = str(row, "name");
  if (!folderId || !name) return null;
  const scope = str(row, "scope") === "space" ? "space" : "personal";
  const folder: StoredFolder = {
    id: str(row, "id") ?? folderId,
    folderId,
    name,
    path: str(row, "path") ?? name,
    fileCount: num(row, "fileCount", 0),
    folderCount: num(row, "folderCount", 0),
    scope,
    section: sectionOf(row),
    via: viaOf(row),
    label: num(row, "label", 0),
    git: row.git === true,
    reviewChanges: row.reviewChanges === true,
  };
  const parentId = str(row, "parentId");
  if (parentId) folder.parentId = parentId;
  if (typeof row.deletedAt === "number") folder.deletedAt = row.deletedAt;
  const source = sourceOf(row);
  if (source) folder.source = source;
  return folder;
}

export function toFileOut(file: StoredFile): FileOut {
  const out: FileOut = {
    fileId: file.fileId,
    folderId: file.folderId,
    name: file.name,
    kind: file.kind,
    mime: file.mime,
    size: file.size,
    version: file.version,
    label: file.label,
    ownerId: file.ownerId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    updatedBy: file.updatedBy,
    thumb: file.thumb,
    holds: file.holds,
  };
  if (file.deletedAt !== undefined) out.deletedAt = file.deletedAt;
  if (file.source) out.source = file.source;
  return out;
}

export function toFolderOut(folder: StoredFolder): FolderOut {
  const out: FolderOut = {
    folderId: folder.folderId,
    name: folder.name,
    path: folder.path,
    fileCount: folder.fileCount,
    folderCount: folder.folderCount,
    scope: folder.scope,
    label: folder.label,
    git: folder.git,
    reviewChanges: folder.reviewChanges,
  };
  if (folder.parentId) out.parentId = folder.parentId;
  if (folder.source) out.source = folder.source;
  return out;
}

function inSection(section: Section, via: Via, rowSection: Section): boolean {
  if (section === "shared") return isGranted(via);
  if (section === "personal") return rowSection === "personal" && via === "owner";
  return rowSection === "space";
}

export function filterFiles(files: readonly StoredFile[], input: ListQuery): StoredFile[] {
  return files.filter((file) => {
    if (file.deletedAt !== undefined) return false;
    if (input.section && !inSection(input.section, file.via, file.section)) return false;
    if (input.folder && file.folderId !== input.folder) return false;
    if (input.kind && file.kind !== input.kind) return false;
    return true;
  });
}

export function filterFolders(folders: readonly StoredFolder[], input: ListQuery): StoredFolder[] {
  return folders.filter((folder) => {
    if (folder.deletedAt !== undefined) return false;
    if (input.section && !inSection(input.section, folder.via, folder.section)) return false;
    if (input.folder) return folder.parentId === input.folder;
    if (folder.parentId) return false;
    return true;
  });
}

function compareFiles(sort: SortKey | undefined, dir: "asc" | "desc" | undefined): (a: StoredFile, b: StoredFile) => number {
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => {
    let n = 0;
    if (sort === "updated") n = a.updatedAt - b.updatedAt;
    else if (sort === "size") n = a.size - b.size;
    else if (sort === "kind") n = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    else n = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (n === 0) n = a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0;
    return n * sign;
  };
}

function page<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { items: T[]; next?: string } {
  if (!limit || limit <= 0) return { items: items.slice() };
  const start = Number(cursor ?? "0");
  const from = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  const slice = items.slice(from, from + limit);
  if (from + limit < items.length) return { items: slice, next: String(from + limit) };
  return { items: slice };
}

export function listFromTables(files: readonly StoredFile[], folders: readonly StoredFolder[], input: ListQuery): ListOut {
  const shownFiles = filterFiles(files, input).sort(compareFiles(input.sort, input.dir));
  const shownFolders = filterFolders(folders, input).slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const paged = page(shownFiles, input.cursor, input.limit);
  const out: ListOut = {
    files: paged.items.map(toFileOut),
    folders: shownFolders.map(toFolderOut),
    total: shownFiles.length,
  };
  if (paged.next) out.next = paged.next;
  return out;
}

export function collect(replica: FakeReplica): { files: StoredFile[]; folders: StoredFolder[] } {
  const files: StoredFile[] = [];
  for (const row of replica.rows("files")) {
    const file = asFile(row);
    if (file) files.push(file);
  }
  const folders: StoredFolder[] = [];
  for (const row of replica.rows("folders")) {
    const folder = asFolder(row);
    if (folder) folders.push(folder);
  }
  return { files, folders };
}

/** Moving into a shared folder shares the file (spec 2.4). The bytes are not copied. */
export function applyMove(replica: FakeReplica, fileId: string, toFolderId: string): boolean {
  const { files, folders } = collect(replica);
  const file = files.find((row) => row.fileId === fileId);
  const dest = folders.find((row) => row.folderId === toFolderId);
  if (!file || !dest) return false;
  if (file.folderId === toFolderId) return false;
  const next: StoredFile = { ...file, folderId: toFolderId };
  if (dest.section === "shared" || isGranted(dest.via)) {
    next.section = "shared";
    next.via = "folder";
  } else if (dest.section === "space" || dest.via === "space") {
    next.section = "space";
    next.via = "space";
  } else {
    next.section = "personal";
    next.via = "owner";
  }
  replica.put("files", [next]);
  return true;
}

export function bindFilesList(replica: FakeReplica): void {
  replica.resolve("files.list", (tables, input) => {
    const files: StoredFile[] = [];
    for (const row of tables.get("files")?.values() ?? []) {
      const file = asFile(row);
      if (file) files.push(file);
    }
    const folders: StoredFolder[] = [];
    for (const row of tables.get("folders")?.values() ?? []) {
      const folder = asFolder(row);
      if (folder) folders.push(folder);
    }
    return listFromTables(files, folders, input);
  });
  replica.resolve("files.recent", (tables, input) => {
    const files: StoredFile[] = [];
    for (const row of tables.get("files")?.values() ?? []) {
      const file = asFile(row);
      if (file && file.deletedAt === undefined) files.push(file);
    }
    files.sort((a, b) => b.updatedAt - a.updatedAt || (a.fileId < b.fileId ? -1 : 1));
    const limit = input.limit ?? 200;
    return { files: files.slice(0, limit).map(toFileOut) };
  });
  replica.resolve("files.trash.list", (tables) => {
    const files: StoredFile[] = [];
    for (const row of tables.get("files")?.values() ?? []) {
      const file = asFile(row);
      if (file?.deletedAt !== undefined) files.push(file);
    }
    const folders: StoredFolder[] = [];
    for (const row of tables.get("folders")?.values() ?? []) {
      const folder = asFolder(row);
      if (folder?.deletedAt !== undefined) folders.push(folder);
    }
    return { files: files.map(toFileOut), folders: folders.map(toFolderOut), total: files.length + folders.length };
  });
}
