// What a person can do to a file in the Viewer, one capability call each, as plain functions: the screen wires them to its controls and the tests call them directly.
import type { Anchor, DocBlock, Stroke } from "../../../../../../ui/src/Viewer/index.tsx";
import type { FilesViewerData } from "./data.tsx";
import { blocksToText, strokesToSave } from "./model.ts";
import type { FileKind } from "./model.ts";

const key = (what: string, fileId: string, now: number): string => `${what}-${fileId}-${now}-${Math.round(Math.random() * 1e9)}`;

/** A numbered pin on an area of an image: a comment anchored to the box (unit coordinates, so it stays put at any zoom). */
export async function pinArea(d: FilesViewerData, fileId: string, box: Anchor, text: string): Promise<void> {
  await d.call("files.comments.add", { fileId, anchor: { kind: "area", box: { x: box.x, y: box.y, w: box.w, h: box.h } }, text, idempotencyKey: key("pin", fileId, d.clock().now) });
}

/** A comment on a passage of a document: anchored to the quote. */
export async function commentOnQuote(d: FilesViewerData, fileId: string, quote: string, text: string): Promise<void> {
  await d.call("files.comments.add", { fileId, anchor: { kind: "range", quote }, text, idempotencyKey: key("comment", fileId, d.clock().now) });
}

export async function resolveComment(d: FilesViewerData, commentId: string): Promise<void> {
  await d.call("files.comments.resolve", { commentId, resolved: true });
}

/** Freehand drawing on an image replaces the file's markup. */
export async function saveMarkup(d: FilesViewerData, fileId: string, strokes: readonly Stroke[]): Promise<void> {
  await d.call("files.markup.save", { fileId, strokes: strokesToSave(strokes) });
}

/** An edit in place saves the text against the version it started from; the new version is returned so the next save starts from it. A save over someone else's newer version is refused by the capability. */
export async function saveText(d: FilesViewerData, fileId: string, blocks: readonly DocBlock[], kind: FileKind, baseVersion: number): Promise<number> {
  const out = (await d.call("files.save", { fileId, text: blocksToText(blocks, kind), baseVersion, reason: "Edited in the viewer" })) as { file?: { version?: number } } | undefined;
  return out?.file?.version ?? baseVersion + 1;
}
