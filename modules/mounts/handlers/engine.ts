// The mount engine (spec 2.16 Mounts, 2.18; ARCH 7.5): mounts.add/update/remove/pause/resume, the sync pass behind mounts.sync_now and the first sync of mounts.add, mounts.local_report for devices,
// the browse/list/get reads and the lag health. A mount is a folder of the files module whose items come from a provider (providers.ts). The module keeps two tables: mounts_mount and mounts_item,
// which remembers the provider item (or device path) behind every mapped file and folder.
//
// A pass pulls the provider's batch (a full listing, or the change feed since the stored cursor) and applies it to the files module through its capabilities, then pushes what changed in Vyre.
//   pull   new item: create (download first); changed item: write a new version; renamed or moved: rename or move; removed: to Trash. A name already taken by a Vyre file keeps both (the new one gets the
//          provider's name in brackets). An item changed on both sides is not overwritten: it is flagged as a conflict and both copies stay until the provider copy is the only change again.
//   push   items the projections marked dirty go out through the provider (folders first, then files, then deletes). A write held for approval stays queued and counts as waiting.
// Review changes defaults on for git and cloud mounts (setting files.review_changes): the folder flag is set on the new folder, and an agent's writes are staged by the files module as for any folder.
// Google-native documents are kept as export snapshots and never uploaded back (edits go through the Google API).
//
// Live Folders: a cloud mount defaults to live_only. The pass keeps the tree and the metadata (name, revision, last editor) from the provider and creates a file as an empty placeholder; the content is fetched
// when the file is opened (mounts.open) and cached by the provider's version, so a file is downloaded again only when it changed there. A server_copy mount fetches content in every pass as before.
// Push: after a pass the mount keeps a watch channel open at the provider (Drive changes.watch, a Graph drive subscription) when the Space has a public address (setting mounts.public_address). A notice
// reaches mounts.nudge, which runs a pass. Without an address a mount polls: every 30 s while an app showing it said so in the last two minutes (mounts.nudge from the client), else every 5 min.
// Writes are conditional: an upload names the version it was based on. If the file moved on, nothing is overwritten: the Vyre edit is uploaded as "<name> (<who>'s edit)", the item is flagged as a conflict
// until the next pull brings the provider's copy in, and mount.conflict is emitted. Every upload is noted (mounts_revision) with who made the edit, so mounts.history can name an agent where the provider only knows the account.
//
// Lag: stale_since is when the oldest unsynced change was first seen. A pass that leaves nothing waiting clears it, a failed pass starts it. The lag health reads it for every live mount.

import { mintUuid } from "../../../lib/ids.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { pushMoves } from "./outbound-moves.ts";
import { PROVIDER_LABEL, isCloud, providerOf } from "./providers.ts";
import type { IfMatch, MountKind, MountMode, MountRec, Person, Provider, PullBatch, RemoteItem, Revision } from "./providers.ts";

type Row = Record<string, unknown>;

/** How often a mount syncs on its own. */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** A local mount whose device has not reported for this long reads as device_offline. */
export const DEVICE_OFFLINE_MS = 15 * 60 * 1000;
/** While an app shows a mount that has no push channel, it is polled this often. */
export const LIVE_POLL_MS = 30 * 1000;
/** An app that said it shows a mount counts as watching for this long. */
export const CLIENT_FRESH_MS = 2 * 60 * 1000;
/** A push channel is replaced when it would expire before the next two passes. */
const WATCH_MARGIN_MS = 2 * SYNC_INTERVAL_MS;
/** Lag (seconds) where the health turns degraded and down. */
export const LAG_DEGRADED_S = 5 * 60;
export const LAG_DOWN_S = 60 * 60;

// ---- errors and input helpers -------------------------------------------------------------------------------

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

const codeOf = (e: unknown): string | undefined => (e instanceof VyreErr ? e.error.code : undefined);
const messageOf = (e: unknown): string => (e instanceof VyreErr ? e.error.message : e instanceof Error ? e.message : "The sync failed.");

function record(ctx: Ctx, input: unknown): Row {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Row;
}

function obj(v: unknown): Row {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function reqStr(ctx: Ctx, o: Row, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", `${key} is required.`);
  return v;
}

function optStr(o: Row, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const flag = (v: unknown): boolean => v === 1 || v === true;
const isNull = (v: unknown): boolean => v === null || v === undefined;

function nid(ctx: Ctx, prefix: string): string {
  return `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
}

// ---- one pass at a time per mount ---------------------------------------------------------------------------

const locks = new Map<string, Promise<unknown>>();

async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await next;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

// ---- rows ---------------------------------------------------------------------------------------------------

function mountRow(ctx: Ctx, mountId: string): Row {
  const row = (ctx.db.all("SELECT * FROM mounts_mount WHERE id = ?", mountId) as Row[])[0];
  if (!row || !isNull(row["deleted_at"])) return fail(ctx, "validation.not_found", "That mount does not exist.");
  return row;
}

function liveMounts(ctx: Ctx): Row[] {
  return (ctx.db.all("SELECT * FROM mounts_mount WHERE deleted_at IS NULL") as Row[]).sort((a, b) => num(a["created_at"]) - num(b["created_at"]) || str(a["id"]).localeCompare(str(b["id"])));
}

function patchMount(ctx: Ctx, row: Row, patch: Row): void {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  ctx.db.run(`UPDATE mounts_mount SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, ...cols.map((c) => patch[c]), row["id"]);
  Object.assign(row, patch);
}

function itemsOf(ctx: Ctx, mountId: string): Row[] {
  return ctx.db.all("SELECT * FROM mounts_item WHERE mount_id = ?", mountId) as Row[];
}

function patchItem(ctx: Ctx, row: Row, patch: Row): void {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  ctx.db.run(`UPDATE mounts_item SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE mount_id = ? AND item_key = ?`, ...cols.map((c) => patch[c]), row["mount_id"], row["item_key"]);
  Object.assign(row, patch);
}

interface NewItem {
  key?: string;
  remoteId: string | null;
  parentKey: string | null;
  fileId?: string;
  folderId?: string;
  name: string;
  isFolder: boolean;
  native?: boolean;
  remoteVersion?: string | null;
  version?: number | null;
  dirty?: boolean;
  /** the remote version the content in Vyre was fetched at (null: a placeholder) */
  cachedVersion?: string | null;
  meta?: RemoteMeta;
}

/** What the provider says about an item besides its content: the revision a write is conditional on, and who last edited it. */
interface RemoteMeta { remote_rev: string | null; editor_name: string | null; editor_email: string | null; modified_at: number | null }

const metaOf = (item: RemoteItem): RemoteMeta => ({
  remote_rev: item.revision ?? null, editor_name: item.editor?.name ?? null, editor_email: item.editor?.email ?? null, modified_at: item.modifiedAt ?? null,
});

function insertItem(ctx: Ctx, mountId: string, n: NewItem): Row {
  const row: Row = {
    mount_id: mountId,
    item_key: n.key ?? nid(ctx, "itm"),
    remote_id: n.remoteId,
    parent_key: n.parentKey,
    file_id: n.fileId ?? null,
    folder_id: n.folderId ?? null,
    name: n.name,
    is_folder: n.isFolder ? 1 : 0,
    native: n.native ? 1 : 0,
    remote_version: n.remoteVersion ?? null,
    cached_version: n.cachedVersion ?? null,
    ...(n.meta ?? { remote_rev: null, editor_name: null, editor_email: null, modified_at: null }),
    dirty_by: null,
    synced_version: n.version ?? null,
    local_version: n.version ?? null,
    dirty: n.dirty ? 1 : 0,
    deleted: 0,
    conflict: 0,
  };
  // the host may have seen the file or folder appear before this row was written and queued it as a new local item: this row replaces that echo
  if (n.fileId) ctx.db.run("DELETE FROM mounts_item WHERE mount_id = ? AND file_id = ? AND remote_id IS NULL", mountId, n.fileId);
  if (n.folderId) ctx.db.run("DELETE FROM mounts_item WHERE mount_id = ? AND folder_id = ? AND remote_id IS NULL", mountId, n.folderId);
  const cols = Object.keys(row);
  ctx.db.run(`INSERT INTO mounts_item (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => row[c]));
  return row;
}

/** The item and everything below it (children by parent_key). */
function subtreeOf(rows: readonly Row[], top: Row): Row[] {
  const out: Row[] = [top];
  for (let i = 0; i < out.length; i++) {
    const at = out[i];
    if (!at) break;
    for (const r of rows) if (r["parent_key"] === at["item_key"] && !out.includes(r)) out.push(r);
  }
  return out;
}

function dropItems(ctx: Ctx, rows: Row[], gone: readonly Row[]): void {
  for (const g of gone) {
    ctx.db.run("DELETE FROM mounts_item WHERE mount_id = ? AND item_key = ?", g["mount_id"], g["item_key"]);
    const at = rows.indexOf(g);
    if (at >= 0) rows.splice(at, 1);
  }
}

// ---- the files module ---------------------------------------------------------------------------------------

async function filesCreateFolder(ctx: Ctx, parentId: string, name: string, reviewChanges?: boolean): Promise<string> {
  const r = obj(await ctx.call("files.folder.create", { idempotencyKey: `mnt_${mintUuid(ctx.now())}`, parentId, name, ...(reviewChanges !== undefined ? { reviewChanges } : {}) }));
  return str(obj(r["folder"])["folderId"]);
}

/** `blobId` undefined makes an empty placeholder (a live file that has not been opened). */
async function filesCreate(ctx: Ctx, folderId: string, name: string, blobId: string | undefined, mime?: string, kind?: string): Promise<{ fileId: string; version: number }> {
  const r = obj(await ctx.call("files.create", { idempotencyKey: `mnt_${mintUuid(ctx.now())}`, folderId, name, ...(blobId !== undefined ? { content: { blobId } } : {}), ...(mime !== undefined ? { mime } : {}), ...(kind !== undefined ? { kind } : {}) }));
  const file = obj(r["file"]);
  return { fileId: str(file["fileId"]), version: num(file["version"]) };
}

async function filesWrite(ctx: Ctx, fileId: string, blobId: string, reason: string, baseVersion?: number): Promise<number> {
  const r = obj(await ctx.call("files.write", { fileId, content: { blobId }, reason, ...(baseVersion !== undefined && baseVersion > 0 ? { baseVersion } : {}) }));
  return num(obj(r["file"])["version"]);
}

/** Runs `make` with the name; a name already taken in the folder retries once with the provider's name in brackets. */
async function withFreeName<T>(name: string, label: string, make: (n: string) => Promise<T>): Promise<{ value: T; renamed: boolean }> {
  try {
    return { value: await make(name), renamed: false };
  } catch (e) {
    if (codeOf(e) !== "validation.duplicate") throw e;
    const dot = name.lastIndexOf(".");
    const taken = dot > 0 ? `${name.slice(0, dot)} (${label})${name.slice(dot)}` : `${name} (${label})`;
    return { value: await make(taken), renamed: true };
  }
}

/** A delete of something that is already gone is not an error. */
async function quietly(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (codeOf(e) !== "validation.not_found") throw e;
  }
}

async function trashLocal(ctx: Ctx, rows: Row[], top: Row): Promise<void> {
  const below = subtreeOf(rows, top);
  if (flag(top["is_folder"]) && !isNull(top["folder_id"])) await quietly(() => ctx.call("files.folder.delete", { folderId: str(top["folder_id"]) }));
  else if (!isNull(top["file_id"])) await quietly(() => ctx.call("files.delete", { fileId: str(top["file_id"]) }));
  dropItems(ctx, rows, below);
}

/** A cloud mount whose content is fetched when a file is opened. */
const isLive = (m: Pick<MountRec, "kind" | "mode">): boolean => m.mode === "live_only" && isCloud(m.kind);

// ---- applying a pulled batch --------------------------------------------------------------------------------

interface Applied { pulled: number; conflicts: number }

async function applyBatch(ctx: Ctx, m: MountRec, provider: Provider, batch: PullBatch, rows: Row[]): Promise<Applied> {
  let pulled = 0;
  let conflicts = 0;
  const label = provider.label;
  const live = isLive(m);
  const root = rows.find((r) => isNull(r["parent_key"]));
  if (!root) return fail(ctx, "internal.unexpected", "The mount lost its root.");
  if (batch.rootId !== undefined && isNull(root["remote_id"])) patchItem(ctx, root, { remote_id: batch.rootId });
  const byRemote = (): Map<string, Row> => new Map(rows.filter((r) => !isNull(r["remote_id"])).map((r) => [str(r["remote_id"]), r]));
  const index = byRemote();

  const gone = new Set(batch.removed);
  if (batch.full) {
    const seen = new Set(batch.items.map((i) => i.id));
    for (const r of rows) if (r !== root && !isNull(r["remote_id"]) && !seen.has(str(r["remote_id"]))) gone.add(str(r["remote_id"]));
  }

  const applyItem = async (item: RemoteItem, parent: Row): Promise<void> => {
    const row = index.get(item.id);
    const parentFolder = str(parent["folder_id"]);
    if (item.isFolder) {
      if (!row) {
        const made = await withFreeName(item.name, label, (n) => filesCreateFolder(ctx, parentFolder, n));
        if (made.renamed) conflicts += 1;
        const created = insertItem(ctx, m.id, { remoteId: item.id, parentKey: str(parent["item_key"]), folderId: made.value, name: item.name, isFolder: true });
        rows.push(created);
        index.set(item.id, created);
        pulled += 1;
        return;
      }
      if (row["name"] !== item.name) {
        await ctx.call("files.folder.rename", { folderId: str(row["folder_id"]), name: item.name });
        patchItem(ctx, row, { name: item.name });
        pulled += 1;
      }
      if (row["parent_key"] !== parent["item_key"]) {
        await ctx.call("files.folder.move", { folderId: str(row["folder_id"]), toParentId: parentFolder });
        patchItem(ctx, row, { parent_key: parent["item_key"] });
        pulled += 1;
      }
      return;
    }
    if (!provider.download) return;
    if (!row) {
      // a live mount creates the file empty: the content is fetched when it is opened
      const dl = live ? undefined : await provider.download(ctx, m, { remoteId: item.id, name: item.name, ...(item.mime !== undefined ? { mime: item.mime } : {}), ...(item.native ? { native: true } : {}) });
      const mime = dl ? dl.mime ?? (item.native ? undefined : item.mime) : item.native ? undefined : item.mime;
      const made = await withFreeName(item.name, label, (n) => filesCreate(ctx, parentFolder, n, dl?.blobId, mime, item.native ? "google_native" : undefined));
      if (made.renamed) conflicts += 1;
      const created = insertItem(ctx, m.id, {
        remoteId: item.id, parentKey: str(parent["item_key"]), fileId: made.value.fileId, name: item.name, isFolder: false, native: item.native === true,
        remoteVersion: item.version ?? null, cachedVersion: dl ? item.version ?? null : null, version: made.value.version, meta: metaOf(item),
      });
      rows.push(created);
      index.set(item.id, created);
      pulled += 1;
      return;
    }
    if (row["name"] !== item.name) {
      await ctx.call("files.rename", { fileId: str(row["file_id"]), name: item.name });
      patchItem(ctx, row, { name: item.name });
      pulled += 1;
    }
    if (row["parent_key"] !== parent["item_key"]) {
      await ctx.call("files.move", { fileId: str(row["file_id"]), toFolderId: parentFolder });
      patchItem(ctx, row, { parent_key: parent["item_key"] });
      pulled += 1;
    }
    if (item.version !== undefined && item.version !== row["remote_version"]) {
      if (flag(row["dirty"]) && !flag(row["native"])) {
        // changed on both sides: neither copy is overwritten
        if (!flag(row["conflict"])) {
          patchItem(ctx, row, { conflict: 1 });
          conflicts += 1;
        }
        return;
      }
      if (live) {
        // the copy in Vyre is now stale; it is fetched again the next time the file is opened
        patchItem(ctx, row, { remote_version: item.version, ...metaOf(item) });
        pulled += 1;
        return;
      }
      const dl = await provider.download(ctx, m, { remoteId: item.id, name: item.name, ...(item.mime !== undefined ? { mime: item.mime } : {}), ...(item.native ? { native: true } : {}) });
      const version = await filesWrite(ctx, str(row["file_id"]), dl.blobId, `Synced from ${label}`);
      patchItem(ctx, row, { remote_version: item.version, cached_version: item.version, ...metaOf(item), synced_version: version, local_version: version, dirty: 0, conflict: 0 });
      pulled += 1;
    } else if (isNull(row["remote_rev"]) && item.revision !== undefined) {
      patchItem(ctx, row, metaOf(item));
    }
  };

  // items whose parent is not mapped yet wait for it (a feed lists children and parents in any order)
  let queue = batch.items.filter((i) => !gone.has(i.id) && i.id !== str(root["remote_id"]));
  for (let progress = true; queue.length > 0 && progress;) {
    progress = false;
    const later: RemoteItem[] = [];
    for (const item of queue) {
      const parent = item.parentId !== undefined ? index.get(item.parentId) : undefined;
      if (!parent || !flag(parent["is_folder"]) || flag(parent["deleted"])) {
        later.push(item);
        continue;
      }
      await applyItem(item, parent);
      progress = true;
    }
    queue = later;
  }
  // what is left sits outside the mounted folder; if it was mapped, it moved out
  for (const item of queue) if (index.has(item.id)) gone.add(item.id);

  for (const remoteId of gone) {
    const row = index.get(remoteId);
    if (!row || row === root) continue;
    if (flag(row["dirty"]) && !flag(row["deleted"]) && !flag(row["is_folder"])) {
      // edited in Vyre and not sent yet: keep the file and send it again as a new item
      patchItem(ctx, row, { remote_id: null, remote_version: null, conflict: 0 });
      continue;
    }
    if (flag(row["deleted"])) {
      dropItems(ctx, rows, subtreeOf(rows, row));
      continue;
    }
    await trashLocal(ctx, rows, row);
    pulled += 1;
  }
  return { pulled, conflicts };
}

// ---- pushing what changed in Vyre ---------------------------------------------------------------------------

interface Pushed { pushed: number; held: number; errors: string[]; kept: number }

/** The name a Vyre edit is kept under when the file moved on at the provider: "Report (Noah's edit).docx". */
function copyName(name: string, who: string): string {
  const dot = name.lastIndexOf(".");
  const tag = ` (${who}'s edit)`;
  return dot > 0 ? `${name.slice(0, dot)}${tag}${name.slice(dot)}` : `${name}${tag}`;
}

/** Who made the edit, for a name: the mount's account (the person who made it) as a first name. */
function whoLabel(m: MountRec): string {
  const local = (m.account ?? "").split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? "";
  return first.length > 0 ? `${first.charAt(0).toUpperCase()}${first.slice(1)}` : "Vyre";
}

const depthOf = (rows: readonly Row[], row: Row): number => {
  let d = 0;
  for (let at: Row | undefined = row; at && !isNull(at["parent_key"]) && d < 64; d++) at = rows.find((r) => r["item_key"] === at?.["parent_key"]);
  return d;
};

async function pushAll(ctx: Ctx, m: MountRec, provider: Provider, rows: Row[]): Promise<Pushed> {
  const res: Pushed = { pushed: 0, held: 0, errors: [], kept: 0 };
  if (!provider.pushes || m.pullOnly) return res;
  const settle = (e: unknown): void => {
    if (codeOf(e) === "permission.needs_approval") res.held += 1;
    else res.errors.push(messageOf(e));
  };
  const parentRemote = (row: Row): string | undefined => {
    const parent = rows.find((r) => r["item_key"] === row["parent_key"]);
    return parent && !isNull(parent["remote_id"]) ? str(parent["remote_id"]) : undefined;
  };

  // renames and moves made in Vyre go out first, so a folder is where it should be before anything new is sent into it
  const mv = await pushMoves(ctx, m, provider, rows, (row, fields) => patchItem(ctx, row, fields));
  res.pushed += mv.moved;
  res.held += mv.held;
  res.errors.push(...mv.errors);

  // new folders, parents first
  const folders = rows.filter((r) => flag(r["dirty"]) && flag(r["is_folder"]) && !flag(r["deleted"]) && isNull(r["remote_id"])).sort((a, b) => depthOf(rows, a) - depthOf(rows, b));
  for (const f of folders) {
    const parent = parentRemote(f);
    if (parent === undefined || !provider.createFolder) continue;
    try {
      const made = await provider.createFolder(ctx, m, { name: str(f["name"]), parentRemote: parent });
      patchItem(ctx, f, { remote_id: made.remoteId, dirty: 0 });
      res.pushed += 1;
    } catch (e) {
      settle(e);
    }
  }
  // files: new and changed
  const files = rows.filter((r) => flag(r["dirty"]) && !flag(r["is_folder"]) && !flag(r["deleted"]) && !flag(r["conflict"]) && !flag(r["native"]) && !isNull(r["file_id"]));
  for (const f of files) {
    const parent = parentRemote(f);
    if (parent === undefined || !provider.upload) continue;
    try {
      const remoteId = isNull(f["remote_id"]) ? undefined : str(f["remote_id"]);
      // a change to a file that already exists there is sent with the version it was based on
      const based: IfMatch = { ...(isNull(f["remote_version"]) ? {} : { version: str(f["remote_version"]) }), ...(isNull(f["remote_rev"]) ? {} : { revision: str(f["remote_rev"]) }) };
      const up = await provider.upload(ctx, m, { fileId: str(f["file_id"]), name: str(f["name"]), parentRemote: parent, ...(remoteId !== undefined ? { remoteId } : {}), ...(remoteId !== undefined && based.revision !== undefined ? { ifMatch: based } : {}) });
      if (up.stale) {
        // the file changed there since the last pull: keep both, never overwrite
        const kept = copyName(str(f["name"]), whoLabel(m));
        await provider.upload(ctx, m, { fileId: str(f["file_id"]), name: kept, parentRemote: parent });
        patchItem(ctx, f, { dirty: 0, conflict: 1, synced_version: f["local_version"] ?? null, dirty_by: null });
        ctx.emit("mount.conflict", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, fileId: str(f["file_id"]), name: str(f["name"]), keptAs: kept });
        res.kept += 1;
        continue;
      }
      const by = isNull(f["dirty_by"]) ? ctx.principal.id : str(f["dirty_by"]);
      patchItem(ctx, f, {
        remote_id: up.remoteId, remote_version: up.version ?? f["remote_version"] ?? null, cached_version: up.version ?? f["remote_version"] ?? null, remote_rev: up.revision ?? f["remote_rev"] ?? null,
        ...(up.editor !== undefined ? { editor_name: up.editor.name ?? null, editor_email: up.editor.email ?? null } : {}),
        synced_version: f["local_version"] ?? null, dirty: 0, dirty_by: null,
      });
      if (up.revision !== undefined) {
        ctx.db.run("DELETE FROM mounts_revision WHERE mount_id = ? AND remote_id = ? AND revision_id = ?", m.id, up.remoteId, up.revision);
        ctx.db.run("INSERT INTO mounts_revision (mount_id, remote_id, revision_id, by_actor, at) VALUES (?, ?, ?, ?, ?)", m.id, up.remoteId, up.revision, by, ctx.now());
      }
      ctx.emit("mount.file_sent", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, fileId: str(f["file_id"]), name: str(f["name"]), ...(up.revision !== undefined ? { revisionId: up.revision } : {}), by });
      res.pushed += 1;
    } catch (e) {
      settle(e);
    }
  }
  // deletes
  const deletes = rows.filter((r) => flag(r["deleted"]) && !isNull(r["remote_id"]));
  for (const d of deletes) {
    if (!provider.remove) continue;
    try {
      await provider.remove(ctx, m, str(d["remote_id"]), flag(d["is_folder"]));
      dropItems(ctx, rows, subtreeOf(rows, d));
      res.pushed += 1;
    } catch (e) {
      settle(e);
    }
  }
  return res;
}

/** Items waiting to go out (conflicted ones wait for a person, not for the next pass; a Google-native document only waits to be deleted, it is never uploaded). */
function waiting(rows: readonly Row[]): number {
  return rows.filter((r) => flag(r["dirty"]) && !flag(r["conflict"]) && (!flag(r["native"]) || flag(r["deleted"]))).length;
}

// ---- the pass -----------------------------------------------------------------------------------------------

function recOf(row: Row): MountRec {
  const opt = (k: string): string | undefined => (typeof row[k] === "string" && row[k] !== "" ? (row[k] as string) : undefined);
  const connectionId = opt("connection_id");
  const ref = opt("ref");
  const path = opt("path");
  const branch = opt("branch");
  const deviceId = opt("device_id");
  const localPath = opt("local_path");
  const cursor = opt("cursor");
  const account = opt("account");
  return {
    id: str(row["id"]),
    folderId: str(row["folder_id"]),
    kind: str(row["kind"]) as MountKind,
    ...(connectionId !== undefined ? { connectionId } : {}),
    ...(account !== undefined ? { account } : {}),
    ...(ref !== undefined ? { ref } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(deviceId !== undefined ? { deviceId } : {}),
    ...(localPath !== undefined ? { localPath } : {}),
    name: str(row["name"]),
    mode: str(row["mode"]) as MountMode,
    reviewChanges: flag(row["review_changes"]),
    pullOnly: flag(row["pull_only"]),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

interface PassResult { pulled: number; pushed: number; conflicts: number; failed: boolean }

/** How soon the next pass is due: a push channel leaves the 5 minute backstop, a mount an app is showing is polled every 30 s, anything else every 5 minutes. */
function intervalFor(ctx: Ctx, row: Row): number {
  if (hasPush(ctx, row)) return SYNC_INTERVAL_MS;
  return clientNear(ctx, row) ? LIVE_POLL_MS : SYNC_INTERVAL_MS;
}

const hasPush = (ctx: Ctx, row: Row): boolean => !isNull(row["watch_id"]) && (isNull(row["watch_expires"]) || num(row["watch_expires"]) > ctx.now());
const clientNear = (ctx: Ctx, row: Row): boolean => !isNull(row["client_seen_at"]) && ctx.now() - num(row["client_seen_at"]) <= CLIENT_FRESH_MS;

async function scheduleNext(ctx: Ctx, row: Row): Promise<void> {
  const now = ctx.now();
  if (str(row["kind"]) === "local" || row["state"] === "paused") return;
  const at = now + intervalFor(ctx, row);
  // a pass already queued sooner than that stays; one queued later (the app just arrived) is overtaken
  if (!isNull(row["next_sync_at"]) && num(row["next_sync_at"]) > now && num(row["next_sync_at"]) <= at) return;
  try {
    await ctx.schedule(at, "mounts.sync_now", { mountId: str(row["id"]) });
    patchMount(ctx, row, { next_sync_at: at });
  } catch {
    // no scheduler: the next sync is a person's Sync now
  }
}

// ---- push channels ------------------------------------------------------------------------------------------

/** The Space's public address, when it has one: the setting mounts.public_address. Without it a mount cannot be pushed to and is polled. */
async function publicAddress(ctx: Ctx): Promise<string | undefined> {
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "mounts.public_address" }))["row"])["value"];
    return typeof v === "string" && /^https:\/\//.test(v) ? v.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** Keep a push channel open for a cloud mount, replacing one that is about to expire. Never fails a pass: a mount that cannot be pushed to is polled. */
async function ensureWatch(ctx: Ctx, row: Row, m: MountRec, provider: Provider): Promise<void> {
  if (!provider.watch || !isCloud(m.kind) || row["state"] === "paused") return;
  const soon = !isNull(row["watch_expires"]) && num(row["watch_expires"]) - ctx.now() < WATCH_MARGIN_MS;
  if (!isNull(row["watch_id"]) && !soon) return;
  const base = await publicAddress(ctx);
  if (base === undefined || provider.hookPath === undefined) return;
  try {
    const fresh = await provider.watch(ctx, m, { address: `${base}${provider.hookPath}`, channelId: nid(ctx, "chn") });
    if (fresh === undefined) return;
    const old = { id: row["watch_id"], resource: row["watch_resource"] };
    patchMount(ctx, row, { watch_id: fresh.id, watch_resource: fresh.resource ?? null, watch_expires: provider.watchRenewsItself ? null : fresh.expiresAt > 0 ? fresh.expiresAt : null });
    if (!isNull(old.id) && provider.unwatch) await provider.unwatch(ctx, m, { id: str(old.id), ...(isNull(old.resource) ? {} : { resource: str(old.resource) }) }).catch(() => undefined);
  } catch {
    if (soon) patchMount(ctx, row, { watch_id: null, watch_resource: null, watch_expires: null });
  }
}

/** Mounts with a pass already waiting behind the running one: a burst of push notices needs one more pass, not one each. */
const queued = new Set<string>();

async function runPass(ctx: Ctx, mountId: string): Promise<PassResult> {
  return exclusive(`mount:${mountId}`, async () => {
    queued.delete(mountId);
    const row = mountRow(ctx, mountId);
    if (row["state"] === "paused") return fail(ctx, "validation.precondition_failed", "This mount is paused. Resume it first.");
    const m = recOf(row);
    const provider = providerOf(m.kind);
    const started = ctx.now();
    patchMount(ctx, row, { state: "syncing" });
    const rows = itemsOf(ctx, m.id);
    let pulled = 0;
    let conflicts = 0;
    let pushed = 0;
    let held = 0;
    let kept = 0;
    const errors: string[] = [];
    try {
      if (m.kind === "github") {
        const res = obj(await ctx.call("git.pull", { folderId: m.folderId, strategy: "ff_only", ...(m.branch !== undefined ? { branch: m.branch } : {}) }));
        pulled = res["updated"] === true ? 1 : 0;
        conflicts = list(res["conflicts"]).length;
        patchMount(ctx, row, { conflicts });
      } else if (provider.pull) {
        const batch = await provider.pull(ctx, m);
        const applied = await applyBatch(ctx, m, provider, batch, rows);
        pulled = applied.pulled;
        conflicts = applied.conflicts;
        if (batch.cursor !== undefined) patchMount(ctx, row, { cursor: batch.cursor });
        const sent = await pushAll(ctx, m, provider, rows);
        pushed = sent.pushed;
        held = sent.held;
        kept = sent.kept;
        errors.push(...sent.errors);
      }
    } catch (e) {
      errors.push(messageOf(e));
    }
    const now = ctx.now();
    if (errors.length > 0) {
      patchMount(ctx, row, { state: "failing", error: errors[0] ?? "The sync failed.", stale_since: isNull(row["stale_since"]) ? now : row["stale_since"], updated_at: now });
      ctx.emit("mount.failed", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, error: errors[0] ?? "The sync failed." });
      await scheduleNext(ctx, row);
      return { pulled, pushed, conflicts, failed: true };
    }
    const leftover = provider.pushes && !m.pullOnly && (held > 0 || waiting(itemsOf(ctx, m.id)) > 0);
    patchMount(ctx, row, { state: "idle", error: null, last_sync_at: now, stale_since: leftover ? (isNull(row["stale_since"]) ? now : row["stale_since"]) : null, updated_at: now });
    ctx.emit("mount.synced", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, pulled, pushed, conflicts: conflictCount(ctx, row), ms: Math.max(0, now - started) });
    await ensureWatch(ctx, row, recOf(row), provider);
    if (kept > 0) {
      // a Vyre edit was kept as a copy: one more pass brings in the provider's version and the copy
      try { await ctx.schedule(now + 1000, "mounts.sync_now", { mountId: m.id }); } catch { /* the next scheduled pass does it */ }
    }
    await scheduleNext(ctx, row);
    return { pulled, pushed, conflicts, failed: false };
  });
}

function conflictCount(ctx: Ctx, row: Row): number {
  if (str(row["kind"]) === "github") return num(row["conflicts"]);
  return itemsOf(ctx, str(row["id"])).filter((r) => flag(r["conflict"])).length;
}

// ---- views --------------------------------------------------------------------------------------------------

function lagSeconds(ctx: Ctx, row: Row): number {
  if (row["state"] === "paused" || isNull(row["stale_since"])) return 0;
  return Math.max(0, Math.floor((ctx.now() - num(row["stale_since"])) / 1000));
}

function stateOf(ctx: Ctx, row: Row): string {
  if (str(row["kind"]) === "local" && row["state"] !== "paused") {
    const seen = isNull(row["last_sync_at"]) ? num(row["created_at"]) : num(row["last_sync_at"]);
    if (ctx.now() - seen > DEVICE_OFFLINE_MS) return "device_offline";
  }
  return str(row["state"]);
}

function viewOf(ctx: Ctx, row: Row): Row {
  const kind = str(row["kind"]) as MountKind;
  const out: Row = {
    mountId: str(row["id"]),
    folderId: str(row["folder_id"]),
    kind,
    provider: PROVIDER_LABEL[kind],
    name: str(row["name"]),
    state: stateOf(ctx, row),
    mode: str(row["mode"]),
    reviewChanges: flag(row["review_changes"]),
    lagSeconds: lagSeconds(ctx, row),
    pendingChanges: waiting(itemsOf(ctx, str(row["id"]))),
    conflicts: conflictCount(ctx, row),
  };
  if (isCloud(kind)) {
    // the Files strip says "Live" while changes arrive on their own, else "Synced <lastSyncAt>"
    const push = hasPush(ctx, row);
    const idle = row["state"] === "idle" || row["state"] === "syncing";
    out["liveVia"] = push ? "push" : "poll";
    out["live"] = idle && (push || (clientNear(ctx, row) && !isNull(row["last_sync_at"]) && ctx.now() - num(row["last_sync_at"]) <= 2 * LIVE_POLL_MS));
  }
  if (!isNull(row["ref"])) out["ref"] = str(row["ref"]);
  if (!isNull(row["last_sync_at"])) out["lastSyncAt"] = num(row["last_sync_at"]);
  if (!isNull(row["device_id"])) out["fromDevice"] = str(row["device_id"]);
  if (!isNull(row["error"])) out["error"] = str(row["error"]);
  return out;
}

function mayManage(ctx: Ctx, row: Row): void {
  const d = ctx.authorize({ perm: "files.write", level: "manage" }, { type: "folder", id: str(row["folder_id"]) });
  if (d.effect === "deny") fail(ctx, "permission.no_grant", d.reason);
  if (d.effect === "hold") fail(ctx, "permission.needs_approval", d.reason);
}

function maySee(ctx: Ctx, row: Row): boolean {
  return ctx.authorize({ perm: null, level: "view" }, { type: "folder", id: str(row["folder_id"]) }).effect !== "deny";
}

// ---- capabilities -------------------------------------------------------------------------------------------

const KINDS: readonly string[] = ["google_drive", "sharepoint", "onedrive", "local", "github"];
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? p;
}

async function settingFlag(ctx: Ctx, which: "git" | "cloud_mount" | "plain"): Promise<boolean> {
  const fallback = which !== "plain";
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "files.review_changes" }))["row"])["value"];
    const o = obj(v);
    return typeof o[which] === "boolean" ? (o[which] as boolean) : fallback;
  } catch {
    return fallback;
  }
}

async function localDefaultMode(ctx: Ctx): Promise<MountMode> {
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "files.local_mount_default" }))["row"])["value"];
    return v === "live_only" ? "live_only" : "server_copy";
  } catch {
    return "server_copy";
  }
}

interface SourceIn { kind: MountKind; connectionId?: string; ref?: string; path?: string; branch?: string; deviceId?: string; localPath?: string }

function sourceOf(ctx: Ctx, o: Row): SourceIn {
  const s = obj(o["source"]);
  const kind = str(s["kind"]);
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "source.kind must be google_drive, sharepoint, onedrive, local or github.");
  const out: SourceIn = { kind: kind as MountKind };
  for (const k of ["connectionId", "ref", "path", "branch", "deviceId", "localPath"] as const) {
    const v = optStr(s, k);
    if (v !== undefined) out[k] = v;
  }
  const need = (what: string, ok: boolean): void => {
    if (!ok) fail(ctx, "validation.bad_input", `${what} is needed to mount from ${PROVIDER_LABEL[out.kind]}.`);
  };
  if (out.kind === "google_drive") {
    need("A connection", out.connectionId !== undefined);
    need("A Drive folder", out.ref !== undefined);
  } else if (out.kind === "sharepoint") {
    need("A connection", out.connectionId !== undefined);
    need("A library", out.ref !== undefined);
  } else if (out.kind === "onedrive") {
    need("A connection", out.connectionId !== undefined);
  } else if (out.kind === "local") {
    need("A device", out.deviceId !== undefined);
    need("A folder path on the device", out.localPath !== undefined);
  } else if (out.ref === undefined || !REPO.test(out.ref)) {
    fail(ctx, "validation.bad_input", "A GitHub repository is written owner/name.");
  }
  return out;
}

const sameSource = (row: Row, s: SourceIn): boolean =>
  str(row["kind"]) === s.kind && str(row["connection_id"]) === (s.connectionId ?? "") && str(row["ref"]) === (s.ref ?? "") && str(row["path"]) === (s.path ?? "")
  && str(row["device_id"]) === (s.deviceId ?? "") && str(row["local_path"]) === (s.localPath ?? "");

/** The work address a cloud mount will sync as: the one the person making it is matched to. None when the provider is not set up for them; the pass then fails with the provider's own words. */
async function accountOf(ctx: Ctx, kind: MountKind): Promise<string | null> {
  const cap = kind === "google_drive" ? "google.dwd.my_account" : kind === "sharepoint" || kind === "onedrive" ? "ms.consent.my_account" : undefined;
  if (cap === undefined) return null;
  try { return optStr(obj(await ctx.call(cap, {})), "email") ?? null; } catch { return null; }
}

async function mountsAdd(ctx: Ctx, input: unknown): Promise<{ mountId: string; folderId: string; runId: string }> {
  const o = record(ctx, input);
  const into = reqStr(ctx, o, "into");
  const source = sourceOf(ctx, o);
  const modeIn = optStr(o, "mode");
  if (modeIn !== undefined && modeIn !== "server_copy" && modeIn !== "live_only") fail(ctx, "validation.bad_input", "mode must be server_copy or live_only.");
  if (modeIn === "live_only" && source.kind === "github") fail(ctx, "validation.bad_input", "A GitHub repository is always a copy.");
  if (liveMounts(ctx).some((r) => sameSource(r, source))) fail(ctx, "validation.duplicate", "That is already mounted.");
  // a cloud folder is live by default (tree and metadata from the provider, content fetched on open); a synced copy is a choice
  const mode: MountMode = source.kind === "local" ? (modeIn === "live_only" || modeIn === "server_copy" ? modeIn : await localDefaultMode(ctx))
    : isCloud(source.kind) ? (modeIn === "server_copy" ? "server_copy" : "live_only") : "server_copy";
  const reviewIn = o["reviewChanges"];
  const review = typeof reviewIn === "boolean" ? reviewIn : await settingFlag(ctx, source.kind === "github" ? "git" : isCloud(source.kind) ? "cloud_mount" : "plain");
  const repoName = source.ref !== undefined ? baseName(source.ref) : "";
  const name = optStr(o, "name") ?? (source.kind === "local" ? baseName(source.localPath ?? "Folder") : source.kind === "github" ? repoName : PROVIDER_LABEL[source.kind]);

  const folderId = await filesCreateFolder(ctx, into, name, review);
  const now = ctx.now();
  const mountId = nid(ctx, "mnt");
  const fields: Row = {
    id: mountId, folder_id: folderId, kind: source.kind, connection_id: source.connectionId ?? null, ref: source.ref ?? null, path: source.path ?? null, branch: source.branch ?? null,
    device_id: source.deviceId ?? null, local_path: source.localPath ?? null, name, mode, review_changes: review ? 1 : 0, pull_only: 0, state: "idle", cursor: null, owner: ctx.principal.id, account: await accountOf(ctx, source.kind),
    last_sync_at: null, stale_since: null, next_sync_at: null, conflicts: 0, error: null, created_at: now, updated_at: now, deleted_at: null,
  };
  const cols = Object.keys(fields);
  ctx.db.run(`INSERT INTO mounts_mount (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => fields[c]));
  const rootRemote = source.kind === "google_drive" ? source.ref ?? null : source.kind === "sharepoint" || source.kind === "onedrive" ? source.path ?? null : source.kind === "local" ? "" : null;
  insertItem(ctx, mountId, { key: "root", remoteId: rootRemote, parentKey: null, folderId, name, isFolder: true });
  ctx.emit("folder.mounted", `folder/${folderId}`, { mountId, folderId, kind: source.kind, by: ctx.principal.id });
  const runId = ctx.run ?? nid(ctx, "run");

  if (source.kind === "github") {
    try {
      await ctx.call("git.init", { folderId, ...(source.branch !== undefined ? { branch: source.branch } : {}) });
      await ctx.call("git.remote_add", { folderId, name: "origin", url: `https://github.com/${source.ref}.git` });
    } catch (e) {
      const row = mountRow(ctx, mountId);
      patchMount(ctx, row, { state: "failing", error: messageOf(e), stale_since: now });
      ctx.emit("mount.failed", `folder/${folderId}`, { mountId, folderId, error: messageOf(e) });
      return { mountId, folderId, runId };
    }
  }
  if (source.kind !== "local") await runPass(ctx, mountId);
  return { mountId, folderId, runId };
}

async function mountsSyncNow(ctx: Ctx, input: unknown): Promise<{ runId: string }> {
  const o = record(ctx, input);
  const mountId = reqStr(ctx, o, "mountId");
  const row = mountRow(ctx, mountId);
  if (str(row["kind"]) === "local") fail(ctx, "validation.precondition_failed", "A folder on your computer syncs when that computer reports. Turn the computer on and open Vyre there.");
  await runPass(ctx, mountId);
  return { runId: ctx.run ?? nid(ctx, "run") };
}

async function mountsList(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const kind = optStr(o, "kind");
  const offset = Math.max(0, Number.parseInt(optStr(o, "cursor") ?? "0", 10) || 0);
  const limitIn = o["limit"];
  const limit = typeof limitIn === "number" && Number.isInteger(limitIn) ? Math.min(Math.max(limitIn, 1), 500) : 100;
  const all = liveMounts(ctx).filter((r) => (kind === undefined || str(r["kind"]) === kind) && maySee(ctx, r));
  const page = all.slice(offset, offset + limit);
  return { mounts: page.map((r) => viewOf(ctx, r)), ...(offset + limit < all.length ? { next: String(offset + limit) } : {}), total: all.length };
}

async function mountsGet(ctx: Ctx, input: unknown): Promise<{ mount: Row }> {
  const o = record(ctx, input);
  const row = mountRow(ctx, reqStr(ctx, o, "mountId"));
  if (!maySee(ctx, row)) fail(ctx, "permission.no_grant", "You cannot see that mount.");
  return { mount: viewOf(ctx, row) };
}

async function mountsBrowse(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const kind = reqStr(ctx, o, "kind");
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "kind must be google_drive, sharepoint, onedrive, local or github.");
  const connectionId = optStr(o, "connectionId");
  if ((kind === "google_drive" || kind === "sharepoint" || kind === "onedrive") && connectionId === undefined) fail(ctx, "validation.bad_input", "Choose the connection to browse first.");
  const limitIn = o["limit"];
  const parent = optStr(o, "parent");
  const q = optStr(o, "q");
  const cursor = optStr(o, "cursor");
  const res = await providerOf(kind as MountKind).browse(ctx, {
    ...(connectionId !== undefined ? { connectionId } : {}),
    ...(parent !== undefined ? { parent } : {}),
    ...(q !== undefined ? { q } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(typeof limitIn === "number" ? { limit: limitIn } : {}),
  });
  return { items: res.items, ...(res.next !== undefined ? { next: res.next } : {}) };
}

async function mountsUpdate(ctx: Ctx, input: unknown): Promise<{ mount: Row }> {
  const o = record(ctx, input);
  const row = mountRow(ctx, reqStr(ctx, o, "mountId"));
  mayManage(ctx, row);
  const fields: string[] = [];
  const patch: Row = {};
  const mode = optStr(o, "mode");
  if (mode !== undefined) {
    if (mode !== "server_copy" && mode !== "live_only") fail(ctx, "validation.bad_input", "mode must be server_copy or live_only.");
    if (mode === "live_only" && str(row["kind"]) === "github") fail(ctx, "validation.bad_input", "A GitHub repository is always a copy.");
    if (mode !== row["mode"]) {
      patch["mode"] = mode;
      fields.push("mode");
      if (mode === "server_copy" && isCloud(str(row["kind"]) as MountKind)) {
        // becoming a copy: every file whose content was never fetched, or is stale, reads as changed, and the rescan brings it in
        for (const it of itemsOf(ctx, str(row["id"]))) if (!flag(it["is_folder"]) && !isNull(it["remote_version"]) && it["cached_version"] !== it["remote_version"]) patchItem(ctx, it, { remote_version: null });
        patch["cursor"] = null;
      }
    }
  }
  if (typeof o["reviewChanges"] === "boolean" && (o["reviewChanges"] ? 1 : 0) !== row["review_changes"]) {
    await ctx.call("files.folder.settings", { folderId: str(row["folder_id"]), reviewChanges: o["reviewChanges"] });
    patch["review_changes"] = o["reviewChanges"] ? 1 : 0;
    fields.push("reviewChanges");
  }
  if (typeof o["pullOnly"] === "boolean" && (o["pullOnly"] ? 1 : 0) !== row["pull_only"]) {
    patch["pull_only"] = o["pullOnly"] ? 1 : 0;
    fields.push("pullOnly");
    if (o["pullOnly"]) patch["stale_since"] = null;
  }
  const name = optStr(o, "name");
  if (name !== undefined && name !== row["name"]) {
    await ctx.call("files.folder.rename", { folderId: str(row["folder_id"]), name });
    patch["name"] = name;
    fields.push("name");
  }
  if (fields.length > 0) {
    patchMount(ctx, row, { ...patch, updated_at: ctx.now() });
    ctx.emit("mount.updated", `folder/${str(row["folder_id"])}`, { mountId: str(row["id"]), folderId: str(row["folder_id"]), fields });
    if (patch["cursor"] === null) {
      try { await ctx.schedule(ctx.now(), "mounts.sync_now", { mountId: str(row["id"]) }); } catch { /* the next pass brings the content in */ }
    }
  }
  return { mount: viewOf(ctx, row) };
}

async function mountsRemove(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = record(ctx, input);
  const row = mountRow(ctx, reqStr(ctx, o, "mountId"));
  mayManage(ctx, row);
  const keepCopy = o["keepCopy"] !== false;
  return exclusive(`mount:${str(row["id"])}`, async () => {
    if (!keepCopy) await quietly(() => ctx.call("files.folder.delete", { folderId: str(row["folder_id"]) }));
    ctx.db.run("DELETE FROM mounts_item WHERE mount_id = ?", row["id"]);
    patchMount(ctx, row, { deleted_at: ctx.now(), updated_at: ctx.now(), next_sync_at: null });
    ctx.emit("mount.removed", `folder/${str(row["folder_id"])}`, { mountId: str(row["id"]), folderId: str(row["folder_id"]), keptCopy: keepCopy });
    return { removed: true };
  });
}

async function mountsPause(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const row = mountRow(ctx, reqStr(ctx, record(ctx, input), "mountId"));
  mayManage(ctx, row);
  if (row["state"] === "paused") return { ok: true };
  patchMount(ctx, row, { state: "paused", next_sync_at: null, updated_at: ctx.now() });
  ctx.emit("mount.paused", `folder/${str(row["folder_id"])}`, { mountId: str(row["id"]), folderId: str(row["folder_id"]) });
  return { ok: true };
}

async function mountsResume(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const row = mountRow(ctx, reqStr(ctx, record(ctx, input), "mountId"));
  mayManage(ctx, row);
  if (row["state"] !== "paused") return { ok: true };
  patchMount(ctx, row, { state: "idle", updated_at: ctx.now() });
  ctx.emit("mount.resumed", `folder/${str(row["folder_id"])}`, { mountId: str(row["id"]), folderId: str(row["folder_id"]) });
  if (str(row["kind"]) !== "local") {
    try {
      await ctx.schedule(ctx.now(), "mounts.sync_now", { mountId: str(row["id"]) });
    } catch {
      // the next Sync now picks it up
    }
  }
  return { ok: true };
}

// ---- a device reports a local folder ------------------------------------------------------------------------

const cleanPath = (ctx: Ctx, v: unknown): string => {
  if (typeof v !== "string") return fail(ctx, "validation.bad_input", "Every change needs a path.");
  const norm = v.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
  if (norm.length === 0 || norm.includes("..") || v.includes("\u0000")) return fail(ctx, "validation.bad_input", "A path must stay inside the mounted folder.");
  return norm.join("/");
};

/** The folder item for a relative directory ("" is the mounted root); missing folders on the way are created. */
async function ensureDir(ctx: Ctx, m: MountRec, rows: Row[], dir: string): Promise<Row> {
  const root = rows.find((r) => isNull(r["parent_key"]));
  if (!root) return fail(ctx, "internal.unexpected", "The mount lost its root.");
  if (dir === "") return root;
  let at = root;
  let prefix = "";
  for (const seg of dir.split("/")) {
    prefix = prefix === "" ? seg : `${prefix}/${seg}`;
    const have = rows.find((r) => r["remote_id"] === prefix && flag(r["is_folder"]));
    if (have) {
      at = have;
      continue;
    }
    const made = await withFreeName(seg, "device", (n) => filesCreateFolder(ctx, str(at["folder_id"]), n));
    const created = insertItem(ctx, m.id, { remoteId: prefix, parentKey: str(at["item_key"]), folderId: made.value, name: seg, isFolder: true });
    rows.push(created);
    at = created;
  }
  return at;
}

const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const leafOf = (p: string): string => (p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p);

async function applyLocal(ctx: Ctx, m: MountRec, rows: Row[], ch: Row, device: string): Promise<{ applied: number; conflicts: number }> {
  const path = cleanPath(ctx, ch["path"]);
  const op = str(ch["op"]);
  const mtime = String(num(ch["mtime"]));
  const find = (p: string): Row | undefined => rows.find((r) => r["remote_id"] === p);
  if (op === "delete") {
    const row = find(path);
    if (!row) return { applied: 0, conflicts: 0 };
    await trashLocal(ctx, rows, row);
    return { applied: 1, conflicts: 0 };
  }
  if (op === "rename") {
    const from = cleanPath(ctx, ch["from"]);
    const row = find(from);
    if (row) {
      const parent = await ensureDir(ctx, m, rows, dirOf(path));
      const folder = flag(row["is_folder"]);
      const idKey = folder ? "folderId" : "fileId";
      const id = str(row[folder ? "folder_id" : "file_id"]);
      if (leafOf(path) !== row["name"]) await ctx.call(folder ? "files.folder.rename" : "files.rename", { [idKey]: id, name: leafOf(path) });
      if (row["parent_key"] !== parent["item_key"]) await ctx.call(folder ? "files.folder.move" : "files.move", folder ? { folderId: id, toParentId: str(parent["folder_id"]) } : { fileId: id, toFolderId: str(parent["folder_id"]) });
      for (const r of subtreeOf(rows, row)) {
        const old = str(r["remote_id"]);
        patchItem(ctx, r, { remote_id: r === row ? path : `${path}${old.slice(from.length)}`, ...(r === row ? { name: leafOf(path), parent_key: parent["item_key"] } : {}) });
      }
      return { applied: 1, conflicts: 0 };
    }
    // the device renamed something Vyre never saw: treat it as an add
  }
  if (op === "add" || op === "modify" || op === "rename") {
    const blobId = optStr(ch, "blobId");
    if (blobId === undefined) return { applied: 0, conflicts: 0 };
    const row = find(path);
    if (row && !flag(row["is_folder"])) {
      if (row["remote_version"] === mtime) return { applied: 0, conflicts: 0 };
      const clash = flag(row["dirty"]);
      const version = await filesWrite(ctx, str(row["file_id"]), blobId, `From ${device}`);
      patchItem(ctx, row, { remote_version: mtime, synced_version: version, local_version: version, dirty: 0, conflict: 0 });
      return { applied: 1, conflicts: clash ? 1 : 0 };
    }
    const parent = await ensureDir(ctx, m, rows, dirOf(path));
    const made = await withFreeName(leafOf(path), "device", (n) => filesCreate(ctx, str(parent["folder_id"]), n, blobId));
    rows.push(insertItem(ctx, m.id, { remoteId: path, parentKey: str(parent["item_key"]), fileId: made.value.fileId, name: leafOf(path), isFolder: false, remoteVersion: mtime, version: made.value.version }));
    return { applied: 1, conflicts: made.renamed ? 1 : 0 };
  }
  return fail(ctx, "validation.bad_input", "op must be add, modify, delete or rename.");
}

async function localReport(ctx: Ctx, input: unknown): Promise<{ applied: number; conflicts: number }> {
  const o = record(ctx, input);
  const row = mountRow(ctx, reqStr(ctx, o, "mountId"));
  const deviceId = reqStr(ctx, o, "deviceId");
  if (str(row["kind"]) !== "local") fail(ctx, "validation.precondition_failed", "Only a folder on a computer takes a device report.");
  if (row["device_id"] !== deviceId) fail(ctx, "permission.no_grant", "That computer does not hold this folder.");
  const changes = list(o["changes"]).map((c) => obj(c));
  // a bad request is refused whole, before anything is applied or the mount is marked
  for (const ch of changes) {
    cleanPath(ctx, ch["path"]);
    const op = str(ch["op"]);
    if (op !== "add" && op !== "modify" && op !== "delete" && op !== "rename") fail(ctx, "validation.bad_input", "op must be add, modify, delete or rename.");
    if (op === "rename") cleanPath(ctx, ch["from"]);
  }
  return exclusive(`mount:${str(row["id"])}`, async () => {
    const m = recOf(row);
    const started = ctx.now();
    const rows = itemsOf(ctx, m.id);
    let applied = 0;
    let conflicts = 0;
    if (m.mode === "live_only") {
      // no server copy: the index stays on the device and a change is acknowledged, not stored
      applied = changes.length;
    } else {
      try {
        for (const ch of changes) {
          const r = await applyLocal(ctx, m, rows, ch, deviceId);
          applied += r.applied;
          conflicts += r.conflicts;
        }
      } catch (e) {
        patchMount(ctx, row, { state: "failing", error: messageOf(e), stale_since: isNull(row["stale_since"]) ? ctx.now() : row["stale_since"], updated_at: ctx.now() });
        ctx.emit("mount.failed", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, error: messageOf(e) });
        throw e;
      }
    }
    const now = ctx.now();
    patchMount(ctx, row, { state: row["state"] === "paused" ? "paused" : "idle", error: null, last_sync_at: now, stale_since: null, updated_at: now });
    ctx.emit("mount.synced", `folder/${m.folderId}`, { mountId: m.id, folderId: m.folderId, pulled: applied, pushed: 0, conflicts, ms: Math.max(0, now - started) });
    return { applied, conflicts };
  });
}

// ---- opening a file, its history, who edited it, push notices ----------------------------------------------

function itemOfFile(ctx: Ctx, fileId: string): Row | undefined {
  return (ctx.db.all("SELECT * FROM mounts_item WHERE file_id = ?", fileId) as Row[]).find((r) => !isNull(r["remote_id"]));
}

/** The live mount a file belongs to, with its provider; undefined when the file is not in a mount (or the mount was removed). */
function mountOfItem(ctx: Ctx, item: Row): { row: Row; m: MountRec; provider: Provider } | undefined {
  const row = (ctx.db.all("SELECT * FROM mounts_mount WHERE id = ?", item["mount_id"]) as Row[])[0];
  if (!row || !isNull(row["deleted_at"])) return undefined;
  const m = recOf(row);
  return { row, m, provider: providerOf(m.kind) };
}

const personOut = (name: unknown, email: unknown): Row => ({ ...(isNull(name) ? {} : { name: str(name) }), ...(isNull(email) ? {} : { email: str(email) }) });

function sourceView(ctx: Ctx, item: Row, row: Row): Row {
  const kind = str(row["kind"]) as MountKind;
  const out: Row = {
    mountId: str(row["id"]), provider: PROVIDER_LABEL[kind], remoteId: str(item["remote_id"]),
    cached: flag(item["is_folder"]) || (!isNull(item["cached_version"]) && item["cached_version"] === item["remote_version"]),
    conflict: flag(item["conflict"]),
  };
  if (!isNull(item["remote_rev"])) out["revisionId"] = str(item["remote_rev"]);
  if (!isNull(item["modified_at"])) out["modifiedAt"] = num(item["modified_at"]);
  const editor = personOut(item["editor_name"], item["editor_email"]);
  if (Object.keys(editor).length > 0) out["lastEditedBy"] = editor;
  return out;
}

/** Opening a file in a live mount: ask the provider what it holds now and fetch the content only if the copy in Vyre is not that version. */
async function mountsOpen(ctx: Ctx, input: unknown): Promise<Row> {
  const fileId = reqStr(ctx, record(ctx, input), "fileId");
  const first = itemOfFile(ctx, fileId);
  const owner = first ? mountOfItem(ctx, first) : undefined;
  if (!first || !owner) return { mounted: false, fetched: false };
  if (!maySee(ctx, owner.row)) fail(ctx, "permission.no_grant", "You cannot see that mount.");
  const { row, m, provider } = owner;
  let fetched = false;
  let staged: string | undefined;
  let offline = false;
  if (isLive(m) && provider.download && !flag(first["is_folder"])) {
    await exclusive(`mount:${m.id}`, async () => {
      const item = (ctx.db.all("SELECT * FROM mounts_item WHERE mount_id = ? AND item_key = ?", m.id, first["item_key"]) as Row[])[0] ?? first;
      let fresh: RemoteItem | undefined;
      try { fresh = provider.stat ? await provider.stat(ctx, m, str(item["remote_id"])) : undefined; } catch { offline = true; }
      const want = fresh?.version ?? (isNull(item["remote_version"]) ? undefined : str(item["remote_version"]));
      if (fresh) patchItem(ctx, item, { name: item["name"], ...metaOf(fresh) });
      if (flag(item["dirty"]) || want === undefined || item["cached_version"] === want) return;
      if (flag(item["native"]) && fresh?.mime === undefined) return;
      const dl = await provider.download!(ctx, m, { remoteId: str(item["remote_id"]), name: str(item["name"]), ...(fresh?.mime !== undefined ? { mime: fresh.mime } : {}), ...(flag(item["native"]) ? { native: true } : {}) });
      const r = obj(await ctx.call("files.write", { fileId, content: { blobId: dl.blobId }, reason: `Fetched from ${provider.label}` }));
      if (typeof r["changesetId"] === "string") {
        // an agent's write in a Review changes folder waits for approval; the content is not in the file yet
        staged = r["changesetId"];
        return;
      }
      const version = num(obj(r["file"])["version"]);
      patchItem(ctx, item, { remote_version: want, cached_version: want, synced_version: version, local_version: version, dirty: 0, conflict: 0 });
      fetched = true;
    });
  }
  const now = (ctx.db.all("SELECT * FROM mounts_item WHERE mount_id = ? AND item_key = ?", m.id, first["item_key"]) as Row[])[0] ?? first;
  return { mounted: true, fetched, ...(staged !== undefined ? { changesetId: staged } : {}), ...(offline ? { offline: true } : {}), source: sourceView(ctx, now, row) };
}

/** The provider's history of a file, newest first, with the person or agent behind each revision Vyre sent. */
async function mountsHistory(ctx: Ctx, input: unknown): Promise<Row> {
  const fileId = reqStr(ctx, record(ctx, input), "fileId");
  const item = itemOfFile(ctx, fileId);
  const owner = item ? mountOfItem(ctx, item) : undefined;
  if (!item || !owner || !owner.provider.revisions) return fail(ctx, "validation.precondition_failed", "This file has no history to show.");
  if (!maySee(ctx, owner.row)) fail(ctx, "permission.no_grant", "You cannot see that mount.");
  const list_ = await owner.provider.revisions(ctx, owner.m, str(item["remote_id"]));
  const notes = ctx.db.all("SELECT * FROM mounts_revision WHERE mount_id = ? AND remote_id = ?", owner.m.id, item["remote_id"]) as Row[];
  const NEAR_MS = 2 * 60 * 1000;
  const noteOf = (r: Revision): Row | undefined =>
    notes.find((n) => n["revision_id"] === r.id)
    ?? (r.at === undefined ? undefined : notes.filter((n) => Math.abs(num(n["at"]) - (r.at as number)) <= NEAR_MS).sort((a, b) => Math.abs(num(a["at"]) - (r.at as number)) - Math.abs(num(b["at"]) - (r.at as number)))[0]);
  const ordered = [...list_].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const revisions = ordered.map((r, i) => {
    const note = noteOf(r);
    const by: Person & { actor?: string } = { ...(r.by ?? {}), ...(note ? { actor: str(note["by_actor"]) } : {}) };
    return { revisionId: r.id, ...(r.at !== undefined ? { at: r.at } : {}), ...(r.size !== undefined ? { size: r.size } : {}), ...(Object.keys(by).length > 0 ? { by } : {}), current: i === ordered.length - 1 };
  }).reverse();
  return { revisions };
}

/** Put an earlier revision back as the newest one. The content is written to the Vyre file like any edit and goes out in the same pass, conditional like every other write. */
async function mountsRestore(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const revisionId = reqStr(ctx, o, "revisionId");
  const item = itemOfFile(ctx, fileId);
  const owner = item ? mountOfItem(ctx, item) : undefined;
  if (!item || !owner || !owner.provider.revisionBlob) return fail(ctx, "validation.precondition_failed", "This file has no history to restore from.");
  const d = ctx.authorize({ perm: "files.write", level: "edit" }, { type: "file", id: fileId });
  if (d.effect === "deny") fail(ctx, "permission.no_grant", d.reason);
  if (d.effect === "hold") fail(ctx, "permission.needs_approval", d.reason);
  const { row, m, provider } = owner;
  const dl = await provider.revisionBlob!(ctx, m, { remoteId: str(item["remote_id"]), revisionId });
  const r = obj(await ctx.call("files.write", { fileId, content: { blobId: dl.blobId }, reason: `Restored from ${provider.label} history` }));
  if (typeof r["changesetId"] === "string") return { restored: false, changesetId: r["changesetId"] };
  const version = num(obj(r["file"])["version"]);
  await exclusive(`mount:${m.id}`, async () => {
    const at = (ctx.db.all("SELECT * FROM mounts_item WHERE mount_id = ? AND item_key = ?", m.id, item["item_key"]) as Row[])[0] ?? item;
    patchItem(ctx, at, { local_version: version, dirty: 1, dirty_by: ctx.principal.id, conflict: 0 });
    if (isNull(row["stale_since"])) patchMount(ctx, row, { stale_since: ctx.now() });
  });
  const pass = await runPass(ctx, m.id);
  return { restored: !pass.failed };
}

/** Last edited by, for the rows of a file list. */
async function mountsEditors(ctx: Ctx, input: unknown): Promise<Row> {
  const ids = list(record(ctx, input)["fileIds"]).filter((v): v is string => typeof v === "string").slice(0, 200);
  const editors: Row[] = [];
  const seen = new Map<string, boolean>();
  for (const fileId of ids) {
    const item = itemOfFile(ctx, fileId);
    const owner = item ? mountOfItem(ctx, item) : undefined;
    if (!item || !owner) continue;
    const mountId = owner.m.id;
    if (!seen.has(mountId)) seen.set(mountId, maySee(ctx, owner.row));
    if (seen.get(mountId) !== true) continue;
    const who = personOut(item["editor_name"], item["editor_email"]);
    editors.push({ fileId, provider: PROVIDER_LABEL[owner.m.kind], ...who, ...(isNull(item["modified_at"]) ? {} : { at: num(item["modified_at"]) }) });
  }
  return { editors };
}

/** Something happened that a pass should hear about: a provider push notice (Drive channel, Graph subscription), or an app saying it shows a mount. */
async function mountsNudge(ctx: Ctx, input: unknown): Promise<Row> {
  const o = record(ctx, input);
  const source = reqStr(ctx, o, "source");
  if (source === "client") {
    const only = optStr(o, "mountId");
    const rows = liveMounts(ctx).filter((r) => isCloud(str(r["kind"]) as MountKind) && r["state"] !== "paused" && (only === undefined || r["id"] === only) && maySee(ctx, r));
    let ran = 0;
    for (const row of rows) {
      patchMount(ctx, row, { client_seen_at: ctx.now() });
      // without a push channel a mount is only as fresh as its last pass: an app that shows it asks for one when 30 s have gone by
      if (!hasPush(ctx, row) && (isNull(row["last_sync_at"]) || ctx.now() - num(row["last_sync_at"]) >= LIVE_POLL_MS) && !queued.has(str(row["id"]))) {
        queued.add(str(row["id"]));
        await runPass(ctx, str(row["id"]));
        ran += 1;
      } else {
        await scheduleNext(ctx, row);
      }
    }
    return { mounts: rows.length, passes: ran };
  }
  if (source !== "google" && source !== "microsoft") return fail(ctx, "validation.bad_input", "source must be google, microsoft or client.");
  const channel = optStr(o, source === "google" ? "channelId" : "subscriptionId");
  if (channel === undefined) return fail(ctx, "validation.bad_input", source === "google" ? "channelId is required." : "subscriptionId is required.");
  const rows = liveMounts(ctx).filter((r) => r["watch_id"] === channel);
  const replacedBy = optStr(o, "replacedBy");
  if (replacedBy !== undefined) {
    // Graph lost the subscription and the microsoft module made another: the mount follows it
    for (const row of rows) patchMount(ctx, row, { watch_id: replacedBy });
    return { mounts: rows.length, passes: 0 };
  }
  let ran = 0;
  for (const row of rows) {
    if (row["state"] === "paused" || queued.has(str(row["id"]))) continue;
    queued.add(str(row["id"]));
    await runPass(ctx, str(row["id"]));
    ran += 1;
  }
  return { mounts: rows.length, passes: ran };
}

// ---- health -------------------------------------------------------------------------------------------------

async function mountsLag(ctx: Ctx, _input: unknown): Promise<Row> {
  const active = liveMounts(ctx).filter((r) => r["state"] !== "paused");
  const failing = active.filter((r) => r["state"] === "failing").map((r) => str(r["id"]));
  const worst = active.reduce((w, r) => Math.max(w, lagSeconds(ctx, r)), 0);
  const offline = active.filter((r) => stateOf(ctx, r) === "device_offline").length;
  let state: "healthy" | "degraded" | "down" = "healthy";
  if (failing.length > 0 || worst >= LAG_DEGRADED_S || offline > 0) state = "degraded";
  if (worst >= LAG_DOWN_S || (active.length > 0 && failing.length === active.length)) state = "down";
  const bits: string[] = [];
  if (failing.length > 0) bits.push(`${failing.length} mount${failing.length === 1 ? "" : "s"} failing`);
  if (offline > 0) bits.push(`${offline} computer${offline === 1 ? "" : "s"} offline`);
  if (worst >= 60) bits.push(`worst lag ${Math.floor(worst / 60)} minute${Math.floor(worst / 60) === 1 ? "" : "s"}`);
  return { state, ...(bits.length > 0 ? { detail: bits.join("; ") } : {}), worstLagSeconds: worst, failing };
}

export const engineHandlers = {
  "mounts.browse": (ctx: Ctx, input: unknown) => mountsBrowse(ctx, input),
  "mounts.list": (ctx: Ctx, input: unknown) => mountsList(ctx, input),
  "mounts.get": (ctx: Ctx, input: unknown) => mountsGet(ctx, input),
  "mounts.add": (ctx: Ctx, input: unknown) => mountsAdd(ctx, input),
  "mounts.update": (ctx: Ctx, input: unknown) => mountsUpdate(ctx, input),
  "mounts.remove": (ctx: Ctx, input: unknown) => mountsRemove(ctx, input),
  "mounts.sync_now": (ctx: Ctx, input: unknown) => mountsSyncNow(ctx, input),
  "mounts.pause": (ctx: Ctx, input: unknown) => mountsPause(ctx, input),
  "mounts.resume": (ctx: Ctx, input: unknown) => mountsResume(ctx, input),
  "mounts.local_report": (ctx: Ctx, input: unknown) => localReport(ctx, input),
  "mounts.lag": (ctx: Ctx, input: unknown) => mountsLag(ctx, input),
  "mounts.open": (ctx: Ctx, input: unknown) => mountsOpen(ctx, input),
  "mounts.history": (ctx: Ctx, input: unknown) => mountsHistory(ctx, input),
  "mounts.restore": (ctx: Ctx, input: unknown) => mountsRestore(ctx, input),
  "mounts.editors": (ctx: Ctx, input: unknown) => mountsEditors(ctx, input),
  "mounts.nudge": (ctx: Ctx, input: unknown) => mountsNudge(ctx, input),
};
