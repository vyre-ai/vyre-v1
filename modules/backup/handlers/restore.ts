// Restore, preview and verify (spec 5 Backups and export, 2.26; ARCH 7.10).
// A restore takes a fresh backup first (so it can be undone), merges every tombstone that exists (the live log's, the target's list and the archive's),
// puts the data back and replays the tombstones before the Space opens for traffic, then checks the hash chain. Erased data never comes back.

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import {
  asRow, describeTarget, failWith, findItem, findItemOrIndex, markVerified, mergeTombstones, mint, need, openTarget, readConfig, readTombstones, unpack, unwrap,
} from "./run.ts";
import type { ApplyResult, BackupCtx, BackupTarget, Item, SpaceSnapshot, Tombstone } from "./run.ts";

/** A restore reads the archive at about this rate (bytes a second) when the preview estimates the time the Space is closed. */
const RESTORE_BYTES_PER_SECOND = 20_000_000;
const RESTORE_FIXED_SECONDS = 5;

async function targetAndItem(ctx: BackupCtx, backupId: string): Promise<{ target: BackupTarget; item: Item }> {
  const cfg = readConfig(ctx);
  if (!cfg.target) return failWith(ctx.trace.traceId, "validation.precondition_failed", "Choose where backups go first.");
  const target = await openTarget(ctx, cfg.target);
  const item = await findItemOrIndex(ctx, target, backupId, describeTarget(cfg.target));
  if (!item) return failWith(ctx.trace.traceId, "validation.not_found", "There is no backup with that id.", { backupId });
  return { target, item };
}

async function openArchive(ctx: BackupCtx, target: BackupTarget, item: Item): Promise<{ snapshot: SpaceSnapshot; tombstones: Tombstone[] }> {
  const blob = await target.get(item.objectKey);
  if (!blob) return failWith(ctx.trace.traceId, "validation.not_found", "The backup file is no longer on the target.", { backupId: item.backupId });
  try {
    const { header, entries } = await unpack(unwrap(ctx, blob));
    if (header.backupId !== item.backupId) throw new Error("the archive belongs to another backup");
    return { snapshot: { fromSeq: header.fromSeq, toSeq: header.toSeq, headHash: header.headHash, entries }, tombstones: header.tombstones };
  } catch (e) {
    return failWith(ctx.trace.traceId, "validation.precondition_failed", `The backup cannot be opened: ${e instanceof Error ? e.message : "unreadable"}`, { backupId: item.backupId });
  }
}

export async function restore_preview(ctx: BackupCtx, input: { backupId: string }) {
  const d = need(ctx);
  const { target, item } = await targetAndItem(ctx, input.backupId);
  const [head, live, listed] = await Promise.all([d.source.head(), d.source.tombstones(), readTombstones(ctx, target).catch(() => [] as Tombstone[])]);
  const tombstones = mergeTombstones(live, listed).length;
  return {
    fromSeq: item.seq,
    toSeq: Math.max(head.seq, item.seq),
    tombstones: Math.max(tombstones, item.tombstones),
    downtimeSeconds: RESTORE_FIXED_SECONDS + Math.ceil(item.sizeBytes / RESTORE_BYTES_PER_SECOND),
  };
}

export async function restore(ctx: BackupCtx, input: { backupId: string; confirm: true }) {
  const d = need(ctx);
  if (input.confirm !== true) return failWith(ctx.trace.traceId, "validation.bad_input", "Confirm the restore to go on.");
  const { target, item } = await targetAndItem(ctx, input.backupId);
  const runId = ctx.run ?? mint("run");

  // the archive is read and checked before anything is touched, so a damaged file stops here with the Space as it was
  const { snapshot, tombstones: inArchive } = await openArchive(ctx, target, item);

  // A fresh backup first: the way back if the restore is not what the admin wanted. It goes through backup.run so it is a run of its own, audited and
  // announced (backup.completed or backup.failed) like any other, and only a backup that finished lets the restore start.
  const safety = asRow(await ctx.call("backup.run" as never, { idempotencyKey: `restore:${runId}:safety-backup` }));
  const safetyId = typeof safety?.["backupId"] === "string" ? safety["backupId"] : "";
  if (!findItem(ctx, safetyId)) {
    const why = asRow(ctx.db.all("SELECT reason FROM backup_item WHERE backup_id = ?", safetyId)[0])?.["reason"];
    return failWith(ctx.trace.traceId, "validation.precondition_failed", `The safety backup before the restore failed, so nothing was changed: ${typeof why === "string" ? why : "unknown reason"}`);
  }

  const tombstones = mergeTombstones(await d.source.tombstones(), await readTombstones(ctx, target).catch(() => [] as Tombstone[]), inArchive);
  let result: ApplyResult;
  try {
    result = await d.source.restore(snapshot, tombstones, "live");
  } catch (e) {
    if (e instanceof VyreErr) throw e;
    return failWith(ctx.trace.traceId, "internal.unexpected", `The restore did not finish: ${e instanceof Error ? e.message : "unknown error"}. The safety backup ${safetyId} holds the state from before.`, { safetyBackupId: safetyId });
  }
  if (!result.chainOk) return failWith(ctx.trace.traceId, "internal.unexpected", `The restored log did not verify. The safety backup ${safetyId} holds the state from before.`, { safetyBackupId: safetyId });
  ctx.emit("backup.restored" as never, `entity/${item.backupId}`, { backupId: item.backupId, tombstonesReplayed: result.replayed });
  return { runId };
}

export async function verify(ctx: BackupCtx, input: { backupId: string }) {
  const d = need(ctx);
  const { target, item } = await targetAndItem(ctx, input.backupId);
  const { snapshot, tombstones } = await openArchive(ctx, target, item);
  if (snapshot.headHash !== item.headHash && item.headHash !== "") return failWith(ctx.trace.traceId, "validation.precondition_failed", "The backup's head hash differs from the one recorded when it was taken.", { backupId: item.backupId });
  const result = await d.source.restore(snapshot, tombstones, "scratch");
  if (result.chainOk) {
    markVerified(ctx, item.backupId);
    ctx.emit("backup.verified" as never, `entity/${item.backupId}`, { backupId: item.backupId });
  }
  return { ok: result.chainOk, checkedEvents: result.checkedEvents };
}
