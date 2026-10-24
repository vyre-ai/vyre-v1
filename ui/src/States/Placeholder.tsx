// Labelled box for the empty, offline and error states. The one line is the label.

import { stateLabel } from "./props.ts";
import type { StateProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function StatesPlaceholder(props: StateProps): string {
  const label = stateLabel(props);
  if (props.kind === "error") {
    const code = props.code ? `<span data-code>${esc(props.code)}</span>` : "";
    const cause = props.cause ? `<div data-cause>${esc(props.cause)}</div>` : "";
    const next = props.next ? `<div data-next>${esc(props.next)}</div>` : "";
    const retry = props.retryable ? `<button type="button" data-action="retry">Retry</button>` : "";
    const trace = props.traceId ? `<span data-trace>${esc(props.traceId)}</span>` : "";
    const body = `<div data-kind="error">${code}${cause}${next}<div data-actions="true">${retry}<button type="button" data-action="copy">Copy trace id</button><button type="button" data-action="report">Report a problem</button>${trace}</div></div>`;
    return labelledBox("States", label, body);
  }
  const icon = props.icon ? ` data-icon="${esc(props.icon)}"` : "";
  const action = props.action ? `<button type="button" data-action="primary">${esc(props.action.label)}</button>` : "";
  return labelledBox("States", label, `<div data-kind="${props.kind}"${icon}>${action}</div>`);
}
