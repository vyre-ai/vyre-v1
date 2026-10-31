// Connect in place: the one footer every account, key or channel picker ends with. Empty list: "Connect a mailbox", "Add an AI account", "Add a key", "Connect Twilio".
// A list with items: "+ Connect another". Choosing it opens the real connect flow over the current page; when the flow finishes the new account is chosen by the picker.
// This file is pure: no screen, no network. The host that opens the flows is in ConnectInline.tsx.
import type { MenuEntry, MenuItem } from "../../../../../ui/src/Menu/props.ts";

export type ConnectNeed =
  | { kind: "mailbox" }
  | { kind: "ai" }
  | { kind: "key"; app?: string }
  | { kind: "number" }
  | { kind: "connector"; service: string };

/** What a finished flow hands back. `app` is the picker's own group ("mail", "ai", a connector id, or the template). */
export interface Connected {
  id: string;
  title: string;
  app: string;
  /** The Vault handle some pickers store instead of the id (AI accounts on an agent, Memory). */
  ref?: string;
}

/** Opens the flow and resolves with the new account, or null when the person left without finishing. */
export type OpenConnect = (need: ConnectNeed) => Promise<Connected | null>;

export const CONNECT_ANOTHER = "+ Connect another";

const SERVICE_WORDS: Readonly<Record<string, string>> = { google: "Google", microsoft: "Microsoft", github: "GitHub", ms: "Microsoft" };

function serviceWord(service: string): string {
  return SERVICE_WORDS[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

/** The words on the footer item. */
export function connectLabel(need: ConnectNeed, empty: boolean): string {
  if (!empty) return CONNECT_ANOTHER;
  switch (need.kind) {
    case "mailbox": return "Connect a mailbox";
    case "ai": return "Add an AI account";
    case "key": return "Add a key";
    case "number": return "Connect Twilio";
    case "connector": return `Connect ${serviceWord(need.service)}`;
  }
}

/** The group a finished account belongs to, as the account pickers name it. */
export function appOfNeed(need: ConnectNeed): string {
  switch (need.kind) {
    case "mailbox": return "mail";
    case "ai": return "ai";
    case "key": return need.app ?? "key";
    case "number": return "twilio";
    case "connector": return need.service;
  }
}

/**
 * The entries with the connect item at the end. `empty` says the list has no real account, so the item reads "Connect a mailbox" and not "+ Connect another".
 * A caller drops its own placeholder rows ("No accounts yet") before it calls; a real row such as "None" stays.
 * With no way to open a flow (`open` is null) the entries come back as they were: no item that does nothing.
 */
export function connectEntries(
  entries: readonly MenuEntry[],
  need: ConnectNeed,
  open: OpenConnect | null,
  onConnected: (account: Connected) => void,
  empty = false,
): MenuEntry[] {
  if (!open) return [...entries];
  const item: MenuItem = { label: connectLabel(need, empty), onSelect: () => { void connectThen(open, need, onConnected); } };
  return entries.length === 0 ? [item] : [...entries, { separator: true }, item];
}

/** Open the flow, and when it finishes hand the new account on. Resolves true when an account came back. */
export async function connectThen(open: OpenConnect, need: ConnectNeed, apply: (account: Connected) => void): Promise<boolean> {
  let account: Connected | null = null;
  try { account = await open(need); } catch { account = null; }
  if (!account) return false;
  apply(account);
  return true;
}

interface StepLike { key: string; input?: Record<string, unknown>; ai?: { keyId?: string } }

function schemaHas(schema: unknown, name: string): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const props = (schema as { properties?: unknown }).properties;
  return !!props && typeof props === "object" && !Array.isArray(props) && Object.prototype.hasOwnProperty.call(props, name);
}

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
}

/**
 * What a step is waiting for, from the step itself (its key, its input, its catalog schema), never from the wording of a problem.
 * Undefined when the step needs no account, already has one, or the missing thing has no flow to open.
 */
export function stepNeed(step: StepLike, schema?: unknown, kind: "personal" | "space" = "personal"): ConnectNeed | undefined {
  const input = step.input ?? {};
  if (step.key === "send_email" || schemaHas(schema, "mailboxId")) return filled(input["mailboxId"]) ? undefined : { kind: "mailbox" };
  if (step.key === "send_sms" || schemaHas(schema, "numberId")) return filled(input["numberId"]) ? undefined : { kind: "number" };
  if (step.key === "ai") return kind === "space" && !filled(step.ai?.keyId) ? { kind: "ai" } : undefined;
  const prefixed = step.key.startsWith("google.") ? "google" : step.key.startsWith("ms.") ? "microsoft" : undefined;
  if (prefixed || schemaHas(schema, "connectionId")) {
    if (filled(input["connectionId"])) return undefined;
    const named = typeof input["connector"] === "string" && input["connector"] !== "" ? input["connector"] : prefixed;
    return named ? { kind: "connector", service: named } : undefined;
  }
  return undefined;
}
