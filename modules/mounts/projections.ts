// mounts projections: local changes in the files module mark the items of a mount that have to go out on the next pass.
// consumers (async): file.created and folder.created add an item for a new local file or folder in a mounted folder; file.version_added marks an item dirty when the version is newer than the one last synced;
// file.deleted and folder.deleted queue the delete (or drop the item when it never left Vyre). The mount engine records the same rows on its own writes, so replay is idempotent and a second pass changes nothing.

import { mintUuid } from "../../lib/ids.ts";

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

type Row = Record<string, unknown>;

function payloadOf(payload: Uint8Array): Row {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Row) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function itemOfFile(tx: ProjTx, fileId: string): Row | undefined {
  return (tx.all("SELECT * FROM mounts_item WHERE file_id = ?", fileId) as Row[])[0];
}

function folderItem(tx: ProjTx, folderId: string): Row | undefined {
  return (tx.all("SELECT * FROM mounts_item WHERE folder_id = ? AND is_folder = ?", folderId, 1) as Row[])[0];
}

function mountOf(tx: ProjTx, id: string): Row | undefined {
  const m = (tx.all("SELECT * FROM mounts_mount WHERE id = ?", id) as Row[])[0];
  return m && m["deleted_at"] === null ? m : undefined;
}

/** A change waits to go out: the lag clock starts at the first one (a pull-only mount keeps no clock, its local edits never leave). */
function startClock(tx: ProjTx, mountId: string, at: number): void {
  const m = mountOf(tx, mountId);
  if (!m || m["stale_since"] !== null || m["pull_only"] === 1) return;
  tx.run("UPDATE mounts_mount SET stale_since = ? WHERE id = ?", at, mountId);
}

/** A parent row to hang a new local item on, or nothing when the folder is not in a live mount. */
function parentFor(tx: ProjTx, folderId: string): Row | undefined {
  const parent = folderItem(tx, folderId);
  if (!parent || parent["deleted"] === 1) return undefined;
  return mountOf(tx, str(parent["mount_id"])) ? parent : undefined;
}

export function onFileCreated(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const fileId = str(p["fileId"]);
  const folderId = str(p["folderId"]);
  if (fileId === "" || folderId === "" || itemOfFile(tx, fileId)) return;
  const parent = parentFor(tx, folderId);
  if (!parent) return;
  const mountId = str(parent["mount_id"]);
  tx.run(
    "INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, remote_version, synced_version, local_version, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    mountId, `itm_${mintUuid(e.at).replaceAll("-", "")}`, null, parent["item_key"], fileId, null, str(p["name"]), 0, 0, null, 0, 1, 1, 0, 0,
  );
  startClock(tx, mountId, e.at);
}

export function onFolderCreated(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const folderId = str(p["folderId"]);
  const parentId = str(p["parentId"]);
  if (folderId === "" || parentId === "" || folderItem(tx, folderId)) return;
  const parent = parentFor(tx, parentId);
  if (!parent) return;
  const mountId = str(parent["mount_id"]);
  tx.run(
    "INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, remote_version, synced_version, local_version, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    mountId, `itm_${mintUuid(e.at).replaceAll("-", "")}`, null, parent["item_key"], null, folderId, str(p["name"]), 1, 0, null, null, null, 1, 0, 0,
  );
  startClock(tx, mountId, e.at);
}

export function onVersionAdded(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const row = itemOfFile(tx, str(p["fileId"]));
  const n = typeof p["n"] === "number" ? p["n"] : 0;
  if (!row || row["native"] === 1) return;
  const synced = typeof row["synced_version"] === "number" ? row["synced_version"] : 0;
  if (n <= synced) return;
  tx.run("UPDATE mounts_item SET local_version = ?, dirty = ? WHERE mount_id = ? AND item_key = ?", n, 1, row["mount_id"], row["item_key"]);
  startClock(tx, str(row["mount_id"]), e.at);
}

/** A delete in Vyre: an item that never left Vyre is dropped, one that exists at the provider waits to be deleted there. */
function queueDelete(tx: ProjTx, row: Row, at: number): void {
  const mountId = str(row["mount_id"]);
  if (row["remote_id"] === null) {
    tx.run("DELETE FROM mounts_item WHERE mount_id = ? AND item_key = ?", mountId, row["item_key"]);
    return;
  }
  tx.run("UPDATE mounts_item SET deleted = ?, dirty = ? WHERE mount_id = ? AND item_key = ?", 1, 1, mountId, row["item_key"]);
  startClock(tx, mountId, at);
}

export function onFileDeleted(tx: ProjTx, e: ProjEvent): void {
  const row = itemOfFile(tx, str(payloadOf(e.payload)["fileId"]));
  if (row) queueDelete(tx, row, e.at);
}

export function onFolderDeleted(tx: ProjTx, e: ProjEvent): void {
  const row = folderItem(tx, str(payloadOf(e.payload)["folderId"]));
  if (row && row["parent_key"] !== null) queueDelete(tx, row, e.at);
}

export const localChangesConsumer = {
  name: "mounts.local_changes",
  version: 1,
  mode: "async" as const,
  rebuild: "replay" as const,
  on: {
    "file.created": onFileCreated,
    "folder.created": onFolderCreated,
    "file.version_added": onVersionAdded,
    "file.deleted": onFileDeleted,
    "folder.deleted": onFolderDeleted,
  } as Record<string, (tx: ProjTx, e: ProjEvent) => void>,
};

export const inline = {};
export const consumers = { "mounts.local_changes": localChangesConsumer };
