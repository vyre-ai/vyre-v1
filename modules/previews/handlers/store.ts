// The image store of previews (P-L4_07b): thumbnails and page images are kept as blobs (ctx.blobs), and previews_image keeps only the blob id, content type, size and dimensions.
// previews.get, thumbnails and pages return a blob reference `/spaces/<space>/blobs/<blobId>` as `url`. A reference is never a data address: no image bytes sit in a table or in a response.
//
//   putImage     stores the bytes first, then swaps the row, then deletes the blob the row pointed at before (a failure in between leaves the old image whole, at worst one blob to collect)
//   dropImages   deletes the blobs of one version (or of every version of a file), then their rows
//   sweepGc      deletes the blobs that the file.purged projection could only list (a projection has no blob port); run at the start of every render pass
// Blob ids are opaque to this module's callers; a module sees only blobs it stored itself, so a reference made by another module never resolves here.

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { BlobMeta, Ctx } from "../../../packages/contracts/src/ctx.ts";

type Row = Record<string, unknown>;

/** One made image: its place in the preview and its PNG bytes. */
export interface StoredImage { kind: "thumb" | "page"; size: string; page: number; bytes: Uint8Array; width: number; height: number }

export const IMAGE_TYPE = "image/png";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function blobsOf(ctx: Ctx): NonNullable<Ctx["blobs"]> {
  if (ctx.blobs) return ctx.blobs;
  throw new VyreErr({
    code: "internal.unexpected",
    message: "The blob store is not available, so previews cannot keep images.",
    retryable: false,
    traceId: ctx.trace.traceId,
    next: [{ kind: "report", label: "Report a problem" }],
    details: { why: "ctx.blobs is missing" },
  });
}

export function imageRows(ctx: Ctx, fileId: string, version: number): Row[] {
  return ctx.db.all("SELECT * FROM previews_image WHERE file_id = ? AND version = ?", fileId, version) as Row[];
}

export function findImage(ctx: Ctx, fileId: string, version: number, kind: string, size: string, page: number): Row | undefined {
  return imageRows(ctx, fileId, version).find((r) => r["kind"] === kind && r["size"] === size && r["page"] === page);
}

/** The reference a client uses for one stored image. */
export function blobRef(ctx: Ctx, row: Row): string {
  return `/spaces/${ctx.space}/blobs/${str(row["blob_id"])}`;
}

/** Keeps one image as a blob and points the row (file, version, kind, size, page) at it. Returns the blob's metadata. */
export async function putImage(ctx: Ctx, fileId: string, version: number, m: StoredImage): Promise<BlobMeta> {
  const blobs = blobsOf(ctx);
  const meta = await blobs.put(m.bytes, IMAGE_TYPE);
  const old = findImage(ctx, fileId, version, m.kind, m.size, m.page);
  ctx.db.run("DELETE FROM previews_image WHERE file_id = ? AND version = ? AND kind = ? AND size = ? AND page = ?", fileId, version, m.kind, m.size, m.page);
  ctx.db.run(
    "INSERT INTO previews_image (file_id, version, kind, size, page, blob_id, content_type, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    fileId, version, m.kind, m.size, m.page, meta.id, meta.contentType, meta.size, m.width, m.height, ctx.now(),
  );
  if (old && str(old["blob_id"]) !== meta.id) await blobs.delete(str(old["blob_id"]));
  return meta;
}

/** Deletes the images of one version, or of every version when `version` is omitted: blobs first, then rows. */
export async function dropImages(ctx: Ctx, fileId: string, version?: number): Promise<number> {
  const rows = (ctx.db.all("SELECT * FROM previews_image WHERE file_id = ?", fileId) as Row[]).filter((r) => version === undefined || r["version"] === version);
  if (rows.length === 0) return 0;
  const blobs = blobsOf(ctx);
  for (const r of rows) await blobs.delete(str(r["blob_id"]));
  for (const r of rows) {
    ctx.db.run("DELETE FROM previews_image WHERE file_id = ? AND version = ? AND kind = ? AND size = ? AND page = ?", fileId, r["version"], r["kind"], r["size"], r["page"]);
  }
  return rows.length;
}

/** Deletes the blobs left by purged files. Returns how many were collected. */
export async function sweepGc(ctx: Ctx): Promise<number> {
  const rows = ctx.db.all("SELECT * FROM previews_gc") as Row[];
  if (rows.length === 0) return 0;
  const blobs = blobsOf(ctx);
  for (const r of rows) {
    await blobs.delete(str(r["blob_id"]));
    ctx.db.run("DELETE FROM previews_gc WHERE blob_id = ?", r["blob_id"]);
  }
  return rows.length;
}
