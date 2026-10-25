// Frozen props for ui/EmailBuilder (spec 3.6, ARCH 7.6).
// Visual blocks, HTML, and plain text. Focus is Cmd-Shift-F.
// Ask diffs are accepted one change at a time.

import type { Density } from "../kit/types.ts";

export const EMAIL_MODES = ["visual", "html", "plain"] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

/** Preview frame. Dark is a third frame, not a skin. */
export const EMAIL_PREVIEWS = ["desktop", "mobile", "dark"] as const;

export type EmailPreview = (typeof EMAIL_PREVIEWS)[number];

export const EMAIL_BLOCK_KINDS = ["text", "heading", "image", "button", "columns", "divider", "merge", "footer", "html"] as const;

export type EmailBlockKind = (typeof EMAIL_BLOCK_KINDS)[number];

export interface EmailBlock {
  id: string;
  kind: EmailBlockKind;
  text?: string;
  /** Merge token name when kind is merge. */
  field?: string;
  /** Nested blocks when kind is columns. */
  children?: readonly EmailBlock[];
  /** Heading size in px (kind heading). Default 24. */
  size?: number;
  /** Text alignment (kinds heading and footer). Default left. */
  align?: EmailAlign;
  /** Footer carries the one-click Unsubscribe and Email preferences links (kind footer). */
  unsub?: boolean;
}

export const EMAIL_ALIGNS = ["left", "center", "right"] as const;

export type EmailAlign = (typeof EMAIL_ALIGNS)[number];

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

function escHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** HTML export of the two first-class text kinds, as the prototype draws them. Other kinds return null (the builder exports those itself). */
export function emailBlockHtml(block: EmailBlock): string | null {
  const align = block.align ?? "left";
  const text = escHtml(block.text ?? "");
  if (block.kind === "heading") {
    const size = block.size !== undefined && block.size > 0 ? block.size : 24;
    return `<h1 style="margin:0;font:700 ${size}px/1.2 sans-serif;text-align:${align};letter-spacing:-.01em">${text}</h1>`;
  }
  if (block.kind === "footer") {
    const links = block.unsub === true
      ? `<div style="margin-top:8px"><a href="{{unsubscribe_url}}">Unsubscribe</a> &middot; <a href="{{preferences_url}}">Email preferences</a></div>`
      : "";
    return `<div style="font:400 12px/1.6 sans-serif;text-align:${align}"><div>${text}</div>${links}</div>`;
  }
  return null;
}
