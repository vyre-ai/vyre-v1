// Frozen props for ui/Recipients (spec 2.18).
// One To / Cc / Bcc field. Reply All never includes you and never repeats an address.

export const RECIPIENT_ROWS = ["to", "cc", "bcc"] as const;

export type RecipientRow = (typeof RECIPIENT_ROWS)[number];

export type RecipientKind = "record" | "team" | "agent" | "recent" | "plain" | "group";

export interface Recipient {
  email: string;
  name?: string;
  kind?: RecipientKind;
}

export type RecipientInput = string | Recipient;

export interface RecipientsProps {
  to?: readonly RecipientInput[];
  cc?: readonly RecipientInput[];
  bcc?: readonly RecipientInput[];
  /** Reply All drops this address. */
  me?: string;
  onChange?: (next: Record<RecipientRow, string[]>) => void;
}

export interface ReplySource {
  from: RecipientInput;
  to?: readonly RecipientInput[];
  cc?: readonly RecipientInput[];
}

export function recipientEmail(value: RecipientInput): string {
  return (typeof value === "string" ? value : value.email).trim();
}

export function recipientLabel(value: RecipientInput): string {
  if (typeof value === "string") return value.trim();
  const name = value.name?.trim();
  if (name) return name;
  return value.email.trim();
}

/** To gets From and the original To. Cc stays Cc. The sender is omitted. First occurrence wins. */
export function replyAll(message: ReplySource, me: string): { to: string[]; cc: string[] } {
  const seen = new Set<string>();
  const meKey = me.trim().toLowerCase();
  if (meKey.length > 0) seen.add(meKey);
  const to: string[] = [];
  const cc: string[] = [];
  const push = (list: string[], value: RecipientInput): void => {
    const email = recipientEmail(value);
    const key = email.toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    list.push(email);
  };
  push(to, message.from);
  for (const value of message.to ?? []) push(to, value);
  for (const value of message.cc ?? []) push(cc, value);
  return { to, cc };
}
