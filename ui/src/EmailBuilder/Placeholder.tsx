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
  const version = props.version ?? 0;
  const body = [
    `<div data-mode="${esc(props.mode)}" data-focus="${props.focus === true ? "true" : "false"}" data-version="${version}" data-density="${esc(props.density ?? "regular")}" data-id="${esc(props.id)}"></div>`,
    `<div data-subject>${esc(props.subject)}</div>`,
    diffs,
    `<button type="button" data-test-send="true">Test send</button>`,
  ].join("");
  return labelledBox("EmailBuilder", label, body);
}
