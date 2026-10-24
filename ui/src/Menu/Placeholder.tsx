// Labelled box for ui/Menu. Report a problem is the last item when the source asks for it.

import { REPORT_A_PROBLEM, isHead, isItem, isSeparator, resolveMenuItems } from "./props.ts";
import type { MenuEntry, MenuProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}">${body}</div>`;
}

function entryHtml(entry: MenuEntry): string {
  if (isSeparator(entry)) return `<div data-separator="true"></div>`;
  if (isHead(entry)) return `<div data-head="true">${esc(entry.head)}</div>`;
  const report = entry.label === REPORT_A_PROBLEM ? ` data-report="true"` : "";
  const icon = entry.icon ? ` data-icon="${esc(entry.icon)}"` : "";
  const checked = entry.checked ? ` data-checked="true"` : "";
  const danger = entry.danger ? ` data-danger="true"` : "";
  return `<div data-item="true" role="menuitem"${report}${icon}${checked}${danger}>${esc(entry.label)}</div>`;
}

export function MenuPlaceholder(props: MenuProps): string {
  const items = resolveMenuItems(props);
  const first = items.find(isItem);
  const label = first?.label ?? "Menu";
  const body = `<div role="menu">${items.map(entryHtml).join("")}</div>`;
  return labelledBox("Menu", label, body);
}
