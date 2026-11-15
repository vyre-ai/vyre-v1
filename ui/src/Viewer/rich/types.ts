// What the viewer hands a rich file body (PDF pages, a workbook grid, a Word page, a deck): the pieces of its own toolbar the body needs to answer. The body draws the file; the viewer keeps the toolbar,
// Find's box and count, comments, History, Ask and the side panes, so every kind of file has the same toolbar.
import type { ReactElement } from "react";

export interface RichCtx {
  find: string;
  /** The current match of Find: the viewer's block it is in and which of that block's matches it is. */
  hit: { block: number; occurrence: number } | null;
  zoom: number;
  tool: "comment" | "redact" | null;
  thumbs: boolean;
  jump: { page: number; n: number } | null;
  /** Edit mode is on (a workbook or a Word file takes typing only then). */
  edit: boolean;
  setZoom: (z: number) => void;
  setPage: (page: number) => void;
  setPages: (count: number) => void;
}

export type RichBody = (c: RichCtx) => ReactElement;
