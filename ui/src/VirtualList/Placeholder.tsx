// Labelled box for ui/VirtualList. String markup, no renderer: the screen test reads the label.

import { virtualItemLabel } from "./props.ts";
import type { VirtualListProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function VirtualListPlaceholder<T>(props: VirtualListProps<T>): string {
  const labels = props.data.map((item) => virtualItemLabel(item)).filter((text) => text.length > 0);
  const label = labels[0] ?? "VirtualList";
  const height = props.rowHeight === "measure" ? "measure" : String(props.rowHeight);
  const rows = labels.slice(0, 20).map((text) => `<div data-row data-width="100%">${esc(text)}</div>`).join("");
  const body = `<div data-count="${props.data.length}" data-row-height="${esc(height)}" data-row-component="ui/Row">${rows}</div>`;
  return labelledBox("VirtualList", label, body);
}
