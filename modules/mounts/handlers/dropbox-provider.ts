// The Dropbox mount provider (spec 2.16 Mounts; live folders L3). Dropbox goes through the dropbox module's capabilities, which carry the connection; nothing here talks to the Dropbox API.
// A mount's `ref` is the mounted folder: "/" for the whole account, or a folder id ("id:...") or path. The mount's items are Dropbox ids, their version is the revision, and the cursor is Dropbox's own
// list_folder cursor, so every pass after the first reads only what changed (and a cursor Dropbox no longer knows falls back to one full read).
// Dropbox names an item's parent only by path. A batch of changes names the folders it holds, and any other parent is asked for once per pass.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { BrowseItem, Downloaded, MountRec, PullBatch, Provider, RemoteItem, Revision, Uploaded } from "./providers.ts";

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Most pages one pass reads, so a runaway feed cannot hold the pass forever. */
const PAGES = 200;
const ROOT = "/";

const rootOf = (m: { ref?: string }): string => m.ref ?? ROOT;
const connection = (m: { connectionId?: string }): Row => (m.connectionId !== undefined ? { connectionId: m.connectionId } : {});

const stamp = (v: unknown): number | undefined => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : undefined;
};

/** A listed entry as a mount item. Dropbox's revision is both what changes with the content and what a write is conditional on. */
function itemOf(e: Row, parentId: string | undefined): RemoteItem | undefined {
  const id = text(e["id"]);
  if (id === undefined) return undefined;
  const size = whole(e["size"]);
  const rev = text(e["rev"]);
  const at = stamp(e["modified"]);
  return {
    id, name: text(e["name"]) ?? id, ...(parentId !== undefined ? { parentId } : {}), isFolder: e["isFolder"] === true,
    ...(size !== undefined ? { size } : {}), ...(rev !== undefined ? { version: rev, revision: rev } : {}), ...(at !== undefined ? { modifiedAt: at } : {}),
  };
}

const parentPathOf = (pathLower: string): string => pathLower.slice(0, Math.max(0, pathLower.lastIndexOf("/")));

const resetCursor = (e: unknown): boolean => {
  const err = obj(obj(e)["error"]);
  return err["code"] === "validation.precondition_failed" && obj(err["details"])["reason"] === "cursor_reset";
};

async function metadata(ctx: Ctx, m: MountRec, path: string): Promise<Row> {
  return obj(obj(await ctx.call("dropbox.files.get_metadata", { ...connection(m), path }))["entry"]);
}

/** The display path of a folder named by its mount id: "" for the account root. */
async function pathOfFolder(ctx: Ctx, m: MountRec, remoteId: string): Promise<string> {
  if (remoteId === ROOT) return "";
  return text((await metadata(ctx, m, remoteId))["path"]) ?? "";
}

/** One recursive read of the mounted folder (a full listing), or the changes since the stored cursor. */
async function read(ctx: Ctx, m: MountRec, cursor: string | undefined): Promise<{ entries: Row[]; cursor?: string }> {
  const entries: Row[] = [];
  let last: string | undefined;
  let next: string | undefined = cursor;
  for (let pages = 0; pages < PAGES; pages++) {
    const res: Row = obj(await ctx.call("dropbox.files.list_folder", {
      ...connection(m),
      ...(next !== undefined ? { cursor: next } : { path: rootOf(m) === ROOT ? "" : rootOf(m), recursive: true, limit: 2000 }),
    }));
    for (const e of list(res["entries"])) entries.push(obj(e));
    last = text(res["cursor"]) ?? last;
    if (res["hasMore"] !== true) break;
    next = text(res["cursor"]);
    if (next === undefined) break;
  }
  return { entries, ...(last !== undefined ? { cursor: last } : {}) };
}

async function pull(ctx: Ctx, m: MountRec): Promise<PullBatch> {
  const root = rootOf(m);
  // The mounted folder's own path, so a direct child can say its parent is the mount's root.
  const rootPath = root === ROOT ? "" : text((await metadata(ctx, m, root))["pathLower"]) ?? "";
  let got: { entries: Row[]; cursor?: string };
  let full = m.cursor === undefined;
  if (m.cursor !== undefined) {
    try { got = await read(ctx, m, m.cursor); } catch (e) {
      if (!resetCursor(e)) throw e;
      got = await read(ctx, m, undefined);
      full = true;
    }
  } else got = await read(ctx, m, undefined);

  // ids of the folders this batch names, by path
  const idAt = new Map<string, string>();
  for (const e of got.entries) if (e["isFolder"] === true && e["deleted"] !== true && text(e["id"]) && text(e["pathLower"])) idAt.set(text(e["pathLower"]) as string, text(e["id"]) as string);
  const parentOf = async (pathLower: string): Promise<string | undefined> => {
    const up = parentPathOf(pathLower);
    if (up === rootPath) return root;
    const known = idAt.get(up);
    if (known !== undefined) return known;
    try {
      const id = text((await metadata(ctx, m, up))["id"]);
      if (id !== undefined) idAt.set(up, id);
      return id;
    } catch { return undefined; }
  };

  const items: RemoteItem[] = [];
  const removed: string[] = [];
  for (const e of got.entries) {
    const id = text(e["id"]);
    if (e["deleted"] === true) { if (id !== undefined) removed.push(id); continue; }
    const pathLower = text(e["pathLower"]);
    // the mounted folder itself comes back in a listing of its own path only as a child list, never as an entry; an entry outside it is not ours
    if (id === undefined || pathLower === undefined || (rootPath !== "" && !pathLower.startsWith(`${rootPath}/`))) continue;
    const it = itemOf(e, await parentOf(pathLower));
    if (it) items.push(it);
  }
  return { items, removed, full, ...(got.cursor !== undefined ? { cursor: got.cursor } : {}) };
}

export const dropbox: Provider = {
  label: "Dropbox",
  pushes: true,
  pull,
  async download(ctx, m, item): Promise<Downloaded> {
    const res = obj(await ctx.call("dropbox.files.download", { ...connection(m), path: item.remoteId }));
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0, ...(text(res["mime"]) !== undefined ? { mime: text(res["mime"]) as string } : {}) };
  },
  async upload(ctx, m, a): Promise<Uploaded> {
    // An existing file is replaced on the revision the write was based on; a file that moved on since is left as it is and the answer says so (the engine keeps both).
    let path: string;
    let rev = a.ifMatch?.revision;
    if (a.remoteId !== undefined) {
      const there = await metadata(ctx, m, a.remoteId);
      path = text(there["path"]) ?? "";
      rev ??= text(there["rev"]);
    } else path = `${await pathOfFolder(ctx, m, a.parentRemote)}/${a.name}`;
    try {
      const res = obj(await ctx.call("dropbox.files.upload", { ...connection(m), fileId: a.fileId, path, ...(rev !== undefined ? { rev } : {}) }));
      const entry = obj(res["entry"]);
      const now = text(entry["rev"]);
      return { remoteId: text(entry["id"]) ?? a.remoteId ?? "", ...(now !== undefined ? { version: now, revision: now } : {}) };
    } catch (e) {
      if (a.remoteId !== undefined && obj(obj(e)["error"])["code"] === "validation.version_conflict") return { remoteId: a.remoteId, stale: true };
      throw e;
    }
  },
  hookPath: "/hooks/dropbox",
  async stat(ctx, m, remoteId): Promise<RemoteItem | undefined> {
    try { return itemOf(await metadata(ctx, m, remoteId), undefined); } catch (e) {
      if (obj(obj(e)["error"])["code"] === "validation.not_found") return undefined;
      throw e;
    }
  },
  /**
   * Dropbox has one webhook address per app, set in its console, not a channel per folder. So a mount is "watched" when the app can verify notices (it holds an app secret), and the channel is the
   * Dropbox account: a notice names accounts, and mounts.nudge wakes every mount whose channel is that account. The channel never expires.
   */
  async watch(ctx, m): Promise<{ id: string; expiresAt: number } | undefined> {
    const status = obj(await ctx.call("dropbox.app.status", {}));
    if (status["webhooks"] !== true) return undefined;
    const accounts = list(obj(await ctx.call("dropbox.account.list", {}))["connections"]).map(obj);
    const mine = accounts.find((a) => a["connectionId"] === m.connectionId);
    const accountId = mine === undefined ? undefined : text(mine["accountId"]);
    return accountId === undefined ? undefined : { id: `dbx:${accountId}`, expiresAt: 0 };
  },
  async unwatch(): Promise<void> {
    // nothing is held at Dropbox for one mount
  },
  async revisions(ctx, m, remoteId): Promise<Revision[]> {
    const res = obj(await ctx.call("dropbox.files.list_revisions", { ...connection(m), path: remoteId, limit: 50 }));
    return list(res["revisions"]).map((r) => {
      const o = obj(r);
      const at = stamp(o["modified"]);
      const size = whole(o["size"]);
      return { id: text(o["rev"]) ?? "", ...(at !== undefined ? { at } : {}), ...(size !== undefined ? { size } : {}) };
    }).filter((r) => r.id !== "");
  },
  async revisionBlob(ctx, m, a): Promise<Downloaded> {
    const res = obj(await ctx.call("dropbox.files.download", { ...connection(m), path: a.remoteId, rev: a.revisionId }));
    return { blobId: text(res["blobId"]) ?? "", size: whole(res["size"]) ?? 0, ...(text(res["mime"]) !== undefined ? { mime: text(res["mime"]) as string } : {}) };
  },
  async createFolder(ctx, m, a): Promise<Uploaded> {
    const res = obj(await ctx.call("dropbox.files.create_folder", { ...connection(m), path: `${await pathOfFolder(ctx, m, a.parentRemote)}/${a.name}` }));
    return { remoteId: text(obj(res["entry"])["id"]) ?? "" };
  },
  async remove(ctx, m, remoteId): Promise<void> {
    await ctx.call("dropbox.files.delete", { ...connection(m), path: remoteId });
  },
  /** `parent` is a folder id or path; none lists the top of the account, after a first row that mounts the whole account. */
  async browse(ctx, input) {
    const res = obj(await ctx.call("dropbox.files.list_folder", {
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : { path: input.parent ?? "", ...(input.limit !== undefined ? { limit: input.limit } : {}) }),
    }));
    const q = input.q?.toLowerCase();
    const items: BrowseItem[] = [];
    if (input.parent === undefined && input.cursor === undefined && q === undefined) items.push({ ref: ROOT, name: "All of Dropbox", isFolder: true });
    for (const raw of list(res["entries"])) {
      const e = obj(raw);
      const id = text(e["id"]);
      const name = text(e["name"]);
      if (id === undefined || name === undefined || e["deleted"] === true || (q !== undefined && !name.toLowerCase().includes(q))) continue;
      items.push({ ref: id, name, isFolder: e["isFolder"] === true, ...(text(e["path"]) !== undefined ? { path: text(e["path"]) as string } : {}) });
    }
    const next = res["hasMore"] === true ? text(res["cursor"]) : undefined;
    return { items, ...(next !== undefined ? { next } : {}) };
  },
};
