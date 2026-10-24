// Labelled box for ui/Terminal. String markup, no renderer: the screen test reads the label.
// A locked server shell asks for access and does not draw a prompt.

import { terminalLabel } from "./props.ts";
import type { TerminalProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function TerminalPlaceholder(props: TerminalProps): string {
  const label = terminalLabel(props);
  const locked = props.locked === true;
  const scroll = locked
    ? `<p data-locked="true">Ask for access</p>`
    : `<pre data-output>${esc(props.output ?? "")}</pre>`;
  const body = [
    `<div data-host="${esc(props.host)}" data-host-label="${esc(props.hostLabel)}" data-session="${esc(props.sessionId)}" data-starred="${props.starred === true ? "true" : "false"}" data-density="${esc(props.density ?? "regular")}" data-readonly="${props.readonly === true ? "true" : "false"}"></div>`,
    scroll,
  ].join("");
  return labelledBox("Terminal", label, body);
}
