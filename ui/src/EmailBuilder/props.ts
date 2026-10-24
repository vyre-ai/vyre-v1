// Frozen props for ui/EmailBuilder (spec 2.19, ARCH 7.6).
// Visual blocks, HTML, and plain text. Ask diffs are accepted one change at a time.

import type { Density } from "../kit/types.ts";

export const EMAIL_MODES = ["visual", "html", "plain"] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

export type EmailPreview = "desktop" | "phone";

export type EmailBlockKind = "text" | "image" | "button" | "divider" | "html";

export interface EmailBlock {
  id: string;
  kind: EmailBlockKind;
  text?: string;
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
  /** Autosave version. A run pins the version it sent. */
  version?: number;
  density?: Density;
  askOpen?: boolean;
  diffs?: readonly EmailDiff[];
  onMode?: (mode: EmailMode) => void;
  onTestSend?: () => void;
  onAcceptDiff?: (id: string) => void;
}

export function emailLabel(props: EmailBuilderProps): string {
  if (props.subject.length > 0) return props.subject;
  return props.title.length > 0 ? props.title : "EmailBuilder";
}
