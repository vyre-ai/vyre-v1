// contacts.preferences.get and .set, contacts.deliverability, contacts.route_owner (spec 2.18 Contact preferences and suppression, Contact owner,
// Message status and deliverability). The Contact preferences field group lives on the contact record (pref_email_consent, pref_sms_consent,
// pref_do_not_contact, pref_opt_outs, pref_source, pref_at), so the record stays the one place a person edits it; this file reads and writes it
// through the records module and adds the event.
import { bad, ensure, getRecord, isId, list, missing, normalize, num, obj, rowsOf, str, text } from "../projections.ts";
import type { Channel, ContactsCtx, RecordLite } from "../projections.ts";

export type Consent = "granted" | "denied" | "unknown";

export interface Prefs {
  emailConsent: Consent;
  smsConsent: Consent;
  doNotContact: boolean;
  optedOut: Channel[];
  source?: string;
  at?: number;
}

const CONSENT: readonly string[] = ["granted", "denied", "unknown"];
const CHANNELS: readonly Channel[] = ["email", "sms", "call"];

const consentOf = (v: unknown): Consent => (v === "granted" || v === "denied" ? v : "unknown");

/** The preferences a contact record's fields hold. A field never set reads as unknown consent, not Do-not-contact, no opt-outs. */
export function prefsOf(fields: Record<string, unknown>): Prefs {
  const flag = fields.pref_do_not_contact;
  const out: Prefs = {
    emailConsent: consentOf(fields.pref_email_consent),
    smsConsent: consentOf(fields.pref_sms_consent),
    doNotContact: flag === true || flag === 1 || flag === "true",
    optedOut: list(fields.pref_opt_outs).filter((c): c is Channel => CHANNELS.includes(c as Channel)),
  };
  const source = text(fields.pref_source);
  if (source) out.source = source;
  if (typeof fields.pref_at === "number") out.at = fields.pref_at;
  return out;
}

async function contactOf(ctx: ContactsCtx, contactId: string): Promise<RecordLite> {
  if (!isId("rec", contactId)) bad(ctx, "Contact id is not valid.");
  return (await getRecord(ctx, "contact", contactId)) ?? missing(ctx, "That contact does not exist.");
}

export async function preferencesGet(ctx: ContactsCtx, input: { contactId: string }): Promise<Prefs> {
  return prefsOf((await contactOf(ctx, input.contactId)).fields);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export async function preferencesSet(
  ctx: ContactsCtx,
  input: { contactId: string; emailConsent?: Consent; smsConsent?: Consent; doNotContact?: boolean; optedOut?: Channel[]; source?: string },
): Promise<Prefs> {
  ensure(ctx);
  if (input.emailConsent !== undefined && !CONSENT.includes(input.emailConsent)) bad(ctx, "Email consent must be granted, denied or unknown.");
  if (input.smsConsent !== undefined && !CONSENT.includes(input.smsConsent)) bad(ctx, "SMS consent must be granted, denied or unknown.");
  if (input.doNotContact !== undefined && typeof input.doNotContact !== "boolean") bad(ctx, "Do-not-contact must be true or false.");
  if (input.optedOut !== undefined && (!Array.isArray(input.optedOut) || input.optedOut.some((c) => !CHANNELS.includes(c)))) bad(ctx, "Opt-outs are email, sms or call.");
  if (input.source !== undefined && (typeof input.source !== "string" || input.source.length > 200)) bad(ctx, "Source must be text up to 200 characters.");
  const rec = await contactOf(ctx, input.contactId);
  const before = prefsOf(rec.fields);

  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  if (input.emailConsent !== undefined && input.emailConsent !== before.emailConsent) { patch.pref_email_consent = input.emailConsent; changed.push("emailConsent"); }
  if (input.smsConsent !== undefined && input.smsConsent !== before.smsConsent) { patch.pref_sms_consent = input.smsConsent; changed.push("smsConsent"); }
  if (input.doNotContact !== undefined && input.doNotContact !== before.doNotContact) { patch.pref_do_not_contact = input.doNotContact; changed.push("doNotContact"); }
  if (input.optedOut !== undefined && !sameSet(input.optedOut, before.optedOut)) { patch.pref_opt_outs = [...new Set(input.optedOut)]; changed.push("optedOut"); }
  if (changed.length === 0) return before;

  const source = input.source ?? "manual";
  patch.pref_source = source;
  patch.pref_at = ctx.now();
  const updated = obj(obj(await ctx.call("records.update", { type: "contact", recordId: rec.id, patch })).record);
  const after = prefsOf(Object.keys(obj(updated.fields)).length ? obj(updated.fields) : { ...rec.fields, ...patch });
  ctx.emit("contact.preferences_changed", `record/${rec.id}`, { contactId: rec.id, changed, source });
  return after;
}

// ---- contacts.deliverability

type Badge = "good" | "risky" | "bounced" | "complained";
const SEVERITY: Record<Badge, number> = { good: 0, risky: 1, bounced: 2, complained: 3 };
const badgeOf = (v: unknown): Badge => (v === "risky" || v === "bounced" || v === "complained" ? v : "good");

export async function deliverability(
  ctx: ContactsCtx, input: { contactId: string },
): Promise<{ state: Badge; lastEventAt?: number; reasons: string[] }> {
  ensure(ctx);
  const rec = await contactOf(ctx, input.contactId);
  let state = badgeOf(rec.fields.deliverability);
  let last = 0;
  const reasons: string[] = [];
  const emails = new Set<string>();
  const own = normalize("email", text(rec.fields.email));
  if (own) emails.add(own);
  for (const a of rowsOf(ctx.db.all(`SELECT * FROM contacts_link_address WHERE "contactId" = ? AND kind = ? AND deleted_at IS NULL`, rec.id, "email"))) emails.add(str(a, "normalized"));
  const seen = new Set<string>();
  const rows = [
    ...rowsOf(ctx.db.all(`SELECT * FROM contacts_link_suppression WHERE "contactId" = ? AND deleted_at IS NULL`, rec.id)),
    ...[...emails].flatMap((e) => rowsOf(ctx.db.all(`SELECT * FROM contacts_link_suppression WHERE channel = ? AND address = ? AND deleted_at IS NULL`, "email", e))),
  ];
  for (const r of rows) {
    if (seen.has(str(r, "id"))) continue;
    seen.add(str(r, "id"));
    const reason = str(r, "reason");
    const hit: Badge | null = reason === "complaint" ? "complained" : reason === "bounce_hard" ? "bounced" : null;
    if (!hit) continue;
    if (SEVERITY[hit] > SEVERITY[state]) state = hit;
    last = Math.max(last, num(r, "addedAt"));
    reasons.push(`${reason === "complaint" ? "complaint" : "hard bounce"}: ${str(r, "address")}`);
  }
  if (reasons.length === 0 && state !== "good") reasons.push(`marked ${state} on the record`);
  const out: { state: Badge; lastEventAt?: number; reasons: string[] } = { state, reasons: reasons.sort() };
  if (last > 0) out.lastEventAt = last;
  return out;
}

// ---- contacts.route_owner (spec 2.18: unowned replies go to the campaign owner, then the shared inbox)

export async function routeOwner(
  ctx: ContactsCtx, input: { contactId?: string; campaignId?: string; mailboxId?: string },
): Promise<{ ownerId?: string; via: "owner" | "campaign_owner" | "shared_inbox"; mailboxId?: string }> {
  if (input.contactId !== undefined && !isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (input.campaignId !== undefined && !isId("cmp", input.campaignId)) bad(ctx, "Campaign id is not valid.");
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  if (input.contactId) {
    const rec = await getRecord(ctx, "contact", input.contactId);
    const owner = text(rec?.fields.owner);
    if (owner) return { ownerId: owner, via: "owner" };
  }
  if (input.campaignId) {
    const campaign = obj(obj(await ctx.call("campaigns.get", { campaignId: input.campaignId })).campaign);
    const owner = text(campaign.owner);
    if (owner) return { ownerId: owner, via: "campaign_owner" };
  }
  const out: { via: "shared_inbox"; mailboxId?: string } = { via: "shared_inbox" };
  if (input.mailboxId) out.mailboxId = input.mailboxId;
  return out;
}
