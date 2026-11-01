// What a grant is about, in one spelling (chat design, holes 1 and 3). A grant names an act and a target: this file reads the target out of a capability's or a step's input, and hashes a definition, so
// the module that writes a grant and the Gate that matches one read the same words. Nothing here decides: the Gate does (modules/gate/handlers/grants.ts).
import { canonical } from "./canonical.ts";

/** Another person or the public sees it. Everything else an agent does stays inside Vyre, your computer or its computer. */
export const OUTWARD_ACTS: ReadonlySet<string> = new Set(["send", "post", "pay", "push_protected", "campaign_launch", "site_promote", "signature_send"]);

/** The target of a row that covers whatever its step reaches: a person wrote that step, so what it computes is theirs. Also the row of a step that has no target to name. */
export const ANY_TARGET = "*";

const LIST_KEYS = ["to", "cc", "bcc", "recipients", "emails", "attendees", "reviewers", "hosts"] as const;
const ONE_KEYS = ["url", "repo", "channel", "channelId", "conversationId", "documentId", "spreadsheetId", "fileId", "itemId", "eventId", "invoiceId", "server"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const hasTemplate = (v: unknown): boolean => typeof v === "string" ? v.includes("{{") : Array.isArray(v) ? v.some(hasTemplate) : isObj(v) ? Object.values(v).some(hasTemplate) : false;

function hostOf(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return raw.toLowerCase(); }
}
/** "Lee Park <lee@acme.com>, sam@acme.com" and { email } rows, as plain lower-case addresses. A value a template fills is not a target yet. */
function people(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(people);
  if (isObj(v)) return people(v["email"] ?? v["address"] ?? v["id"] ?? v["login"]);
  if (typeof v !== "string" || hasTemplate(v)) return [];
  return v.split(/[,;]/).map((s) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase()).filter((s) => s !== "");
}
function one(key: string, v: unknown): string[] {
  if (typeof v !== "string" || v === "" || hasTemplate(v)) return [];
  return [key === "url" ? hostOf(v) : v.toLowerCase()];
}

/** Everything this input reaches, in one spelling, one level into a nested `input` (a connector or an outside tool call). Empty when the input names nothing. */
export function targetsOf(input: unknown): string[] {
  if (!isObj(input)) return [];
  const out = new Set<string>();
  for (const k of LIST_KEYS) for (const t of people(input[k])) out.add(t);
  for (const k of ONE_KEYS) for (const t of one(k, input[k])) out.add(t);
  if (isObj(input["input"])) for (const t of targetsOf(input["input"])) out.add(t);
  return [...out];
}

/** A value where a target goes is a template: what it reaches is known only when a Run renders it. */
export function targetIsComputed(input: unknown): boolean {
  if (!isObj(input)) return false;
  if ([...LIST_KEYS, ...ONE_KEYS].some((k) => hasTemplate(input[k]))) return true;
  return isObj(input["input"]) && targetIsComputed(input["input"]);
}

/** The hash a grant is bound to: any edit of the definition, however small, changes it. Web Crypto, so a module can use it (the crypto imports stay in the kernel, boundary B3). */
export async function definitionHash(definition: unknown): Promise<string> {
  const plain = JSON.parse(JSON.stringify(definition ?? null)) as unknown;
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(plain)));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Does what the person named cover what the call reaches? The same value, a name found in an address ("sarah" in sarah.jones@acme.com), a host or a repo's last part. */
export function namedCovers(named: string, target: string): boolean {
  if (named === target) return true;
  const n = named.toLowerCase(), t = target.toLowerCase();
  if (t.endsWith(`/${n}`) || t.endsWith(`.${n}`)) return true;
  const [local, domain] = t.split("@");
  if (domain === undefined) return false;
  return (local ?? "").split(/[._+-]/).includes(n) || domain.split(".").includes(n);
}
