// Mount providers (spec 2.16 Mounts; ARCH 7.5 and 8). Each provider turns one outside system into the same few operations the engine uses:
//   pull      the next batch of remote items (a full listing, or the change feed since the stored cursor)
//   download  the bytes of one item as a blob in the files blob store
//   upload / createFolder / remove   the Vyre-side change going out; an upload names the version it was based on and is refused (stale) when the provider moved on
//   browse    names a person can already open there, for the mount sheet
//   watch / unwatch   a push channel (Drive changes.watch, a Graph drive subscription) that wakes a pass when something changes there
//   revisions / revisionBlob   the provider's own history of a file, and the bytes of one revision
// Google Drive and Graph (SharePoint, OneDrive) go through the google and microsoft modules' capabilities, which carry the connection; nothing here talks to a provider API.
// Local folders have no pull: a device reports changes with mounts.local_report. A GitHub mount is a git folder: the git module clones (init, remote_add, pull) and pulls.
//
// Drive keeps a change feed (google.drive.list_changes since a page token) but no capability returns the first start token, so a Drive mount scans (a full listing, compared with what was mapped)
// until a cursor is stored; once one is, every pass reads the feed. Graph returns a delta link with the first listing, so it is on the feed from the first pass.

import { VyreErr, vyreErrorOf } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { dropbox } from "./dropbox-provider.ts";

type Row = Record<string, unknown>;

export type MountKind = "google_drive" | "sharepoint" | "onedrive" | "dropbox" | "local" | "github";
export type MountMode = "server_copy" | "live_only";

export interface MountRec {
  id: string;
  folderId: string;
  kind: MountKind;
  connectionId?: string;
  /** the work address the mount syncs as (the person who made it) */
  account?: string;
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
  /** a listing the last pass left unfinished: the folders still to read (the first with the page token it stopped at), the change token taken when the listing began, and how many items were read */
  scan?: Scan;
}

/** Where a listing larger than one pass stopped, kept with the mount so the next pass resumes there. */
export interface Scan {
  queue: { folder: string; token?: string }[];
  startToken?: string;
  count: number;
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
  /** the provider's revision or etag of the content: what a write is conditional on */
  revision?: string;
  /** who last edited it at the provider, and when */
  editor?: Person;
  modifiedAt?: number;
  /** in the provider's own Trash (Drive reports a trashed file as a change, not as removed) */
  trashed?: boolean;
  /** whether the signed-in person may change it there; absent when the provider does not say */
  canEdit?: boolean;
}

export interface Person {
  name?: string;
  email?: string;
}

/** One entry of the provider's history of a file. */
export interface Revision {
  id: string;
  at?: number;
  size?: number;
  by?: Person;
}

/** A push channel the provider holds for a mount: `id` is what a notice names, `resource` what is needed to close it. */
export interface Watch {
  id: string;
  resource?: string;
  expiresAt: number;
}

/** The version a write was based on. Drive checks `revision`, Graph sends it as If-Match. */
export interface IfMatch {
  version?: string;
  revision?: string;
}

export interface PullBatch {
  items: RemoteItem[];
  removed: string[];
  /** the cursor to store for the next pass; absent keeps the old one */
  cursor?: string;
  /** items is the whole mounted tree, so a mapped item that is missing is gone */
  full: boolean;
  /** The pass stopped at its page limit: what came is only the start of the listing. Nothing is treated as gone, and the mount says this in plain words. */
  partial?: string;
  /** the remote id of the mounted root when the provider reveals it (Graph delta) */
  rootId?: string;
  /** where an unfinished listing stopped, to be kept with the mount (an empty queue clears it, so the next pass starts again) */
  scan?: Scan;
  /** this pass read the last of a listing that took several passes: the engine adds the ids it kept from the earlier ones before it treats anything as gone */
  scanDone?: boolean;
  /** the ids the earlier passes of this listing saw (filled by the engine) */
  seenBefore?: ReadonlySet<string>;
}

export interface Downloaded {
  blobId: string;
  size: number;
  mime?: string;
}

export interface Uploaded {
  remoteId: string;
  version?: string;
  revision?: string;
  editor?: Person;
  /** nothing was written: the item at the provider is no longer the one the write was based on */
  stale?: boolean;
  /** the write went out, but another revision had been saved there between the one it was based on and this one (the check and the upload are two calls): that revision is named here */
  between?: { revisionId: string; by?: Person; at?: number };
}

export interface BrowseItem {
  ref: string;
  name: string;
  isFolder: boolean;
  path?: string;
  shared?: boolean;
}

export interface Provider {
  label: string;
  /** Vyre writes go out to the provider (false: pull only, or the device does it) */
  pushes: boolean;
  pull?(ctx: Ctx, m: MountRec): Promise<PullBatch>;
  download?(
    ctx: Ctx,
    m: MountRec,
    item: { remoteId: string; name: string; mime?: string; native?: boolean },
  ): Promise<Downloaded>;
  /** Every write carries `key`: the host refuses an outward write without an idempotency key, and the same key on a retry runs nothing twice. */
  upload?(
    ctx: Ctx,
    m: MountRec,
    a: { fileId: string; name: string; parentRemote: string; remoteId?: string; ifMatch?: IfMatch; key: string },
  ): Promise<Uploaded>;
  createFolder?(ctx: Ctx, m: MountRec, a: { name: string; parentRemote: string; key: string }): Promise<Uploaded>;
  /** Puts the item in the provider's own Trash or recycle bin (recoverable there); never a permanent delete. */
  remove?(ctx: Ctx, m: MountRec, remoteId: string, isFolder: boolean, key: string): Promise<void>;
  /** A rename and/or a move of the same item (its id, links and sharing stay). `stale`: the item changed there since `ifMatch`, nothing was changed. */
  update?(
    ctx: Ctx,
    m: MountRec,
    a: {
      remoteId: string;
      name?: string;
      addParent?: string;
      removeParent?: string;
      ifMatch?: IfMatch;
      key: string;
    },
  ): Promise<Uploaded>;
  /** Takes the item back out of the provider's Trash; throws validation.unsupported where the provider does not let Vyre do it. */
  restore?(ctx: Ctx, m: MountRec, remoteId: string, key: string): Promise<Uploaded>;
  /** The item as the provider holds it now (undefined: gone). Opening a file compares this with what is cached. */
  stat?(ctx: Ctx, m: MountRec, remoteId: string): Promise<RemoteItem | undefined>;
  /** The provider renews its own push channel (Graph, by the microsoft module's Run); the mount only keeps the id. */
  watchRenewsItself?: boolean;
  /** Open a push channel; absent or undefined: this mount cannot be pushed to and is polled. `cursor` is the change token the channel starts from. */
  watch?(ctx: Ctx, m: MountRec, a: { address: string; channelId: string }): Promise<Watch | undefined>;
  unwatch?(ctx: Ctx, m: MountRec, w: { id: string; resource?: string }): Promise<void>;
  revisions?(ctx: Ctx, m: MountRec, remoteId: string): Promise<Revision[]>;
  revisionBlob?(ctx: Ctx, m: MountRec, a: { remoteId: string; revisionId: string }): Promise<Downloaded>;
  /** The URL path the provider's notices come in on, appended to the Space's public address. */
  hookPath?: string;
  browse(
    ctx: Ctx,
    input: { connectionId?: string; parent?: string; q?: string; cursor?: string; limit?: number },
  ): Promise<{ items: BrowseItem[]; next?: string }>;
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

/** The connection and the person the call is for: Drive and Graph calls act as the mount's own account, never as whoever happens to run the pass. */
const withConnection = (m: { connectionId?: string; account?: string }): Row => ({
  ...(m.connectionId !== undefined ? { connectionId: m.connectionId } : {}),
  ...(m.account !== undefined ? { as: m.account } : {}),
});

/** Most pages one pass reads, so a runaway feed cannot hold the pass forever. */
export const MAX_PAGES = 200;

/** What a mount says while a listing larger than one sync is still being read. */
export const scanWords = (count: number): string =>
  `Reading this folder: ${count.toLocaleString("en-US")} items so far. It carries on at the next sync, and nothing is removed until all of it has been read.`;

// ---- Google Drive -------------------------------------------------------------------------------------------

const DRIVE_FOLDER = "application/vnd.google-apps.folder";
const DRIVE_NATIVE = "application/vnd.google-apps.";

/**
 * What a Google-native file is kept as: an export a person and an agent can read. A Doc is Markdown (headings, lists and tables stay words), a Sheet is CSV (its first tab, drawn as a table),
 * Slides and a Jamboard are PDF (pages, with their text taken out), a Drawing is a PNG. A Form, a Site, a map, a shortcut or an Apps Script project has no export that reads as the file: undefined,
 * and the file opens at Google instead. A Google-native file has no bytes of its own, so it is never downloaded.
 */
export function exportMimeFor(native: string): string | undefined {
  if (native.endsWith(".document")) return "text/markdown";
  if (native.endsWith(".spreadsheet")) return "text/csv";
  if (native.endsWith(".presentation") || native.endsWith(".jam")) return "application/pdf";
  if (native.endsWith(".drawing")) return "image/png";
  return undefined;
}

/** The Google app a native file opens in, for "Open in Google Docs". */
export function googleAppOf(native: string | undefined): string {
  const kind = (native ?? "").slice((native ?? "").lastIndexOf(".") + 1);
  const app: Record<string, string> = {
    document: "Google Docs",
    spreadsheet: "Google Sheets",
    presentation: "Google Slides",
    drawing: "Google Drawings",
    form: "Google Forms",
    site: "Google Sites",
    jam: "Jamboard",
    map: "Google My Maps",
    script: "Apps Script",
  };
  return (native ?? "").startsWith(DRIVE_NATIVE) ? (app[kind] ?? "Google Drive") : "Google Drive";
}

/** Whether there is content to fetch for an item: any file with bytes, and a Google-native file with an export. */
export const fetchable = (item: { mime?: string; native?: boolean }): boolean =>
  item.native !== true || (item.mime !== undefined && exportMimeFor(item.mime) !== undefined);

const personOf = (u: Row, nameKey: string, mailKey: string): Person | undefined => {
  const name = text(u[nameKey]);
  const email = text(u[mailKey]);
  return name !== undefined || email !== undefined
    ? { ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}) }
    : undefined;
};

const stamp = (v: unknown): number | undefined => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : undefined;
};

function driveItem(f: Row, parentId?: string): RemoteItem | undefined {
  const id = text(f["id"]);
  if (id === undefined) return undefined;
  const mime = text(f["mimeType"]) ?? "";
  const isFolder = mime === DRIVE_FOLDER;
  const parent = parentId ?? text(list(f["parents"])[0]);
  const size = whole(f["size"]);
  const version = text(f["modifiedTime"]);
  const revision = text(f["headRevisionId"]);
  const editor = personOf(obj(f["lastModifyingUser"]), "name", "email");
  const modifiedAt = stamp(version);
  return {
    id,
    name: text(f["name"]) ?? id,
    ...(parent !== undefined ? { parentId: parent } : {}),
    isFolder,
    ...(f["trashed"] === true ? { trashed: true } : {}),
    ...(typeof f["canEdit"] === "boolean" ? { canEdit: f["canEdit"] } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(mime !== "" ? { mime } : {}),
    ...(!isFolder && mime.startsWith(DRIVE_NATIVE) ? { native: true } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(editor !== undefined ? { editor } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
  };
}

/** "root" is Drive's alias for My Drive. The change feed names the real id as a file's parent, so a mount of My Drive maps that id, or every change at its top would read as a move out. */
export const DRIVE_ROOT_ALIAS = "root";

async function driveScan(ctx: Ctx, m: MountRec): Promise<PullBatch> {
  const resuming = m.scan !== undefined && m.scan.queue.length > 0;
  let root = m.ref;
  if (root === undefined && !resuming) return { items: [], removed: [], full: true };
  let rootId: string | undefined;
  if (!resuming && root === DRIVE_ROOT_ALIAS) {
    try {
      rootId = text(
        obj(obj(await ctx.call("google.drive.get_file", { ...withConnection(m), fileId: root }))["file"])["id"],
      );
    } catch {
      /* the alias still lists; the next scan tries again */
    }
    if (rootId !== undefined) root = rootId;
  }
  // The feed's start token is taken before the first page of a listing and kept until the listing is whole (it may take several passes), so a change made meanwhile is read by the feed after it.
  // Without one the mount rescans every time.
  let cursor: string | undefined = m.scan?.startToken;
  if (!resuming) {
    try {
      cursor = text(obj(await ctx.call("google.drive.changes_start_token", withConnection(m)))["startPageToken"]);
    } catch {
      /* no token: the next pass scans again */
    }
  }
  const queue: { folder: string; token?: string }[] = resuming
    ? m.scan!.queue.map((q) => ({ ...q }))
    : [{ folder: root as string }];
  const items: RemoteItem[] = [];
  let pages = 0;
  try {
    while (queue.length > 0 && pages < MAX_PAGES) {
      const head = queue[0]!;
      const res = obj(
        await ctx.call("google.drive.list_files", {
          ...withConnection(m),
          parentId: head.folder,
          pageSize: 1000,
          ...(head.token !== undefined ? { pageToken: head.token } : {}),
        }),
      );
      for (const f of list(res["files"])) {
        const it = driveItem(obj(f), head.folder);
        if (!it) continue;
        items.push(it);
        if (it.isFolder) queue.push({ folder: it.id });
      }
      pages += 1;
      const next = text(res["nextPageToken"]);
      if (next !== undefined) head.token = next;
      else queue.shift();
    }
  } catch (e) {
    // a page token Drive no longer accepts must not trap the mount: the next pass starts the listing again. Anything else is left to the engine as it was.
    if (
      resuming &&
      !/^(provider\.(unavailable|network|rate_limited|overloaded|auth_failed)|timeout\.)/.test(
        vyreErrorOf(e)?.code ?? "",
      )
    )
      return {
        items: [],
        removed: [],
        full: false,
        partial: scanWords(m.scan?.count ?? 0),
        scan: { queue: [], count: 0 },
      };
    throw e;
  }
  const count = (m.scan?.count ?? 0) + items.length;
  if (queue.length > 0)
    // not everything has been read: nothing is removed, and the next pass resumes where this one stopped
    return {
      items,
      removed: [],
      full: false,
      partial: scanWords(count),
      scan: { queue, ...(cursor !== undefined ? { startToken: cursor } : {}), count },
      ...(rootId !== undefined ? { rootId } : {}),
    };
  return {
    items,
    removed: [],
    full: true,
    scanDone: true,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(rootId !== undefined ? { rootId } : {}),
  };
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
      const it = ch["removed"] === true ? undefined : driveItem(obj(ch["file"]));
      // Drive reports a file in its Trash as a change to the file, not as removed
      if ((ch["removed"] === true || it?.trashed === true) && fileId !== undefined) removed.push(fileId);
      else if (it) items.push(it);
    }
    next = text(res["newStartPageToken"]) ?? next;
    token = text(res["nextPageToken"]);
  }
  // the page limit with more changes waiting: the next pass resumes from where this one stopped, never from the feed's end
  if (token !== undefined) return { items, removed, full: false, cursor: token };
  return { items, removed, full: false, ...(next !== undefined ? { cursor: next } : {}) };
}

const google: Provider = {
  label: "Google Drive",
  pushes: true,
  async pull(ctx, m) {
    return m.cursor !== undefined ? driveFeed(ctx, m, m.cursor) : driveScan(ctx, m);
  },
  async download(ctx, m, item) {
    if (item.native === true) {
      // a Google-native file has no bytes: it is exported, never downloaded (Drive refuses alt=media for one)
      const mime = item.mime !== undefined ? exportMimeFor(item.mime) : undefined;
      if (mime === undefined)
        throw new VyreErr({
          code: "validation.unsupported",
          message: `A ${googleAppOf(item.mime)} file has no export Vyre can show. Open it in ${googleAppOf(item.mime)}.`,
          retryable: false,
          traceId: ctx.trace.traceId,
          next: [],
        });
      const exported = async (as: string): Promise<Downloaded> => {
        const res = obj(
          await ctx.call("google.drive.export_file", { ...withConnection(m), fileId: item.remoteId, mimeType: as }),
        );
        return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0, mime: as };
      };
      if (mime !== "text/markdown") return exported(mime);
      // Markdown is the newer export of a Doc; where Drive does not offer it, plain text still reads as the document
      try {
        return await exported(mime);
      } catch (e) {
        if (
          (vyreErrorOf(e)?.code ?? "").startsWith("provider.auth") ||
          vyreErrorOf(e)?.code === "provider.rate_limited" ||
          (vyreErrorOf(e)?.code ?? "").startsWith("permission.")
        )
          throw e;
        return exported("text/plain");
      }
    }
    const res = obj(await ctx.call("google.drive.download_file", { ...withConnection(m), fileId: item.remoteId }));
    return {
      blobId: text(res["blobId"]) ?? "",
      size: whole(res["size"]) ?? 0,
      ...(text(res["mimeType"]) !== undefined ? { mime: text(res["mimeType"]) as string } : {}),
    };
  },
  async upload(ctx, m, a) {
    const res = obj(
      await ctx.call("google.drive.upload_file", {
        ...withConnection(m),
        name: a.name,
        parentId: a.parentRemote,
        fileId: a.fileId,
        ...(a.remoteId !== undefined ? { remoteId: a.remoteId } : {}),
        ...(a.remoteId !== undefined && a.ifMatch?.revision !== undefined ? { ifRevision: a.ifMatch.revision } : {}),
        idempotencyKey: a.key,
      }),
    );
    const it = driveItem(obj(res["file"]));
    // Drive has no If-Match on an upload: the check above and the upload are two calls. A revision saved between them was written over; it is still in Drive's revision list, and it is named here.
    let between: Uploaded["between"];
    if (
      res["stale"] !== true &&
      a.remoteId !== undefined &&
      a.ifMatch?.revision !== undefined &&
      it?.revision !== undefined
    ) {
      try {
        const revs = list(
          obj(await ctx.call("google.drive.list_revisions", { ...withConnection(m), fileId: a.remoteId }))["revisions"],
        ).map(obj);
        const from = revs.findIndex((r) => text(r["id"]) === a.ifMatch?.revision);
        const to = revs.findIndex((r) => text(r["id"]) === it.revision);
        const mid = from >= 0 && to > from + 1 ? revs[from + 1] : undefined;
        if (mid !== undefined) {
          const by = personOf(obj(mid["lastModifyingUser"]), "name", "email");
          const at = stamp(mid["modifiedTime"]);
          between = {
            revisionId: text(mid["id"]) ?? "",
            ...(by !== undefined ? { by } : {}),
            ...(at !== undefined ? { at } : {}),
          };
        }
      } catch {
        /* the revision list is a check on top of the write: a failure of it does not undo the write */
      }
    }
    return {
      remoteId: it?.id ?? a.remoteId ?? "",
      ...(it?.version !== undefined ? { version: it.version } : {}),
      ...(it?.revision !== undefined ? { revision: it.revision } : {}),
      ...(it?.editor !== undefined ? { editor: it.editor } : {}),
      ...(res["stale"] === true ? { stale: true } : {}),
      ...(between !== undefined ? { between } : {}),
    };
  },
  hookPath: "/hooks/google/drive",
  async stat(ctx, m, remoteId) {
    return driveItem(
      obj(obj(await ctx.call("google.drive.get_file", { ...withConnection(m), fileId: remoteId }))["file"]),
    );
  },
  async watch(ctx, m, a) {
    // a channel starts from the change token the mount already holds; before the first pass there is none and the mount is scanned
    if (m.cursor === undefined) return undefined;
    const res = obj(
      await ctx.call("google.drive.watch_changes", {
        ...withConnection(m),
        pageToken: m.cursor,
        channelId: a.channelId,
        address: a.address,
        idempotencyKey: `mnt:watch:${m.id}:${a.channelId}`,
      }),
    );
    const resource = text(res["resourceId"]);
    return {
      id: a.channelId,
      ...(resource !== undefined ? { resource } : {}),
      expiresAt: whole(res["expiration"]) ?? 0,
    };
  },
  async unwatch(ctx, m, w) {
    if (w.resource !== undefined)
      await ctx.call("google.drive.stop_watch", {
        ...withConnection(m),
        channelId: w.id,
        resourceId: w.resource,
        idempotencyKey: `mnt:unwatch:${m.id}:${w.id}`,
      });
  },
  async revisions(ctx, m, remoteId) {
    const res = obj(await ctx.call("google.drive.list_revisions", { ...withConnection(m), fileId: remoteId }));
    return list(res["revisions"]).map((r) => {
      const o = obj(r);
      const at = stamp(o["modifiedTime"]);
      const size = whole(o["size"]);
      const by = personOf(obj(o["lastModifyingUser"]), "name", "email");
      return {
        id: text(o["id"]) ?? "",
        ...(at !== undefined ? { at } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(by !== undefined ? { by } : {}),
      };
    });
  },
  async revisionBlob(ctx, m, a) {
    const res = obj(
      await ctx.call("google.drive.download_revision", {
        ...withConnection(m),
        fileId: a.remoteId,
        revisionId: a.revisionId,
      }),
    );
    return {
      blobId: text(res["blobId"]) ?? "",
      size: whole(res["size"]) ?? 0,
      ...(text(res["mimeType"]) !== undefined ? { mime: text(res["mimeType"]) as string } : {}),
    };
  },
  async createFolder(ctx, m, a) {
    const res = obj(
      await ctx.call("google.drive.create_folder", {
        ...withConnection(m),
        name: a.name,
        parentId: a.parentRemote,
        idempotencyKey: a.key,
      }),
    );
    return { remoteId: text(obj(res["file"])["id"]) ?? "" };
  },
  async remove(ctx, m, remoteId, _isFolder, key) {
    await ctx.call("google.drive.trash_file", { ...withConnection(m), fileId: remoteId, idempotencyKey: key });
  },
  async update(ctx, m, a) {
    // Drive has no If-Match on a metadata change, so a rename or move conditional on the revision reads the file first (the upload does the same)
    if (a.ifMatch?.revision !== undefined) {
      const now = driveItem(
        obj(obj(await ctx.call("google.drive.get_file", { ...withConnection(m), fileId: a.remoteId }))["file"]),
      );
      if (now !== undefined && now.revision !== a.ifMatch.revision)
        return { remoteId: a.remoteId, stale: true, ...(now.editor !== undefined ? { editor: now.editor } : {}) };
    }
    const res = obj(
      await ctx.call("google.drive.update_file", {
        ...withConnection(m),
        fileId: a.remoteId,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.addParent !== undefined ? { addParentId: a.addParent } : {}),
        ...(a.removeParent !== undefined ? { removeParentId: a.removeParent } : {}),
        idempotencyKey: a.key,
      }),
    );
    const it = driveItem(obj(res["file"]));
    return { remoteId: it?.id ?? a.remoteId, ...(it?.version !== undefined ? { version: it.version } : {}) };
  },
  async restore(ctx, m, remoteId, key) {
    const res = obj(
      await ctx.call("google.drive.update_file", {
        ...withConnection(m),
        fileId: remoteId,
        trashed: false,
        idempotencyKey: key,
      }),
    );
    return { remoteId: driveItem(obj(res["file"]))?.id ?? remoteId };
  },
  async browse(ctx, input) {
    const res = obj(
      await ctx.call("google.drive.list_files", {
        ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
        ...(input.parent !== undefined ? { parentId: input.parent } : {}),
        ...(input.q !== undefined
          ? { q: `name contains '${input.q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'` }
          : {}),
        ...(input.cursor !== undefined ? { pageToken: input.cursor } : {}),
        ...(input.limit !== undefined ? { pageSize: input.limit } : {}),
      }),
    );
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
  const revision = text(f["eTag"]);
  const editor = personOf(obj(f["lastModifiedBy"]), "name", "email");
  const modifiedAt = stamp(version);
  return {
    id,
    name: text(f["name"]) ?? id,
    ...(parent !== undefined ? { parentId: parent } : {}),
    isFolder,
    ...(size !== undefined ? { size } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(editor !== undefined ? { editor } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
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
    const res = obj(
      await ctx.call("ms.drive.delta", {
        ...withConnection(m),
        ...driveOf(m),
        ...(m.cursor !== undefined ? { deltaLink: m.cursor } : {}),
      }),
    );
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
    return {
      items,
      removed,
      full: m.cursor === undefined,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(rootId !== undefined ? { rootId } : {}),
    };
  },
  async download(ctx, m, item) {
    const res = obj(
      await ctx.call("ms.drive.download_item", { ...withConnection(m), ...driveOf(m), itemId: item.remoteId }),
    );
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0 };
  },
  async upload(ctx, m, a) {
    const res = obj(
      await ctx.call("ms.drive.upload_item", {
        ...withConnection(m),
        ...driveOf(m),
        folderId: a.parentRemote,
        name: a.name,
        fileId: a.fileId,
        ...(a.remoteId !== undefined ? { remoteId: a.remoteId } : {}),
        ...(a.remoteId !== undefined && a.ifMatch?.revision !== undefined ? { ifMatch: a.ifMatch.revision } : {}),
        idempotencyKey: a.key,
      }),
    );
    const it = graphItem(obj(res["item"]));
    return {
      remoteId: it?.id ?? a.remoteId ?? "",
      ...(it?.version !== undefined ? { version: it.version } : {}),
      ...(it?.revision !== undefined ? { revision: it.revision } : {}),
      ...(it?.editor !== undefined ? { editor: it.editor } : {}),
      ...(res["stale"] === true ? { stale: true } : {}),
    };
  },
  hookPath: "/hooks/microsoft",
  watchRenewsItself: true,
  async stat(ctx, m, remoteId) {
    return graphItem(
      obj(obj(await ctx.call("ms.drive.get_item", { ...withConnection(m), ...driveOf(m), itemId: remoteId }))["item"]),
    );
  },
  async watch(ctx, m, a) {
    const res = obj(
      await ctx.call("ms.drive.subscribe", {
        ...withConnection(m),
        ...driveOf(m),
        notificationUrl: a.address,
        idempotencyKey: `mnt:sub:${m.id}:${a.channelId}`,
      }),
    );
    const id = text(res["subscriptionId"]);
    return id !== undefined ? { id, expiresAt: whole(res["expiresAt"]) ?? 0 } : undefined;
  },
  async unwatch(ctx, m, w) {
    await ctx.call("ms.drive.unsubscribe", {
      ...withConnection(m),
      subscriptionId: w.id,
      idempotencyKey: `mnt:unsub:${m.id}:${w.id}`,
    });
  },
  async revisions(ctx, m, remoteId) {
    const res = obj(
      await ctx.call("ms.drive.list_versions", { ...withConnection(m), ...driveOf(m), itemId: remoteId }),
    );
    return list(res["versions"]).map((r) => {
      const o = obj(r);
      const at = stamp(o["lastModifiedDateTime"]);
      const size = whole(o["size"]);
      const by = personOf(obj(o["lastModifiedBy"]), "name", "email");
      return {
        id: text(o["id"]) ?? "",
        ...(at !== undefined ? { at } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(by !== undefined ? { by } : {}),
      };
    });
  },
  async revisionBlob(ctx, m, a) {
    const res = obj(
      await ctx.call("ms.drive.download_version", {
        ...withConnection(m),
        ...driveOf(m),
        itemId: a.remoteId,
        versionId: a.revisionId,
      }),
    );
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0 };
  },
  async createFolder(ctx, m, a) {
    const res = obj(
      await ctx.call("ms.drive.create_folder", {
        ...withConnection(m),
        ...driveOf(m),
        parentId: a.parentRemote,
        name: a.name,
        idempotencyKey: a.key,
      }),
    );
    return { remoteId: text(obj(res["item"])["id"]) ?? "" };
  },
  /** Graph's delete puts the item in the recycle bin, where its owner can restore it. */
  async remove(ctx, m, remoteId, _isFolder, key) {
    await ctx.call("ms.drive.delete_item", {
      ...withConnection(m),
      ...driveOf(m),
      itemId: remoteId,
      idempotencyKey: key,
    });
  },
  async update(ctx, m, a) {
    const res = obj(
      await ctx.call("ms.drive.update_item", {
        ...withConnection(m),
        ...driveOf(m),
        itemId: a.remoteId,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.addParent !== undefined ? { parentId: a.addParent } : {}),
        ...(a.ifMatch?.revision !== undefined ? { ifMatch: a.ifMatch.revision } : {}),
        idempotencyKey: a.key,
      }),
    );
    const it = graphItem(obj(res["item"]));
    return {
      remoteId: it?.id ?? a.remoteId,
      ...(it?.version !== undefined ? { version: it.version } : {}),
      ...(it?.revision !== undefined ? { revision: it.revision } : {}),
      ...(res["stale"] === true ? { stale: true, ...(it?.editor !== undefined ? { editor: it.editor } : {}) } : {}),
    };
  },
  async restore(ctx, m, remoteId, key) {
    const res = obj(
      await ctx.call("ms.drive.restore_item", {
        ...withConnection(m),
        ...driveOf(m),
        itemId: remoteId,
        idempotencyKey: key,
      }),
    );
    return { remoteId: graphItem(obj(res["item"]))?.id ?? remoteId };
  },
  /** `parent` is "<driveId>" for a drive's top or "<driveId>:<itemId>" inside it; no parent lists the caller's own OneDrive. */
  async browse(ctx, input) {
    const [driveId, folderId] = (input.parent ?? "").split(":", 2);
    const res = obj(
      await ctx.call("ms.drive.list_items", {
        ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
        ...(driveId ? { driveId } : {}),
        ...(folderId ? { folderId } : {}),
        ...(input.cursor !== undefined ? { skipToken: input.cursor } : {}),
      }),
    );
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
    const res = obj(
      await ctx.call("github.repos.list", {
        ...(input.q !== undefined ? { query: input.q } : {}),
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      }),
    );
    const items: BrowseItem[] = [];
    for (const r of list(res["repos"])) {
      const repo = obj(r);
      const name = text(repo["repo"]);
      if (name !== undefined)
        items.push({
          ref: name,
          name,
          isFolder: true,
          path: text(repo["url"]) ?? `https://github.com/${name}`,
          shared: repo["private"] === true ? false : true,
        });
    }
    const next = text(res["next"]);
    return { items, ...(next !== undefined ? { next } : {}) };
  },
};

export function providerOf(kind: MountKind): Provider {
  switch (kind) {
    case "google_drive":
      return google;
    case "sharepoint":
      return graph;
    case "onedrive":
      return { ...graph, label: "OneDrive" };
    case "dropbox":
      return dropbox;
    case "local":
      return local;
    case "github":
      return github;
  }
}

export const PROVIDER_LABEL: Record<MountKind, string> = {
  google_drive: "Google Drive",
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
  local: "Local folder",
  github: "GitHub",
};

export const isCloud = (kind: MountKind): boolean =>
  kind === "google_drive" || kind === "sharepoint" || kind === "onedrive" || kind === "dropbox";
