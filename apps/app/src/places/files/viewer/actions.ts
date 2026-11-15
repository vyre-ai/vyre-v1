// What a person can do to a file in the Viewer, one capability call each, as plain functions: the screen wires them to its controls and the tests call them directly.
import type { Anchor, DocBlock, Stroke } from "../../../../../../ui/src/Viewer/index.tsx";
import type { FilesViewerData } from "./data.tsx";
import { blocksToText, strokesToSave } from "./model.ts";
import type { FileKind } from "./model.ts";

const key = (what: string, fileId: string, now: number): string =>
  `${what}-${fileId}-${now}-${Math.round(Math.random() * 1e9)}`;

/** A numbered pin on an area of an image: a comment anchored to the box (unit coordinates, so it stays put at any zoom). */
export async function pinArea(d: FilesViewerData, fileId: string, box: Anchor, text: string): Promise<void> {
  await d.call("files.comments.add", {
    fileId,
    anchor: { kind: "area", box: { x: box.x, y: box.y, w: box.w, h: box.h } },
    text,
    idempotencyKey: key("pin", fileId, d.clock().now),
  });
}

/** A comment on a passage of a document: anchored to the quote. */
export async function commentOnQuote(d: FilesViewerData, fileId: string, quote: string, text: string): Promise<void> {
  await d.call("files.comments.add", {
    fileId,
    anchor: { kind: "range", quote },
    text,
    idempotencyKey: key("comment", fileId, d.clock().now),
  });
}

export async function resolveComment(d: FilesViewerData, commentId: string): Promise<void> {
  await d.call("files.comments.resolve", { commentId, resolved: true });
}

/** Freehand drawing on an image replaces the file's markup. */
export async function saveMarkup(d: FilesViewerData, fileId: string, strokes: readonly Stroke[]): Promise<void> {
  await d.call("files.markup.save", { fileId, strokes: strokesToSave(strokes) });
}

/** An edit in place saves the text against the version it started from; the new version is returned so the next save starts from it. A save over someone else's newer version is refused by the capability. */
export async function saveText(
  d: FilesViewerData,
  fileId: string,
  blocks: readonly DocBlock[],
  kind: FileKind,
  baseVersion: number,
): Promise<number> {
  const out = (await d.call("files.save", {
    fileId,
    text: blocksToText(blocks, kind),
    baseVersion,
    reason: "Edited in the viewer",
  })) as { n?: number; file?: { version?: number } } | undefined;
  return out?.n ?? out?.file?.version ?? baseVersion + 1;
}

/** A comment on a place of a page: an area (a point when the box is tiny) with the page it is on, and the selected words when there were some. */
export async function commentOnPage(
  d: FilesViewerData,
  fileId: string,
  at: { page: number; box: Anchor; quote?: string },
  text: string,
): Promise<void> {
  await d.call("files.comments.add", {
    fileId,
    anchor: {
      kind: "area",
      page: at.page,
      box: { x: at.box.x, y: at.box.y, w: at.box.w, h: at.box.h },
      ...(at.quote ? { quote: at.quote.slice(0, 500) } : {}),
    },
    text,
    idempotencyKey: key("pagepin", fileId, d.clock().now),
  });
}

/** The most a capability takes as base64 in one call; over it the bytes go to a one-time upload address first (files.upload_url) and the call names the blob. */
const DIRECT_LIMIT = 192 * 1024;

const toB64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The `content` of files.create and files.write for these bytes: inline when small, else an uploaded blob. */
export async function contentFor(
  d: FilesViewerData,
  bytes: Uint8Array,
  mime: string,
): Promise<{ base64: string } | { blobId: string }> {
  if (bytes.length <= DIRECT_LIMIT) return { base64: toB64(bytes) };
  if (!d.putBlob) throw new Error("This file is too large to save here.");
  const slot = (await d.call("files.upload_url", { size: bytes.length, mime })) as { url: string; blobId: string };
  await d.putBlob(slot.url, bytes);
  return { blobId: slot.blobId };
}
