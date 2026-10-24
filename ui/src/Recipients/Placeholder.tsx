// Labelled box for ui/Recipients. To, Cc and Bcc, in that order.

import { RECIPIENT_ROWS, recipientLabel } from "./props.ts";
import type { RecipientInput, RecipientRow, RecipientsProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

function rowOf(props: RecipientsProps, row: RecipientRow): readonly RecipientInput[] {
  return props[row] ?? [];
}

export function RecipientsPlaceholder(props: RecipientsProps): string {
  const to = rowOf(props, "to");
  const first = to[0];
  const label = first ? recipientLabel(first) : "Recipients";
  const rows = RECIPIENT_ROWS.map((row) => {
    const people = rowOf(props, row).map((value) => `<span data-recipient="true">${esc(recipientLabel(value))}</span>`).join("");
    return `<div data-row="${row}" data-width="100%"><span data-field="${row}">${row}</span>${people}</div>`;
  }).join("");
  return labelledBox("Recipients", label, rows);
}
