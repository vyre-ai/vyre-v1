// Labelled box for the composer shell. The who-will-answer line is the label.

import { composerSymbols, symbolMark } from "./props.ts";
import type { ComposerShellProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function ComposerPlaceholder(props: ComposerShellProps): string {
  const symbols = composerSymbols(props).map((symbol) => `<button type="button" data-symbol="${symbol}">${esc(symbolMark(symbol))}</button>`).join("");
  const recipients = props.sendsOutside ? `<div data-slot="recipients"></div>` : "";
  const chips = (props.chips ?? []).map((chip) => `<span data-chip="${esc(chip.kind)}">${esc(chip.name)}</span>`).join("");
  const files = (props.attachments ?? []).map((file) => `<span data-file="true">${esc(file.name)}</span>`).join("");
  const engine = props.engineLine ? `<div data-engine-line="true">${esc(props.engineLine)}</div>` : "";
  const value = props.value ? `<div data-value="true">${esc(props.value)}</div>` : "";
  const send = props.working ? "Stop" : "Send";
  const field = props.label ?? "Message";
  const placeholder = props.placeholder ?? "Message";
  const body = `${recipients}${engine}<div data-field="true" data-field-label="${esc(field)}" data-placeholder-text="${esc(placeholder)}">${value}</div><div data-symbols="true">${symbols}</div><div data-who="true">${esc(props.whoWillAnswer)}</div>${chips}${files}<button type="button" data-send="true">${send}</button>`;
  return labelledBox("Composer", props.whoWillAnswer, body);
}
