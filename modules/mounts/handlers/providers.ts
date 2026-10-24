// Mount providers (spec 2.16 Mounts; ARCH 7.5 and 8). Each provider turns one outside system into the same few operations the engine uses:
//   pull      the next batch of remote items (a full listing, or the change feed since the stored cursor)
//   download  the bytes of one item as a blob in the files blob store
//   upload / createFolder / remove   the Vyre-side change going out
//   browse    names a person can already open there, for the mount sheet
// Google Drive and Graph (SharePoint, OneDrive) go through the google and microsoft modules' capabilities, which carry the connection; nothing here talks to a provider API.
// Local folders have no pull: a device reports changes with mounts.local_report. A GitHub mount is a git folder: the git module clones (init, remote_add, pull) and pulls.
//
// Drive keeps a change feed (google.drive.list_changes since a page token) but no capability returns the first start token, so a Drive mount scans (a full listing, compared with what was mapped)
// until a cursor is stored; once one is, every pass reads the feed. Graph returns a delta link with the first listing, so it is on the feed from the first pass.

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";

type Row = Record<string, unknown>;

export type MountKind = "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
export type MountMode = "server_copy" | "live_only";

export interface MountRec {
  id: string;
  folderId: string;
  kind: MountKind;
  connectionId?: string;
  ref?: string;
  path?: string;
  branch?: string;
  deviceId?: string;
  localPath?: string;
  name: string;
  mode: MountMode;
  reviewChanges: boolean;
  pullOnly: boolean;
  cursor?: string;
}

export interface RemoteItem {
  id: string;
  name: string;
  parentId?: string;
  isFolder: boolean;
  size?: number;
  /** changes whenever the content does (modified time, etag) */
  version?: string;
  mime?: string;
  /** a Google-native document: kept as an export snapshot, never uploaded back */
  native?: boolean;
}

export interface PullBatch {
  items: RemoteItem[];
  removed: string[];
  /** the cursor to store for the next pass; absent keeps the old one */
  cursor?: string;
  /** items is the whole mounted tree, so a mapped item that is missing is gone */
  full: boolean;
  /** the remote id of the mounted root when the provider reveals it (Graph delta) */
  rootId?: string;
}

export interface Downloaded {
  blobId: string;
  size: number;
  mime?: string;
}

export interface Uploaded {
  remoteId: string;
  version?: string;
}

export interface BrowseItem { ref: string; name: string; isFolder: boolean; path?: string; shared?: boolean }

export interface Provider {
  label: string;
  /** Vyre writes go out to the provider (false: pull only, or the device does it) */
  pushes: boolean;
  pull?(ctx: Ctx, m: MountRec): Promise<PullBatch>;
  download?(ctx: Ctx, m: MountRec, item: { remoteId: string; name: string; mime?: string; native?: boolean }): Promise<Downloaded>;
  upload?(ctx: Ctx, m: MountRec, a: { fileId: string; name: string; parentRemote: string; remoteId?: string }): Promise<Uploaded>;
  createFolder?(ctx: Ctx, m: MountRec, a: { name: string; parentRemote: string }): Promise<Uploaded>;
  remove?(ctx: Ctx, m: MountRec, remoteId: string, isFolder: boolean): Promise<void>;
  browse(ctx: Ctx, input: { connectionId?: string; parent?: string; q?: string; cursor?: string; limit?: number }): Promise<{ items: BrowseItem[]; next?: string }>;
}

// ---- small readers for provider answers ---------------------------------------------------------------------

function obj(v: unknown): Row {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function whole(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const withConnection = (m: { connectionId?: string }): Row => (m.connectionId !== undefined ? { connectionId: m.connectionId } : {});

/** Most pages one pass reads, so a runaway feed cannot hold the pass forever. */
export const MAX_PAGES = 200;

// ---- Google Drive -------------------------------------------------------------------------------------------

const DRIVE_FOLDER = "application/vnd.google-apps.folder";
const DRIVE_NATIVE = "application/vnd.google-apps.";

/** What a Google-native document is kept as: an export snapshot in the format closest to its kind. */
export function exportMimeFor(native: string): string {
  if (native.endsWith(".document")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (native.endsWith(".spreadsheet")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/pdf";
}

function driveItem(f: Row, parentId?: string): RemoteItem | undefined {
  const id = text(f["id"]);
  if (id === undefined) return undefined;
  const mime = text(f["mimeType"]) ?? "";
  const isFolder = mime === DRIVE_FOLDER;
  const parent = parentId ?? text(list(f["parents"])[0]);
  const size = whole(f["size"]);
  const version = text(f["modifiedTime"]);
  return {
    id,
    name: text(f["name"]) ?? id,
    ...(parent !== undefined ? { parentId: parent } : {}),
    isFolder,
    ...(size !== undefined ? { size } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(mime !== "" ? { mime } : {}),
    ...(!isFolder && mime.startsWith(DRIVE_NATIVE) ? { native: true } : {}),
  };
}

async function driveScan(ctx: Ctx, m: MountRec): Promise<PullBatch> {
  const root = m.ref;
  if (root === undefined) return { items: [], removed: [], full: true };
  const items: RemoteItem[] = [];
  const queue: string[] = [root];
  let pages = 0;
  for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
    let pageToken: string | undefined;
    do {
      const res = obj(await ctx.call("google.drive.list_files", { ...withConnection(m), parentId: folder, pageSize: 1000, ...(pageToken !== undefined ? { pageToken } : {}) }));
      for (const f of list(res["files"])) {
        const it = driveItem(obj(f), folder);
        if (!it) continue;
        items.push(it);
        if (it.isFolder) queue.push(it.id);
      }
      pageToken = text(res["nextPageToken"]);
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_PAGES);
  }
  return { items, removed: [], full: true };
}

async function driveFeed(ctx: Ctx, m: MountRec, cursor: string): Promise<PullBatch> {
  const items: RemoteItem[] = [];
  const removed: string[] = [];
  let token: string | undefined = cursor;
  let next: string | undefined;
  for (let pages = 0; token !== undefined && pages < MAX_PAGES; pages++) {
    const res = obj(await ctx.call("google.drive.list_changes", { ...withConnection(m), pageToken: token }));
    for (const c of list(res["changes"])) {
      const ch = obj(c);
      const fileId = text(ch["fileId"]);
      if (ch["removed"] === true && fileId !== undefined) removed.push(fileId);
      else {
        const it = driveItem(obj(ch["file"]));
        if (it) items.push(it);
      }
    }
    next = text(res["newStartPageToken"]) ?? next;
    token = text(res["nextPageToken"]);
  }
  return { items, removed, full: false, ...(next !== undefined ? { cursor: next } : {}) };
}

const google: Provider = {
  label: "Google Drive",
  pushes: true,
  async pull(ctx, m) {
    return m.cursor !== undefined ? driveFeed(ctx, m, m.cursor) : driveScan(ctx, m);
  },
  async download(ctx, m, item) {
    if (item.native === true && item.mime !== undefined) {
      const mime = exportMimeFor(item.mime);
      const res = obj(await ctx.call("google.drive.export_file", { ...withConnection(m), fileId: item.remoteId, mimeType: mime }));
      return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0, mime };
    }
    const res = obj(await ctx.call("google.drive.download_file", { ...withConnection(m), fileId: item.remoteId }));
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0, ...(text(res["mimeType"]) !== undefined ? { mime: text(res["mimeType"]) as string } : {}) };
  },
  async upload(ctx, m, a) {
    const res = obj(await ctx.call("google.drive.upload_file", { ...withConnection(m), name: a.name, parentId: a.parentRemote, fileId: a.fileId }));
    const f = obj(res["file"]);
    return { remoteId: text(f["id"]) ?? a.remoteId ?? "", ...(text(f["modifiedTime"]) !== undefined ? { version: text(f["modifiedTime"]) as string } : {}) };
  },
  async createFolder(ctx, m, a) {
    const res = obj(await ctx.call("google.drive.create_folder", { ...withConnection(m), name: a.name, parentId: a.parentRemote }));
    return { remoteId: text(obj(res["file"])["id"]) ?? "" };
  },
  async remove(ctx, m, remoteId) {
    await ctx.call("google.drive.trash_file", { ...withConnection(m), fileId: remoteId });
  },
  async browse(ctx, input) {
    const res = obj(await ctx.call("google.drive.list_files", {
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
      ...(input.parent !== undefined ? { parentId: input.parent } : {}),
      ...(input.q !== undefined ? { q: `name contains '${input.q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'` } : {}),
      ...(input.cursor !== undefined ? { pageToken: input.cursor } : {}),
      ...(input.limit !== undefined ? { pageSize: input.limit } : {}),
    }));
    const items: BrowseItem[] = [];
    for (const f of list(res["files"])) {
      const it = driveItem(obj(f));
      if (it) items.push({ ref: it.id, name: it.name, isFolder: it.isFolder });
    }
    const next = text(res["nextPageToken"]);
    return { items, ...(next !== undefined ? { next } : {}) };
  },
};

// ---- SharePoint and OneDrive (Microsoft Graph) --------------------------------------------------------------

/** The mount's `ref` is the drive id (absent: the person's own OneDrive) and `path` the item id of the mounted folder (absent: the whole drive). */
function graphItem(f: Row): RemoteItem | undefined {
  const id = text(f["id"]);
  if (id === undefined) return undefined;
  const isFolder = f["folder"] === true;
  const parent = text(f["parentId"]);
  const size = whole(f["size"]);
  const version = text(f["lastModifiedDateTime"]);
  return {
    id,
    name: text(f["name"]) ?? id,
    ...(parent !== undefined ? { parentId: parent } : {}),
    isFolder,
    ...(size !== undefined ? { size } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

const driveOf = (m: { ref?: string }): Row => (m.ref !== undefined ? { driveId: m.ref } : {});

const graph: Provider = {
  label: "SharePoint",
  pushes: true,
  async pull(ctx, m) {
    const items: RemoteItem[] = [];
    const removed: string[] = [];
    let rootId: string | undefined = m.path;
    const res = obj(await ctx.call("ms.drive.delta", { ...withConnection(m), ...driveOf(m), ...(m.cursor !== undefined ? { deltaLink: m.cursor } : {}) }));
    for (const c of list(res["changed"])) {
      const it = graphItem(obj(c));
      if (!it) continue;
      // the drive root comes back as the one folder without a parent
      if (it.parentId === undefined && it.isFolder && rootId === undefined) rootId = it.id;
      items.push(it);
    }
    for (const r of list(res["removed"])) {
      const id = text(r);
      if (id !== undefined) removed.push(id);
    }
    const cursor = text(res["deltaLink"]);
    return { items, removed, full: m.cursor === undefined, ...(cursor !== undefined ? { cursor } : {}), ...(rootId !== undefined ? { rootId } : {}) };
  },
  async download(ctx, m, item) {
    const res = obj(await ctx.call("ms.drive.download_item", { ...withConnection(m), ...driveOf(m), itemId: item.remoteId }));
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0 };
  },
  async upload(ctx, m, a) {
    const res = obj(await ctx.call("ms.drive.upload_item", { ...withConnection(m), ...driveOf(m), folderId: a.parentRemote, name: a.name, fileId: a.fileId }));
    const it = obj(res["item"]);
    return { remoteId: text(it["id"]) ?? a.remoteId ?? "", ...(text(it["lastModifiedDateTime"]) !== undefined ? { version: text(it["lastModifiedDateTime"]) as string } : {}) };
  },
  async createFolder(ctx, m, a) {
    const res = obj(await ctx.call("ms.drive.create_folder", { ...withConnection(m), ...driveOf(m), parentId: a.parentRemote, name: a.name }));
    return { remoteId: text(obj(res["item"])["id"]) ?? "" };
  },
  async remove(ctx, m, remoteId) {
    await ctx.call("ms.drive.delete_item", { ...withConnection(m), ...driveOf(m), itemId: remoteId });
  },
  /** `parent` is "<driveId>" for a drive's top or "<driveId>:<itemId>" inside it; no parent lists the caller's own OneDrive. */
  async browse(ctx, input) {
    const [driveId, folderId] = (input.parent ?? "").split(":", 2);
    const res = obj(await ctx.call("ms.drive.list_items", {
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
      ...(driveId ? { driveId } : {}),
      ...(folderId ? { folderId } : {}),
      ...(input.cursor !== undefined ? { skipToken: input.cursor } : {}),
    }));
    const q = input.q?.toLowerCase();
    const items: BrowseItem[] = [];
    for (const f of list(res["items"])) {
      const it = graphItem(obj(f));
      if (!it || (q !== undefined && !it.name.toLowerCase().includes(q))) continue;
      items.push({ ref: driveId ? `${driveId}:${it.id}` : it.id, name: it.name, isFolder: it.isFolder });
    }
    const next = text(res["nextSkipToken"]);
    return { items, ...(next !== undefined ? { next } : {}) };
  },
};

// ---- local folders and GitHub -------------------------------------------------------------------------------

/** A folder on a person's computer: the device reports what changed, Vyre only keeps the copy (or the index, for a live-only mount). */
const local: Provider = {
  label: "Local folder",
  pushes: false,
  async browse() {
    // a device's folders are listed by the app on that device; the server cannot see them
    return { items: [] };
  },
};

/** A GitHub repository: a git folder cloned through the git module with the installation token. The git module owns the working tree, history and pushes. */
const github: Provider = {
  label: "GitHub",
  pushes: false,
  async browse(ctx, input) {
    const res = obj(await ctx.call("github.repos.list", {
      ...(input.q !== undefined ? { query: input.q } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }));
    const items: BrowseItem[] = [];
    for (const r of list(res["repos"])) {
      const repo = obj(r);
      const name = text(repo["repo"]);
      if (name !== undefined) items.push({ ref: name, name, isFolder: true, path: text(repo["url"]) ?? `https://github.com/${name}`, shared: repo["private"] === true ? false : true });
    }
    const next = text(res["next"]);
    return { items, ...(next !== undefined ? { next } : {}) };
  },
};

export function providerOf(kind: MountKind): Provider {
  switch (kind) {
    case "google_drive": return google;
    case "sharepoint": return graph;
    case "onedrive": return { ...graph, label: "OneDrive" };
    case "local": return local;
    case "github": return github;
  }
}

export const PROVIDER_LABEL: Record<MountKind, string> = {
  google_drive: "Google Drive",
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  local: "Local folder",
  github: "GitHub",
};

export const isCloud = (kind: MountKind): boolean => kind === "google_drive" || kind === "sharepoint" || kind === "onedrive";
