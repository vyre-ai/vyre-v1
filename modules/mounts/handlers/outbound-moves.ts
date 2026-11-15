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
// What the providers can do (15 Nov 2026): Drive and Graph rename and move the SAME item (google.drive.update_file, ms.drive.update_item), so its id, links and sharing stay and a folder keeps its
// contents. A provider without that (Dropbox here) still gets create-then-remove: the item is created under its new name and parent and only after that succeeded is the old one removed.
// A delete in Vyre puts the provider's item in its own Trash (recoverable there); a restore from Vyre's Trash takes it back out. A file moved OUT of the mounted folder leaves the provider's file
// where it is (a copy stays there and comes back into the mounted folder on the next listing): nothing of the person's is removed by a move.
// A local folder is moved by its device and a GitHub mount by git (a commit), so for those two nothing goes out from here and nothing is marked.
//
// Limit: a folder moved INTO a mounted folder becomes one folder item; the files inside it are not adopted (they have no items). Move the files instead, or sync from the provider.

import { mintUuid } from "../../../lib/ids.ts";
import { vyreErrorOf } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { MountRec, Provider } from "./providers.ts";
import { displayName, freeNames } from "./names.ts";

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

const itemOfFile = (tx: ProjTx, fileId: string): Row | undefined =>
  (tx.all("SELECT * FROM mounts_item WHERE file_id = ?", fileId) as Row[])[0];
const folderItem = (tx: ProjTx, folderId: string): Row | undefined =>
  (tx.all("SELECT * FROM mounts_item WHERE folder_id = ? AND is_folder = ?", folderId, 1) as Row[])[0];

function liveMount(tx: ProjTx, id: string): Row | undefined {
  const m = (tx.all("SELECT * FROM mounts_mount WHERE id = ?", id) as Row[])[0];
  return m && m["deleted_at"] === null ? m : undefined;
}

/** Only a provider Vyre writes to takes moves from here (Drive, SharePoint, OneDrive, Dropbox); a local folder and a GitHub mount do their own. */
const goesOut = (mount: Row): boolean =>
  mount["kind"] === "google_drive" ||
  mount["kind"] === "sharepoint" ||
  mount["kind"] === "onedrive" ||
  mount["kind"] === "dropbox";

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
  tx.run(
    "UPDATE mounts_item SET dirty = ?, op_seq = ? WHERE mount_id = ? AND item_key = ?",
    1,
    (typeof row["op_seq"] === "number" ? row["op_seq"] : 0) + 1,
    row["mount_id"],
    row["item_key"],
  );
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
  if (flag(mount?.["pull_only"])) {
    // a mount Vyre does not write to keeps the item; the delete stays in Vyre
    return;
  }
  tx.run(
    "UPDATE mounts_item SET deleted = ?, dirty = ?, op_seq = ? WHERE mount_id = ? AND item_key = ?",
    1,
    1,
    (typeof row["op_seq"] === "number" ? row["op_seq"] : 0) + 1,
    row["mount_id"],
    row["item_key"],
  );
  if (mount) startClock(tx, mount, at);
}

/** The item stops being mapped, with everything below it, and the provider is not touched: what the person moved out of the mounted folder stays at the provider too. */
function letGo(tx: ProjTx, row: Row): void {
  const keys = [str(row["item_key"])];
  for (let i = 0; i < keys.length; i++)
    for (const c of tx.all(
      "SELECT * FROM mounts_item WHERE mount_id = ? AND parent_key = ?",
      row["mount_id"],
      keys[i],
    ) as Row[])
      keys.push(str(c["item_key"]));
  for (const k of keys) tx.run("DELETE FROM mounts_item WHERE mount_id = ? AND item_key = ?", row["mount_id"], k);
}

function adopt(
  tx: ProjTx,
  into: { parent: Row; mount: Row },
  a: { fileId?: string; folderId?: string; name: string; at: number },
): void {
  tx.run(
    "INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, remote_version, synced_version, local_version, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    into.mount["id"],
    `itm_${mintUuid(a.at).replaceAll("-", "")}`,
    null,
    into.parent["item_key"],
    a.fileId ?? null,
    a.folderId ?? null,
    a.name,
    a.folderId !== undefined ? 1 : 0,
    0,
    null,
    a.fileId !== undefined ? 0 : null,
    a.fileId !== undefined ? 1 : null,
    1,
    0,
    0,
  );
  startClock(tx, into.mount, a.at);
}

/** The item is renamed or moved in Vyre. Not yet at the provider: the row just follows. At the provider: it waits to be moved there. */
function follow(tx: ProjTx, row: Row, at: number, change: { name?: string; parentKey?: unknown }): void {
  if (flag(row["deleted"])) return;
  // The engine's own pull gives an item the name and the folder the provider has: that is not a change made in Vyre, and nothing is queued for it (the engine records the name it gives, and the
  // folder, before it asks Files, so the event finds the row already agreeing)
  const sameName = change.name === undefined || change.name === row["shown_name"];
  const sameParent = change.parentKey === undefined || change.parentKey === row["parent_key"];
  if (sameName && sameParent) return;
  if (isNull(row["remote_id"])) {
    if (change.name !== undefined)
      tx.run(
        "UPDATE mounts_item SET name = ? WHERE mount_id = ? AND item_key = ?",
        change.name,
        row["mount_id"],
        row["item_key"],
      );
    if (change.parentKey !== undefined)
      tx.run(
        "UPDATE mounts_item SET parent_key = ? WHERE mount_id = ? AND item_key = ?",
        change.parentKey,
        row["mount_id"],
        row["item_key"],
      );
    return;
  }
  markDirty(tx, row, at);
}

export function onFileRenamed(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const row = itemOfFile(tx, str(p["fileId"]));
  if (row) follow(tx, row, e.at, { name: str(p["to"]) });
}

export function onFileMoved(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const fileId = str(p["fileId"]);
  const to = destination(tx, str(p["toFolderId"]));
  const row = itemOfFile(tx, fileId);
  if (row && to && row["mount_id"] === to.mount["id"]) {
    follow(tx, row, e.at, { parentKey: to.parent["item_key"] });
    return;
  }
  // out of this mount (to nowhere, or to another mount): the provider's file stays where it is
  if (row) letGo(tx, row);
  // into a mount: created there (the name comes from the row it had, or from the files module at push time)
  if (to) adopt(tx, to, { fileId, name: row ? str(row["name"]) : "", at: e.at });
}

/**
 * A file or folder comes back from Vyre's Trash. If its delete never went out, it is simply not deleted any more. If the provider already put it in its own Trash, it is taken out of there.
 * Coming back into a mounted folder that never held it, it is created there like any new file.
 */
export function onFileRestored(tx: ProjTx, e: ProjEvent): void {
  const p = payloadOf(e.payload);
  const fileId = str(p["fileId"]);
  const to = destination(tx, str(p["folderId"]));
  const row = itemOfFile(tx, fileId);
  if (row && flag(row["deleted"])) return revive(tx, row, e.at);
  if (!row && to) adopt(tx, to, { fileId, name: "", at: e.at });
}

export function onFolderRestored(tx: ProjTx, e: ProjEvent): void {
  const row = folderItem(tx, str(payloadOf(e.payload)["folderId"]));
  if (row && flag(row["deleted"])) revive(tx, row, e.at);
}

function revive(tx: ProjTx, row: Row, at: number): void {
  const mount = liveMount(tx, str(row["mount_id"]));
  if (!mount || !goesOut(mount)) return;
  // The item is looked at again by the next pass, whatever waited on it (a move or rename made before the delete, an edit, the provider's Trash): the push compares and clears what turns out to be nothing.
  tx.run(
    "UPDATE mounts_item SET deleted = ?, dirty = ?, op_seq = ? WHERE mount_id = ? AND item_key = ?",
    0,
    1,
    (typeof row["op_seq"] === "number" ? row["op_seq"] : 0) + 1,
    row["mount_id"],
    row["item_key"],
  );
  startClock(tx, mount, at);
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
  if (row) letGo(tx, row);
  if (to) adopt(tx, to, { folderId, name: row ? str(row["name"]) : "", at: e.at });
}

export const movesConsumer = {
  on: {
    "file.renamed": onFileRenamed,
    "file.moved": onFileMoved,
    "folder.renamed": onFolderRenamed,
    "folder.moved": onFolderMoved,
    "file.restored": onFileRestored,
    "folder.restored": onFolderRestored,
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

interface Here {
  name: string;
  folderId: string;
}

/** What Vyre calls the item now and the folder it sits in; undefined when the files module no longer has it. */
async function lookHere(ctx: Ctx, row: Row): Promise<Here | undefined> {
  try {
    if (flag(row["is_folder"])) {
      const got = (await ctx.call("files.folder.get", { folderId: str(row["folder_id"]) })) as {
        folder?: { name?: unknown; parentId?: unknown };
      };
      const f = got.folder;
      return typeof f?.name === "string" && typeof f.parentId === "string"
        ? { name: f.name, folderId: f.parentId }
        : undefined;
    }
    const got = (await ctx.call("files.get", { fileId: str(row["file_id"]) })) as {
      file?: { name?: unknown; folderId?: unknown; deletedAt?: unknown };
    };
    const f = got.file;
    return typeof f?.name === "string" && typeof f.folderId === "string" && isNull(f.deletedAt)
      ? { name: f.name, folderId: f.folderId }
      : undefined;
  } catch (e) {
    if (vyreErrorOf(e)?.code === "validation.not_found" || vyreErrorOf(e)?.code === "permission.not_found")
      return undefined;
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
  for (let at: Row | undefined = row; at && !isNull(at["parent_key"]) && d < 64; d++)
    at = rows.find((r) => r["item_key"] === at?.["parent_key"]);
  return d;
}

/** What a failing mount says when an edit looked like a rename of the original: nothing was sent. */
export const notReplaced = (label: string): string =>
  `Could not send this edit to ${label} without replacing the original, so nothing was changed there.`;

/** Every name a pass could have given the item in Files: the provider's name, that name made safe, and its "(Google Drive)" series. */
function namesAPassGives(row: Row, label: string): string[] {
  const name = str(row["name"]);
  return [name, ...freeNames(displayName(name), label)];
}

const messageOf = (e: unknown): string =>
  vyreErrorOf(e)?.message ?? (e instanceof Error ? e.message : "The move failed.");

/** The content of the item changed in Vyre and has not gone out (a rename alone never makes it upload a new revision). */
export const contentWaits = (r: Row): boolean =>
  !flag(r["is_folder"]) &&
  (isNull(r["remote_id"]) || Number(r["local_version"] ?? 0) > Number(r["synced_version"] ?? 0));

/** The key a write carries: the same on a retry of one change, new for the next change of the item. */
export const opKey = (m: { id: string }, row: Row, what: string): string =>
  `mnt:${what}:${m.id}:${str(row["item_key"])}:${Number(row["op_seq"] ?? 0)}`;

/** Why a rename or a move could not go out, in words a person can act on. */
export function waitWords(e: unknown, label: string): string {
  const code = vyreErrorOf(e)?.code ?? "";
  if (code === "provider.unavailable" || code === "provider.network" || code.startsWith("timeout."))
    return `${label} could not be reached. Vyre keeps this change and tries again by itself.`;
  if (code === "provider.rate_limited" || code === "provider.overloaded")
    return `${label} asked Vyre to slow down. Vyre tries again by itself.`;
  if (code === "provider.auth_failed")
    return `${label} did not let Vyre change this. Check that you can edit it there, or reconnect.`;
  return messageOf(e);
}

/**
 * Send the renames and moves that wait. `rows` are the mount's items (the engine's list, patched in place by `patch`).
 * Folders go first, parents before children, then files, each group in the order of the rows, so a folder is where it should be before what moved into it is sent.
 * A provider that renames and moves in place (Drive, Graph) keeps the item: its id, links and sharing stay, and a folder keeps its contents. Another one gets create-then-remove.
 */
export async function pushMoves(
  ctx: Ctx,
  m: MountRec,
  provider: Provider,
  rows: Row[],
  patch: Patch,
): Promise<MovesPushed> {
  const res: MovesPushed = { moved: 0, held: 0, errors: [] };
  if (!provider.pushes || m.pullOnly) return res;
  const settle = (row: Row, e: unknown): void => {
    if (vyreErrorOf(e)?.code === "permission.needs_approval") res.held += 1;
    else {
      patch(row, { wait_reason: waitWords(e, provider.label) });
      // only the provider itself being out of reach or refusing Vyre fails the mount; a change one item cannot take waits on that item
      if (
        vyreErrorOf(e) === undefined ||
        /^(provider\.|timeout\.|auth\.|rate_limit\.|internal\.)/.test(vyreErrorOf(e)?.code ?? "")
      )
        res.errors.push(waitWords(e, provider.label));
    }
  };
  const candidates = rows
    .filter(
      (r) =>
        flag(r["dirty"]) &&
        !flag(r["deleted"]) &&
        !flag(r["conflict"]) &&
        isNull(r["trashed_at"]) &&
        !isNull(r["parent_key"]) &&
        (!isNull(r["file_id"]) || !isNull(r["folder_id"])),
    )
    .filter((r) => !isNull(r["remote_id"]) || str(r["name"]) === "")
    .sort(
      (a, b) => (flag(b["is_folder"]) ? 1 : 0) - (flag(a["is_folder"]) ? 1 : 0) || depthOf(rows, a) - depthOf(rows, b),
    );

  for (const row of candidates) {
    try {
      const here = await lookHere(ctx, row);
      if (!here) continue;
      const target = rows.find(
        (r) =>
          flag(r["is_folder"]) &&
          r["folder_id"] === here.folderId &&
          r["mount_id"] === row["mount_id"] &&
          !flag(r["deleted"]),
      );
      if (!target) {
        // it is not in this mounted folder any more: the provider's copy stays where it is, and the item stops being sent
        patch(row, { dirty: 0, wait_reason: null });
        continue;
      }
      if (isNull(row["remote_id"])) {
        // adopted from outside: it only lacked its name and parent; the normal push creates it
        patch(row, { name: here.name, parent_key: target["item_key"] });
        res.moved += 1;
        continue;
      }
      // a content change, not a rename or a move: the upload step sends it. Files' name is compared with the name the pass gave the item (shown_name), never with the provider's own, which
      // Files may not hold ("Q3/Q4 plan.pdf" is shown as "Q3-Q4 plan.pdf"). A row from before shown_name also accepts any name a pass would have given it.
      const unchanged = !isNull(row["shown_name"])
        ? here.name === str(row["shown_name"])
        : here.name === str(row["name"]) ||
          freeNames(displayName(str(row["name"])), provider.label).includes(here.name);
      if (unchanged && target["item_key"] === row["parent_key"]) {
        // nothing to rename or move: an item that only looked changed (the pass's own rename) waits for nothing, and sends no new revision
        if (!contentWaits(row)) patch(row, { dirty: 0, wait_reason: null });
        continue;
      }
      // The belt (14 Nov 2026): a name any pass could have given the item (the provider's own, its safe display name, or the "(Google Drive)" series) is never a rename. If the compare above still
      // read it as one, a content edit would be sent as "make a new file, trash the original": that is refused, nothing at the provider is touched, and the item is flagged for a person.
      if (target["item_key"] === row["parent_key"] && namesAPassGives(row, provider.label).includes(here.name)) {
        patch(row, { conflict: 1 });
        res.errors.push(notReplaced(provider.label));
        continue;
      }
      const parentRemote = isNull(target["remote_id"]) ? undefined : str(target["remote_id"]);
      if (parentRemote === undefined) continue; // the new parent is not at the provider yet; the next pass
      const oldRemote = str(row["remote_id"]);
      const moved = target["item_key"] !== row["parent_key"];
      const oldParent = rows.find((r) => r["item_key"] === row["parent_key"]);
      const content = contentWaits(row) ? 1 : 0;
      if (provider.update) {
        const done = await provider.update(ctx, m, {
          remoteId: oldRemote,
          ...(unchanged ? {} : { name: here.name }),
          ...(moved
            ? {
                addParent: parentRemote,
                ...(oldParent && !isNull(oldParent["remote_id"]) ? { removeParent: str(oldParent["remote_id"]) } : {}),
              }
            : {}),
          key: opKey(m, row, "mv"),
        });
        // a rename or move changes the provider's modified time (and Graph's eTag) though not the content: the row takes the new ones, or the next listing would read the item as changed there
        // and flag an edit still waiting as a conflict with the person's own rename
        const current = !isNull(row["remote_version"]) && row["cached_version"] === row["remote_version"];
        patch(row, {
          name: here.name,
          shown_name: here.name,
          parent_key: target["item_key"],
          remote_id: done.remoteId,
          dirty: content,
          wait_reason: null,
          ...(done.version !== undefined
            ? { remote_version: done.version, ...(current ? { cached_version: done.version } : {}) }
            : {}),
          ...(done.revision !== undefined ? { remote_rev: done.revision } : {}),
        });
        res.moved += 1;
        continue;
      }
      if (flag(row["is_folder"])) {
        if (!provider.createFolder || !provider.remove) continue;
        const made = await provider.createFolder(ctx, m, {
          name: here.name,
          parentRemote,
          key: opKey(m, row, "mvfld"),
        });
        for (const d of subtreeOf(rows, row).slice(1)) patch(d, { remote_id: null, remote_version: null, dirty: 1 });
        patch(row, {
          name: here.name,
          shown_name: here.name,
          parent_key: target["item_key"],
          remote_id: made.remoteId,
          dirty: 0,
          wait_reason: null,
        });
        res.moved += 1;
        await provider.remove(ctx, m, oldRemote, true, opKey(m, row, "mvrm"));
      } else {
        if (!provider.upload || !provider.remove) continue;
        const up = await provider.upload(ctx, m, {
          fileId: str(row["file_id"]),
          name: here.name,
          parentRemote,
          key: opKey(m, row, "mvup"),
        });
        patch(row, {
          name: here.name,
          shown_name: here.name,
          parent_key: target["item_key"],
          remote_id: up.remoteId,
          remote_version: up.version ?? null,
          synced_version: row["local_version"] ?? null,
          dirty: 0,
          wait_reason: null,
        });
        res.moved += 1;
        await provider.remove(ctx, m, oldRemote, false, opKey(m, row, "mvrm"));
      }
    } catch (e) {
      settle(row, e);
    }
  }
  return res;
}
