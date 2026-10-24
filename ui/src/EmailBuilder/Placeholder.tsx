// Labelled box for ui/EmailBuilder. String markup, no renderer: the screen test reads the label.
// Each Ask diff is its own row so a person can accept one change at a time.

import { emailLabel } from "./props.ts";
import type { EmailBuilderProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function EmailBuilderPlaceholder(props: EmailBuilderProps): string {
  const label = emailLabel(props);
  const diffs = (props.diffs ?? []).map((diff) => {
    const accepted = diff.accepted === true ? "true" : "false";
    return `<div data-diff="${esc(diff.id)}" data-accepted="${accepted}">${esc(diff.summary)}</div>`;
  }).join("");
  const blocks = (props.blocks ?? []).map((block) => {
    const field = block.field ? ` data-field="${esc(block.field)}"` : "";
    return `<div data-email-block="${esc(block.id)}" data-kind="${esc(block.kind)}"${field}></div>`;
  }).join("");
  const preview = props.preview ? ` data-preview="${esc(props.preview)}"` : "";
  const record = props.previewRecordId ? ` data-preview-record="${esc(props.previewRecordId)}"` : "";
  const agent = props.askAgent ? ` data-ask-agent="${esc(props.askAgent)}"` : "";
  const version = props.version ?? 0;
  const body = [
    `<div data-mode="${esc(props.mode)}" data-focus="${props.focus === true ? "true" : "false"}" data-keys="Cmd-Shift-F" data-version="${version}" data-density="${esc(props.density ?? "regular")}" data-id="${esc(props.id)}"${preview}${record}${agent}></div>`,
    `<div data-subject>${esc(props.subject)}</div>`,
    blocks,
    diffs,
    `<button type="button" data-test-send="true">Test send</button>`,
  ].join("");
  return labelledBox("EmailBuilder", label, body);
}
