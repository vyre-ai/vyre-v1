// Labelled box for ui/Row. Hover and selection sit on the row, at full width.

import type { RowProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function RowPlaceholder(props: RowProps): string {
  const id = props.id ? ` data-id="${esc(props.id)}"` : "";
  const note = props.note ? `<span data-note>${esc(props.note)}</span>` : "";
  return `<div data-placeholder="Row" data-label="${esc(props.title)}" aria-label="${esc(props.title)}" data-width="100%" data-selected="${props.selected ? "true" : "false"}" data-hovered="${props.hovered ? "true" : "false"}"${id}><span data-label>${esc(props.title)}</span>${note}</div>`;
}
