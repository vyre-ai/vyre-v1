// Mounts, outbound moves (spec 2.16 Mounts): a rename or a move made in Vyre inside a mounted folder goes out to the provider, in the order it was made.
//
// Two halves, both pure over the mounts_item rows so the engine and the projections only have to call them:
//   projection handlers   onFileRenamed / onFileMoved / onFolderRenamed / onFolderMoved (movesConsumer.on). They mark the item dirty (the row keeps the name and parent the PROVIDER has),
//                         turn a move out of the mounted folder into a queued delete, a move into it into a new item, and a move between two mounts into both.
//   pushMoves             the push step. For each dirty item that exists at the provider it asks the files module what the item is called and where it sits now, and sends the difference.
//
// Wiring (the lead, not this packet: engine.ts and projections.ts are outside it):
//   projections.ts   consumers["mounts.local_changes"].on gets the four handlers of movesConsumer.on.
//   engine.ts        pushAll calls `const mv = await pushMoves(ctx, m, provider, rows, (row, fields) => patchItem(ctx, row, fields))` before its "new folders" step and adds mv.moved to
//                    pushed, mv.held to held and mv.errors to errors. Until then a renamed item is sent by the plain file-upload step as a new file and the old one stays at the provider.
//
// What the providers can do: the contract has no rename or move for Drive (google.drive.*) or Graph (ms.drive.*), only upload, create folder and trash/delete. So a rename or a move is
// carried out as create-then-remove: the item is created under its new name and parent, and only after that succeeded is the old one removed (a failure in between never loses the item).
// The item gets a new provider id (links and shares of the old one do not follow). A folder is created again, its descendants are marked to be created under it by the normal push
// that follows in the same pass, and the old folder (with its old contents) is removed. A native rename/move capability on both providers would keep ids; that is a CONTRACT-CHANGE request.
// A local folder is moved by its device and a GitHub mount by git (a commit), so for those two nothing goes out from here and nothing is marked.
//
// Limit: a folder moved INTO a mounted folder becomes one folder item; the files inside it are not adopted (they have no items). Move the files instead, or sync from the provider.

import { mintUuid } from "../../../lib/ids.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { MountRec, Provider } from "./providers.ts";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const flag = (v: unknown): boolean => v === 1 || v === true;
const isNull = (v: unknown): boolean => v === null || v === undefined;

// ---- the projection half ------------------------------------------------------------------------------------

export interface ProjTx {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface ProjEvent {
  at: number;
  actor: string;
  payload: Uint8Array;
}

function payloadOf(payload: Uint8Array): Row {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Row) : {};
  } catch {
    return {};
  }
}

const itemOfFile = (tx: ProjTx, fileId: string): Row | undefined => (tx.all("SELECT * FROM mounts_item WHERE file_id = ?", fileId) as Row[])[0];
const folderItem = (tx: ProjTx, folderId: string): Row | undefined => (tx.all("SELECT * FROM mounts_item WHERE folder_id = ? AND is_folder = ?", folderId, 1) as Row[])[0];

function liveMount(tx: ProjTx, id: string): Row | undefined {
  const m = (tx.all("SELECT * FROM mounts_mount WHERE id = ?", id) as Row[])[0];
  return m && m["deleted_at"] === null ? m : undefined;
}

/** Only a provider Vyre writes to takes moves from here (Drive, SharePoint, OneDrive); a local folder and a GitHub mount do their own. */
const goesOut = (mount: Row): boolean => mount["kind"] === "google_drive" || mount["kind"] === "sharepoint" || mount["kind"] === "onedrive";

/** The folder item a moved thing landed in, when that folder is in a live mount that takes moves. */
function destination(tx: ProjTx, folderId: string): { parent: Row; mount: Row } | undefined {
  const parent = folderItem(tx, folderId);
  if (!parent || flag(parent["deleted"])) return undefined;
  const mount = liveMount(tx, str(parent["mount_id"]));
  return mount && goesOut(mount) ? { parent, mount } : undefined;
}

function startClock(tx: ProjTx, mount: Row, at: number): void {
  if (!isNull(mount["stale_since"]) || flag(mount["pull_only"])) return;
  tx.run("UPDATE mounts_mount SET stale_since = ? WHERE id = ?", at, mount["id"]);
}

/** The item waits to go out. A pull-only mount never sends, so it keeps no clock and nothing is marked. */
function markDirty(tx: ProjTx, row: Row, at: number): void {
  const mount = liveMount(tx, str(row["mount_id"]));
  if (!mount || !goesOut(mount) || flag(mount["pull_only"])) return;
  tx.run("UPDATE mounts_item SET dirty = ? WHERE mount_id = ? AND item_key = ?", 1, row["mount_id"], row["item_key"]);
  startClock(tx, mount, at);
}

/** A delete in Vyre: an item that never left Vyre is dropped, one that exists at the provider waits to be deleted there. */
function queueDelete(tx: ProjTx, row: Row, at: number): void {
  const mount = liveMount(tx, str(row["mount_id"]));
  // a mount Vyre does not write to (local folder, GitHub) has nothing to delete: the item just stops being mapped, and the file stays where the person put it
  if (isNull(row["remote_id"]) || (mount && !goesOut(mount))) {
    tx.run("DELETE FROM mounts_item WHERE mount_id = ? AND item_key = ?", row["mount_id"], row["item_key"]);
    return;
  }
  tx.run("UPDATE mounts_item SET deleted = ?, dirty = ? WHERE mount_id = ? AND item_key = ?", 1, 1, row["mount_id"], row["item_key"]);
  if (mount) startClock(tx, mount, at);
}

function adopt(tx: ProjTx, into: { parent: Row; mount: Row }, a: { fileId?: string; folderId?: string; name: string; at: number }): void {
  tx.run(
    "INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, remote_version, synced_version, local_version, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    into.mount["id"], `itm_${mintUuid(a.at).replaceAll("-", "")}`, null, into.parent["item_key"], a.fileId ?? null, a.folderId ?? null, a.name,
    a.folderId !== undefined ? 1 : 0, 0, null, a.fileId !== undefined ? 0 : null, a.fileId !== undefined ? 1 : null, 1, 0, 0,
  );
  startClock(tx, into.mount, a.at);
}

/** The item is renamed or moved in Vyre. Not yet at the provider: the row just follows. At the provider: it waits to be moved there. */
function follow(tx: ProjTx, row: Row, at: number, change: { name?: string; parentKey?: unknown }): void {
  if (flag(row["deleted"])) return;
  if (isNull(row["remote_id"])) {
    if (change.name !== undefined) tx.run("UPDATE mounts_item SET name = ? WHERE mount_id = ? AND item_key = ?", change.name, row["mount_id"], row["item_key"]);
    if (change.parentKey !== undefined) tx.run("UPDATE mounts_item SET parent_key = ? WHERE mount_id = ? AND item_key = ?", change.parentKey, row["mount_id"], row["item_key"]);
    return;
  }
  markDirty(tx, row, at);
}

export function onFileRenamed(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const row = itemOfFile(tx, str(p["fileId"]));
  if (row && !flag(row["native"])) follow(tx, row, e.at, { name: str(p["to"]) });
}

export function onFileMoved(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const fileId = str(p["fileId"]);
  const to = destination(tx, str(p["toFolderId"]));
  const row = itemOfFile(tx, fileId);
  if (row && flag(row["native"])) return;
  if (row && to && row["mount_id"] === to.mount["id"]) {
    follow(tx, row, e.at, { parentKey: to.parent["item_key"] });
    return;
  }
  // out of this mount (to nowhere, or to another mount): deleted there
  if (row) queueDelete(tx, row, e.at);
  // into a mount: created there (the name comes from the row it had, or from the files module at push time)
  if (to) adopt(tx, to, { fileId, name: row ? str(row["name"]) : "", at: e.at });
}

export function onFolderRenamed(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const row = folderItem(tx, str(p["folderId"]));
  if (row && !isNull(row["parent_key"])) follow(tx, row, e.at, { name: str(p["to"]) });
}

export function onFolderMoved(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const folderId = str(p["folderId"]);
  const to = destination(tx, str(p["toParentId"]));
  const row = folderItem(tx, folderId);
  if (row && isNull(row["parent_key"])) return;
  if (row && to && row["mount_id"] === to.mount["id"]) {
    follow(tx, row, e.at, { parentKey: to.parent["item_key"] });
    return;
  }
  if (row) queueDelete(tx, row, e.at);
  if (to) adopt(tx, to, { folderId, name: row ? str(row["name"]) : "", at: e.at });
}

export const movesConsumer = {
  on: {
    "file.renamed": onFileRenamed,
    "file.moved": onFileMoved,
    "folder.renamed": onFolderRenamed,
    "folder.moved": onFolderMoved,
  } as Record<string, (tx: ProjTx, e: ProjEvent) => void>,
};

// ---- the push half ------------------------------------------------------------------------------------------

export interface MovesPushed {
  /** items renamed, moved, moved out (queued for the delete step) or named */
  moved: number;
  /** moves waiting for approval at the Gate */
  held: number;
  errors: string[];
}

type Patch = (row: Row, fields: Row) => void;

interface Here { name: string; folderId: string }

/** What Vyre calls the item now and the folder it sits in; undefined when the files module no longer has it. */
async function lookHere(ctx: Ctx, row: Row): Promise<Here | undefined> {
  try {
    if (flag(row["is_folder"])) {
      const got = (await ctx.call("files.folder.get", { folderId: str(row["folder_id"]) })) as { folder?: { name?: unknown; parentId?: unknown } };
      const f = got.folder;
      return typeof f?.name === "string" && typeof f.parentId === "string" ? { name: f.name, folderId: f.parentId } : undefined;
    }
    const got = (await ctx.call("files.get", { fileId: str(row["file_id"]) })) as { file?: { name?: unknown; folderId?: unknown; deletedAt?: unknown } };
    const f = got.file;
    return typeof f?.name === "string" && typeof f.folderId === "string" && isNull(f.deletedAt) ? { name: f.name, folderId: f.folderId } : undefined;
  } catch (e) {
    if (e instanceof VyreErr && (e.error.code === "validation.not_found" || e.error.code === "permission.not_found")) return undefined;
    throw e;
  }
}

function subtreeOf(rows: readonly Row[], top: Row): Row[] {
  const out: Row[] = [top];
  for (let i = 0; i < out.length; i++) {
    const at = out[i];
    if (!at) break;
    for (const r of rows) if (r["parent_key"] === at["item_key"] && !out.includes(r)) out.push(r);
  }
  return out;
}

function depthOf(rows: readonly Row[], row: Row): number {
  let d = 0;
  for (let at: Row | undefined = row; at && !isNull(at["parent_key"]) && d < 64; d++) at = rows.find((r) => r["item_key"] === at?.["parent_key"]);
  return d;
}

const messageOf = (e: unknown): string => (e instanceof VyreErr ? e.error.message : e instanceof Error ? e.message : "The move failed.");

/**
 * Send the renames and moves that wait. `rows` are the mount's items (the engine's list, patched in place by `patch`).
 * Folders go first, parents before children, then files, each group in the order of the rows, so a folder is where it should be before what moved into it is sent.
 */
export async function pushMoves(ctx: Ctx, m: MountRec, provider: Provider, rows: Row[], patch: Patch): Promise<MovesPushed> {
  const res: MovesPushed = { moved: 0, held: 0, errors: [] };
  if (!provider.pushes || m.pullOnly) return res;
  const settle = (e: unknown): void => {
    if (e instanceof VyreErr && e.error.code === "permission.needs_approval") res.held += 1;
    else res.errors.push(messageOf(e));
  };
  const candidates = rows
    .filter((r) => flag(r["dirty"]) && !flag(r["deleted"]) && !flag(r["conflict"]) && !flag(r["native"]) && !isNull(r["parent_key"]) && (!isNull(r["file_id"]) || !isNull(r["folder_id"])))
    .filter((r) => !isNull(r["remote_id"]) || str(r["name"]) === "")
    .sort((a, b) => (flag(b["is_folder"]) ? 1 : 0) - (flag(a["is_folder"]) ? 1 : 0) || depthOf(rows, a) - depthOf(rows, b));

  for (const row of candidates) {
    try {
      const here = await lookHere(ctx, row);
      if (!here) continue;
      const target = rows.find((r) => flag(r["is_folder"]) && r["folder_id"] === here.folderId && r["mount_id"] === row["mount_id"] && !flag(r["deleted"]));
      if (!target) {
        // it is not in this mounted folder any more: the delete step removes it at the provider
        patch(row, { deleted: 1 });
        res.moved += 1;
        continue;
      }
      if (isNull(row["remote_id"])) {
        // adopted from outside: it only lacked its name and parent; the normal push creates it
        patch(row, { name: here.name, parent_key: target["item_key"] });
        res.moved += 1;
        continue;
      }
      if (here.name === str(row["name"]) && target["item_key"] === row["parent_key"]) continue; // a content change, not a move: the upload step sends it
      const parentRemote = isNull(target["remote_id"]) ? undefined : str(target["remote_id"]);
      if (parentRemote === undefined) continue; // the new parent is not at the provider yet; the next pass
      const oldRemote = str(row["remote_id"]);
      if (flag(row["is_folder"])) {
        if (!provider.createFolder || !provider.remove) continue;
        const made = await provider.createFolder(ctx, m, { name: here.name, parentRemote });
        for (const d of subtreeOf(rows, row).slice(1)) patch(d, { remote_id: null, remote_version: null, dirty: 1 });
        patch(row, { name: here.name, parent_key: target["item_key"], remote_id: made.remoteId, dirty: 0 });
        res.moved += 1;
        await provider.remove(ctx, m, oldRemote, true);
      } else {
        if (!provider.upload || !provider.remove) continue;
        const up = await provider.upload(ctx, m, { fileId: str(row["file_id"]), name: here.name, parentRemote });
        patch(row, { name: here.name, parent_key: target["item_key"], remote_id: up.remoteId, remote_version: up.version ?? null, synced_version: row["local_version"] ?? null, dirty: 0 });
        res.moved += 1;
        await provider.remove(ctx, m, oldRemote, false);
      }
    } catch (e) {
      settle(e);
    }
  }
  return res;
}
