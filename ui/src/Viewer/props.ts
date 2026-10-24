// Frozen props for ui/Viewer (spec 2.16, ARCH 7.5).
// One viewer for every file type. Markup pins are numbered. The side pane keeps the chat beside the file.

import type { Density } from "../kit/types.ts";

export const VIEWER_KINDS = ["image", "document", "csv", "plan", "other"] as const;

export type ViewerKind = (typeof VIEWER_KINDS)[number];

export const MARKUP_TOOLS = ["draw", "comment", "highlight"] as const;

export type MarkupTool = (typeof MARKUP_TOOLS)[number];

export type ViewerPane = "main" | "side";

export interface ViewerPin {
  id: string;
  n: number;
  text: string;
}

export interface ViewerProps {
  fileId: string;
  title: string;
  kind: ViewerKind;
  pane?: ViewerPane;
  find?: string;
  tool?: MarkupTool;
  pins?: readonly ViewerPin[];
  /** Plans and documents can be edited in place. */
  editing?: boolean;
  density?: Density;
  onFind?: (query: string) => void;
  onPin?: (pin: { text: string }) => void;
}

export function viewerLabel(props: ViewerProps): string {
  return props.title.length > 0 ? props.title : "Viewer";
}
