// Labelled box for ui/Viewer. String markup, no renderer: the screen test reads the label.
// Pins stay numbered. The default pane is the shared side pane.

import { viewerLabel } from "./props.ts";
import type { ViewerProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function ViewerPlaceholder(props: ViewerProps): string {
  const label = viewerLabel(props);
  const pins = (props.pins ?? []).map((pin) => {
    return `<div data-pin="${esc(pin.id)}" data-n="${pin.n}">${esc(pin.text)}</div>`;
  }).join("");
  const find = props.find ? `<div data-find>${esc(props.find)}</div>` : "";
  const tool = props.tool ? ` data-tool="${esc(props.tool)}"` : "";
  const editing = props.editing === true ? ` data-editing="true"` : "";
  const body = `<div data-kind="${esc(props.kind)}" data-pane="${esc(props.pane ?? "side")}" data-file="${esc(props.fileId)}" data-density="${esc(props.density ?? "regular")}"${tool}${editing}></div>${find}${pins}`;
  return labelledBox("Viewer", label, body);
}
