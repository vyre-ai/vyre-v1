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
// Lag: stale_since is when the oldest unsynced change was first seen. A pass that leaves nothing waiting clears it, a failed pass starts it. The lag health reads it for every live mount.

import { mintUuid } from "../../../lib/ids.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { PROVIDER_LABEL, isCloud, providerOf } from "./providers.ts";
import type { MountKind, MountMode, MountRec, Provider, PullBatch, RemoteItem } from "./providers.ts";

type Row = Record<string, unknown>;

/** How often a mount syncs on its own. */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** A local mount whose device has not reported for this long reads as device_offline. */
export const DEVICE_OFFLINE_MS = 15 * 60 * 1000;
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
}

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
    synced_version: n.version ?? null,
    local_version: n.version ?? null,
    dirty: n.dirty ? 1 : 0,
    deleted: 0,
    conflict: 0,
  };
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
  const r = obj(await ctx.call("files.folder.create", { parentId, name, ...(reviewChanges !== undefined ? { reviewChanges } : {}) }));
  return str(obj(r["folder"])["folderId"]);
}

async function filesCreate(ctx: Ctx, folderId: string, name: string, blobId: string, mime?: string, kind?: string): Promise<{ fileId: string; version: number }> {
  const r = obj(await ctx.call("files.create", { folderId, name, content: { blobId }, ...(mime !== undefined ? { mime } : {}), ...(kind !== undefined ? { kind } : {}) }));
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

// ---- applying a pulled batch --------------------------------------------------------------------------------

interface Applied { pulled: number; conflicts: number }

async function applyBatch(ctx: Ctx, m: MountRec, provider: Provider, batch: PullBatch, rows: Row[]): Promise<Applied> {
  let pulled = 0;
  let conflicts = 0;
  const label = provider.label;
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
      const dl = await provider.download(ctx, m, { remoteId: item.id, name: item.name, ...(item.mime !== undefined ? { mime: item.mime } : {}), ...(item.native ? { native: true } : {}) });
      const mime = dl.mime ?? (item.native ? undefined : item.mime);
      const made = await withFreeName(item.name, label, (n) => filesCreate(ctx, parentFolder, n, dl.blobId, mime, item.native ? "google_native" : undefined));
      if (made.renamed) conflicts += 1;
      const created = insertItem(ctx, m.id, {
        remoteId: item.id, parentKey: str(parent["item_key"]), fileId: made.value.fileId, name: item.name, isFolder: false, native: item.native === true,
        remoteVersion: item.version ?? null, version: made.value.version,
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
      const dl = await provider.download(ctx, m, { remoteId: item.id, name: item.name, ...(item.mime !== undefined ? { mime: item.mime } : {}), ...(item.native ? { native: true } : {}) });
      const version = await filesWrite(ctx, str(row["file_id"]), dl.blobId, `Synced from ${label}`);
      patchItem(ctx, row, { remote_version: item.version, synced_version: version, local_version: version, dirty: 0, conflict: 0 });
      pulled += 1;
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

interface Pushed { pushed: number; held: number; errors: string[] }

const depthOf = (rows: readonly Row[], row: Row): number => {
  let d = 0;
  for (let at: Row | undefined = row; at && !isNull(at["parent_key"]) && d < 64; d++) at = rows.find((r) => r["item_key"] === at?.["parent_key"]);
  return d;
};

async function pushAll(ctx: Ctx, m: MountRec, provider: Provider, rows: Row[]): Promise<Pushed> {
  const res: Pushed = { pushed: 0, held: 0, errors: [] };
  if (!provider.pushes || m.pullOnly) return res;
  const settle = (e: unknown): void => {
    if (codeOf(e) === "permission.needs_approval") res.held += 1;
    else res.errors.push(messageOf(e));
  };
  const parentRemote = (row: Row): string | undefined => {
    const parent = rows.find((r) => r["item_key"] === row["parent_key"]);
    return parent && !isNull(parent["remote_id"]) ? str(parent["remote_id"]) : undefined;
  };

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
      const up = await provider.upload(ctx, m, { fileId: str(f["file_id"]), name: str(f["name"]), parentRemote: parent, ...(isNull(f["remote_id"]) ? {} : { remoteId: str(f["remote_id"]) }) });
      patchItem(ctx, f, { remote_id: up.remoteId, remote_version: up.version ?? f["remote_version"] ?? null, synced_version: f["local_version"] ?? null, dirty: 0 });
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
  return {
    id: str(row["id"]),
    folderId: str(row["folder_id"]),
    kind: str(row["kind"]) as MountKind,
    ...(connectionId !== undefined ? { connectionId } : {}),
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

async function scheduleNext(ctx: Ctx, row: Row): Promise<void> {
  const now = ctx.now();
  if (str(row["kind"]) === "local" || row["state"] === "paused") return;
  if (!isNull(row["next_sync_at"]) && num(row["next_sync_at"]) > now) return;
  const at = now + SYNC_INTERVAL_MS;
  try {
    await ctx.schedule(at, "mounts.sync_now", { mountId: str(row["id"]) });
    patchMount(ctx, row, { next_sync_at: at });
  } catch {
    // no scheduler: the next sync is a person's Sync now
  }
}

async function runPass(ctx: Ctx, mountId: string): Promise<PassResult> {
  return exclusive(`mount:${mountId}`, async () => {
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

async function mountsAdd(ctx: Ctx, input: unknown): Promise<{ mountId: string; folderId: string; runId: string }> {
  const o = record(ctx, input);
  const into = reqStr(ctx, o, "into");
  const source = sourceOf(ctx, o);
  const modeIn = optStr(o, "mode");
  if (modeIn !== undefined && modeIn !== "server_copy" && modeIn !== "live_only") fail(ctx, "validation.bad_input", "mode must be server_copy or live_only.");
  if (modeIn === "live_only" && source.kind !== "local") fail(ctx, "validation.bad_input", "Only a folder on your computer can be live only.");
  if (liveMounts(ctx).some((r) => sameSource(r, source))) fail(ctx, "validation.duplicate", "That is already mounted.");
  const mode: MountMode = source.kind === "local" ? (modeIn === "live_only" || modeIn === "server_copy" ? modeIn : await localDefaultMode(ctx)) : "server_copy";
  const reviewIn = o["reviewChanges"];
  const review = typeof reviewIn === "boolean" ? reviewIn : await settingFlag(ctx, source.kind === "github" ? "git" : isCloud(source.kind) ? "cloud_mount" : "plain");
  const repoName = source.ref !== undefined ? baseName(source.ref) : "";
  const name = optStr(o, "name") ?? (source.kind === "local" ? baseName(source.localPath ?? "Folder") : source.kind === "github" ? repoName : PROVIDER_LABEL[source.kind]);

  const folderId = await filesCreateFolder(ctx, into, name, review);
  const now = ctx.now();
  const mountId = nid(ctx, "mnt");
  const fields: Row = {
    id: mountId, folder_id: folderId, kind: source.kind, connection_id: source.connectionId ?? null, ref: source.ref ?? null, path: source.path ?? null, branch: source.branch ?? null,
    device_id: source.deviceId ?? null, local_path: source.localPath ?? null, name, mode, review_changes: review ? 1 : 0, pull_only: 0, state: "idle", cursor: null, owner: ctx.principal.id,
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
    if (mode === "live_only" && str(row["kind"]) !== "local") fail(ctx, "validation.bad_input", "Only a folder on your computer can be live only.");
    if (mode !== row["mode"]) {
      patch["mode"] = mode;
      fields.push("mode");
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
};
