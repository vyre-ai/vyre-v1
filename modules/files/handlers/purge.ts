// Remove old file versions past retention (governance; P-CC_39). A version is removed when it is older than the cutoff, is not its file's newest, and has no name; a named version is the person's own keep.
// A file the caller lists in skipFileIds is left whole: governance passes the files under a hold, which this module does not know about. The blob a removed version held is released, and goes with its last version.
// DECISION: oldest first, one batch per call; `more` says another call has work. The scan reads the version rows and filters them here, so it needs nothing the plain tree queries do not.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { many, num, one } from "./tree.ts";

type Row = Record<string, unknown>;
const DEFAULT_LIMIT = 500;

function release(ctx: Ctx, blobId: string): void {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) return;
  const next = num(row.refs) - 1;
  if (next <= 0) ctx.db.run("DELETE FROM files_blob WHERE id = ?", blobId);
  else ctx.db.run("UPDATE files_blob SET refs = ? WHERE id = ?", next, blobId);
}

async function versionsPurge(ctx: Ctx, input: unknown) {
  const o = (input ?? {}) as { before: number; limit?: number; skipFileIds?: string[] };
  const limit = o.limit ?? DEFAULT_LIMIT;
  const skip = new Set(o.skipFileIds ?? []);
  const rows = many(ctx, "SELECT * FROM files_file_version");
  const newest = new Map<string, number>();
  for (const v of rows) newest.set(String(v.file_id), Math.max(newest.get(String(v.file_id)) ?? 0, num(v.n)));
  const due: Row[] = rows
    .filter((v) => num(v.at) < o.before && (v.name === null || v.name === undefined || v.name === "") && num(v.n) < (newest.get(String(v.file_id)) ?? 0) && !skip.has(String(v.file_id)))
    .sort((a, b) => num(a.at) - num(b.at) || String(a.id).localeCompare(String(b.id)));
  const batch = due.slice(0, limit);
  for (const v of batch) {
    ctx.db.run("DELETE FROM files_file_version WHERE id = ?", String(v.id));
    release(ctx, String(v.blob));
  }
  ctx.emit("file_versions.purged", `entity/${batch.length}`, { removed: batch.length });
  return { removed: batch.length, more: due.length > limit };
}

export const purgeHandlers = { "files.versions.purge": versionsPurge };
