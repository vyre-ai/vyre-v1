// Labelled box for ui/Pane and ui/SidePane.
// The header's first child is the one pane toggle (D57). It sits at the far left.

import { paneToggleLabel, sidePaneMax, sidePaneMin } from "./props.ts";
import type { PaneProps, SidePaneProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

function headerHtml(props: PaneProps): string {
  const toggleLabel = paneToggleLabel(props.toggle.open);
  const toggle = `<button type="button" data-pane-toggle="far-left" aria-pressed="${props.toggle.open ? "true" : "false"}" aria-label="${esc(toggleLabel)}">${esc(toggleLabel)}</button>`;
  const tabs = (props.tabs ?? []).map((tab) => {
    const on = tab.key === props.activeTab;
    return `<div role="tab" data-tab="${esc(tab.key)}" aria-selected="${on ? "true" : "false"}">${esc(tab.title)}</div>`;
  }).join("");
  const inner = props.toggle.open ? "hidden" : "shown";
  return `<header data-pane-header data-toggle-count="1" data-inner-toggle="${inner}">${toggle}<div data-tabs="true">${tabs}</div></header>`;
}

export function PanePlaceholder(props: PaneProps): string {
  const label = props.title ?? paneToggleLabel(props.toggle.open);
  return labelledBox("Pane", label, headerHtml(props));
}

export function SidePanePlaceholder(props: SidePaneProps): string {
  const label = props.title ?? props.paneKey;
  const meta = `<div data-pane-key="${esc(props.paneKey)}" data-min="${sidePaneMin(props)}" data-max="${sidePaneMax(props)}"></div>`;
  return labelledBox("SidePane", label, meta + headerHtml(props));
}
