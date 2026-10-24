// Labelled box for ui/TabStrip. The active tab's title is the label.

import { activeTab } from "./props.ts";
import type { TabStripProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function TabStripPlaceholder(props: TabStripProps): string {
  const current = activeTab(props);
  const label = current?.title ?? "TabStrip";
  const tabs = props.tabs.map((tab) => {
    const on = tab.key === props.active;
    const pinned = tab.pinned ? ` data-pinned="true"` : "";
    return `<div role="tab" data-tab="${esc(tab.key)}" aria-selected="${on ? "true" : "false"}"${pinned}>${esc(tab.title)}</div>`;
  }).join("");
  const plus = props.onPlus ? `<button type="button" data-plus="true">${esc(props.plusTitle ?? "Open")}</button>` : "";
  return labelledBox("TabStrip", label, `<div role="tablist">${tabs}${plus}</div>`);
}
