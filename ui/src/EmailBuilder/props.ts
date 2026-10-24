// Frozen props for ui/EmailBuilder (spec 3.6, ARCH 7.6).
// Visual blocks, HTML, and plain text. Focus is Cmd-Shift-F.
// Ask diffs are accepted one change at a time.

import type { Density } from "../kit/types.ts";

export const EMAIL_MODES = ["visual", "html", "plain"] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

/** Preview frame. Dark is a third frame, not a skin. */
export const EMAIL_PREVIEWS = ["desktop", "mobile", "dark"] as const;

export type EmailPreview = (typeof EMAIL_PREVIEWS)[number];

export const EMAIL_BLOCK_KINDS = ["text", "image", "button", "columns", "divider", "merge", "html"] as const;

export type EmailBlockKind = (typeof EMAIL_BLOCK_KINDS)[number];

export interface EmailBlock {
  id: string;
  kind: EmailBlockKind;
  text?: string;
  /** Merge token name when kind is merge. */
  field?: string;
  /** Nested blocks when kind is columns. */
  children?: readonly EmailBlock[];
}

export interface EmailDiff {
  id: string;
  summary: string;
  accepted?: boolean;
}

export interface EmailBuilderProps {
  id: string;
  title: string;
  subject: string;
  previewText?: string;
  mode: EmailMode;
  focus?: boolean;
  blocks?: readonly EmailBlock[];
  html?: string;
  plain?: string;
  preview?: EmailPreview;
  /** Record whose fields fill merge tokens in the preview. */
  previewRecordId?: string;
  /** Autosave version. A run pins the version it sent. */
  version?: number;
  density?: Density;
  askOpen?: boolean;
  /** Agent selected in the Ask pane. */
  askAgent?: string;
  diffs?: readonly EmailDiff[];
  onMode?: (mode: EmailMode) => void;
  onTestSend?: () => void;
  onAcceptDiff?: (id: string) => void;
}

export function emailLabel(props: EmailBuilderProps): string {
  if (props.subject.length > 0) return props.subject;
  return props.title.length > 0 ? props.title : "EmailBuilder";
}
