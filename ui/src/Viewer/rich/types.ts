// What the viewer hands a rich file body (PDF pages, a workbook grid, a Word page, a deck): the pieces of its own toolbar the body needs to answer. The body draws the file; the viewer keeps the toolbar,
// Find's box and count, comments, History, Ask and the side panes, so every kind of file has the same toolbar.
import type { ReactElement } from "react";

/** A stretch of a block's text the viewer marks: a Find match (the current one is "find-on"), a redaction or highlight of Redact for AI, a place a comment is on. */
export interface DecorRange {
  s: number;
  e: number;
  kind: "find" | "find-on" | "redact" | "highlight" | "comment";
  id?: string;
}

export interface RichCtx {
  find: string;
  /** The current match of Find: the viewer's block it is in and which of that block's matches it is. */
  hit: { block: number; occurrence: number } | null;
  zoom: number;
  tool: "comment" | "redact" | null;
  thumbs: boolean;
  jump: { page: number; n: number } | null;
  /** The marks to draw on block `bi` (its text as the viewer's Find reads it). */
  decor: (bi: number) => DecorRange[];
  /** Edit mode is on (a workbook or a Word file takes typing only then). */
  edit: boolean;
  setZoom: (z: number) => void;
  setPage: (page: number) => void;
  setPages: (count: number) => void;
}

export type RichBody = (c: RichCtx) => ReactElement;
