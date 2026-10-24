// Labelled box for ui/Softphone. String markup, no renderer: the screen test reads the label.

import { softphoneLabel } from "./props.ts";
import type { SoftphoneProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function SoftphonePlaceholder(props: SoftphoneProps): string {
  const label = softphoneLabel(props);
  const caller = props.caller;
  const who = caller
    ? `<div data-caller="${esc(caller.number)}">${esc(caller.name && caller.name.length > 0 ? caller.name : caller.number)}</div>`
    : "";
  const record = caller?.recordId ? `<div data-record="${esc(caller.recordId)}"></div>` : "";
  const consent = props.recording === true
    ? `<div data-recording="true" data-consent="${props.consent === true ? "true" : "false"}"></div>`
    : "";
  const body = [
    `<div data-mode="${esc(props.mode)}" data-density="${esc(props.density ?? "regular")}" data-open="${props.open ? "true" : "false"}" data-keys="Cmd-Shift-K"></div>`,
    who,
    record,
    consent,
    `<div data-controls="mute hold transfer record task"></div>`,
  ].join("");
  return labelledBox("Softphone", label, body);
}
