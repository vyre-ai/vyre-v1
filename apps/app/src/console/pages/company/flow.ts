// Connect your company, with no screen in it: what a pasted credential is, the section of the guide a step opens, and the sentence for each thing a person can do. The page draws these; a test holds them to the guide.
import { parseGoogleKey, microsoftSecret } from "../suite/model.ts";
import type { Parsed } from "../suite/model.ts";

export type Provider = "google" | "microsoft";
export type Pasted = { kind: "google"; text: string; who: string } | { kind: "microsoft"; text: string; clientId: string; tenantId: string };

/** A pasted or dropped credential, read here so the first thing a person learns is whether it is the right kind of thing. Only the shape is read; the check that it works happens at the provider. */
export function readPasted(provider: Provider, text: string, hand: { tenantId: string; clientId: string; clientSecret: string }): Parsed<Pasted> {
  if (provider === "google") {
    const k = parseGoogleKey(text);
    return k.ok ? { ok: true, value: { kind: "google", text: text.trim(), who: k.value.clientEmail } } : k;
  }
  if (text.trim().startsWith("{")) {
    let o: Record<string, unknown>;
    try { o = JSON.parse(text.trim()) as Record<string, unknown>; } catch { return { ok: false, problem: "That is not the whole line. Copy from the first { to the last }." }; }
    const clientId = o["clientId"], tenantId = o["tenantId"];
    if (typeof clientId !== "string" || typeof tenantId !== "string") return { ok: false, problem: "That line has no client ID or tenant ID. Paste what the script printed." };
    return { ok: true, value: { kind: "microsoft", text: text.trim(), clientId, tenantId } };
  }
  const made = microsoftSecret(hand);
  return made.ok ? { ok: true, value: { kind: "microsoft", text: made.value, clientId: hand.clientId.trim(), tenantId: hand.tenantId.trim() } } : made;
}

export const dataLine = (d: { mail: boolean; calendar: boolean; files: boolean }): string => {
  const on = [d.mail ? "Mail" : "", d.calendar ? "Calendar" : "", d.files ? "Files" : ""].filter(Boolean);
  return on.length === 3 ? "Mail, Calendar and Files" : on.join(" and ");
};

export const connectLine = (mapped: number, excluded: number, d: { mail: boolean; calendar: boolean; files: boolean }): string =>
  `${mapped} ${mapped === 1 ? "person gets" : "people get"} ${dataLine(d)} with nothing to sign in to.${excluded ? ` ${excluded} excluded ${excluded === 1 ? "stays" : "stay"} out.` : ""}`;
