// contacts.suppression.*, contacts.apply_optout (spec 2.18 Contact preferences and suppression): "One Suppression list is consulted by the single send
// API for every sender. Inbound STOP and UNSUBSCRIBE are parsed, and bounces and complaints write to the list." The list is one row per (channel,
// address). Adding to it is quiet and idempotent; taking an address off it is a person's decision and is audited.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, ensure, first, getRecord, holders, isId, missing, newId, normChannel, num, obj, refuse, rowsOf, str, strOrNull, text } from "../projections.ts";
import type { Channel, ContactsCtx, Row } from "../projections.ts";
import { prefsOf, preferencesSet } from "./prefs.ts";

export type Reason = "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | `import`;

export interface SuppressionOut {
  id: string;
  channel: Channel;
  address: string;
  reason: Reason;
  source: string;
  contactId?: string;
  addedAt: number;
  addedBy: string;
  note?: string;
}

const CHANNELS: readonly Channel[] = ["email", "sms", "call"];
/** Strongest first: when an address is on the list for several reasons, the check answers with the first of these. */
export const PRIORITY: readonly Reason[] = ["complaint", "bounce_hard", "unsubscribe", "stop", "do_not_contact", "manual", `import`];
const MAX_CHECK = 5000;
const MAX_IMPORT = 100_000;

const reasonOf = (v: unknown): Reason => (PRIORITY.includes(v as Reason) ? (v as Reason) : "manual");

export function rowOut(r: Row): SuppressionOut {
  const out: SuppressionOut = {
    id: str(r, "id"), channel: CHANNELS.find((c) => c === str(r, "channel")) ?? "email", address: str(r, "address"), reason: reasonOf(str(r, "reason")),
    source: str(r, "source"), addedAt: num(r, "addedAt"), addedBy: str(r, "addedBy"),
  };
  const contactId = strOrNull(r, "contactId");
  const note = strOrNull(r, "note");
  if (contactId) out.contactId = contactId;
  if (note) out.note = note;
  return out;
}

function channelOf(ctx: ContactsCtx, v: unknown): Channel {
  return CHANNELS.includes(v as Channel) ? (v as Channel) : bad(ctx, "Channel must be email, sms or call.");
}

function stringList(ctx: ContactsCtx, v: unknown, label: string, max: number): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max || v.some((x) => typeof x !== "string")) bad(ctx, `${label} must be a list of 1 to ${max} text values.`);
  return v as string[];
}

/** The row for (channel, address) that is on the list now, if any. */
export function onList(ctx: ContactsCtx, channel: Channel, address: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM contacts_suppression WHERE channel = ? AND address = ? AND deleted_at IS NULL`, channel, address));
}

/** The strongest reason this address is on the list for, or null. */
export function reasonFor(ctx: ContactsCtx, channel: Channel, address: string): Reason | null {
  const reasons = rowsOf(ctx.db.all(`SELECT reason FROM contacts_suppression WHERE channel = ? AND address = ? AND deleted_at IS NULL`, channel, address)).map((r) => reasonOf(str(r, "reason")));
  return PRIORITY.find((p) => reasons.includes(p)) ?? null;
}

// ---- contacts.suppression.check

export async function suppressionCheck(ctx: ContactsCtx, input: { channel: Channel; addresses: string[] }): Promise<{ suppressed: { address: string; reason: Reason }[] }> {
  ensure(ctx);
  const channel = channelOf(ctx, input.channel);
  const asked = stringList(ctx, input.addresses, "Addresses", MAX_CHECK);
  const out: { address: string; reason: Reason }[] = [];
  const done = new Set<string>();
  for (const raw of asked) {
    const address = normChannel(channel, raw);
    if (!address || done.has(address)) continue;   // text that is not an address of this channel cannot be on the list
    done.add(address);
    const reason = reasonFor(ctx, channel, address);
    if (reason) out.push({ address, reason });
  }
  return { suppressed: out };
}

// ---- contacts.suppression.list

export async function suppressionList(
  ctx: ContactsCtx, input: { channel?: Channel; reason?: Reason; query?: string; cursor?: string; limit?: number },
): Promise<{ rows: SuppressionOut[]; next?: string; total: number }> {
  ensure(ctx);
  if (input.channel !== undefined) channelOf(ctx, input.channel);
  if (input.reason !== undefined && !PRIORITY.includes(input.reason)) bad(ctx, "Reason is not one of the list reasons.");
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  const where = ["deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.channel) { where.push("channel = ?"); args.push(input.channel); }
  if (input.reason) { where.push("reason = ?"); args.push(input.reason); }
  const q = (input.query ?? "").trim().toLowerCase().replace(/[%_]/g, "");
  if (q) { where.push("address LIKE ?"); args.push(`%${q}%`); }
  const clause = where.join(" AND ");
  const total = num(first(ctx.db.all(`SELECT count(*) AS n FROM contacts_suppression WHERE ${clause}`, ...args)), "n");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM contacts_suppression WHERE ${clause} ORDER BY "addedAt" DESC, id ASC LIMIT ? OFFSET ?`, ...args, limit, offset));
  const out: { rows: SuppressionOut[]; next?: string; total: number } = { rows: rows.map(rowOut), total };
  if (offset + limit < total) out.next = String(offset + limit);
  return out;
}

// ---- adding

interface NewRow {
  channel: Channel;
  address: string;
  reason: Reason;
  source: string;
  note?: string | undefined;
  contactId?: string | undefined;
  addedAt: number;
}

/** Put an address on the list unless it already is. Returns the new row, or null when the (channel, address) was already listed. */
function insertRow(ctx: ContactsCtx, n: NewRow): Row | null {
  if (onList(ctx, n.channel, n.address)) return null;
  const id = newId("sup", ctx.now());
  ctx.db.run(
    `INSERT INTO contacts_suppression (id, channel, address, reason, source, "contactId", "addedAt", "addedBy", note, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, n.channel, n.address, n.reason, n.source, n.contactId ?? null, n.addedAt, ctx.principal.id, n.note ?? null, 1, ctx.now(), null,
  );
  const row = first(ctx.db.all(`SELECT * FROM contacts_suppression WHERE id = ?`, id));
  if (!row) throw fail("internal.unexpected", ctx.trace.traceId);
  ctx.emit("suppression.added", `entity/${id}`, eventPayload(row));
  return row;
}

function eventPayload(r: Row): { suppressionId: string; channel: string; reason: string; contactId?: string } {
  const p: { suppressionId: string; channel: string; reason: string; contactId?: string } = { suppressionId: str(r, "id"), channel: str(r, "channel"), reason: str(r, "reason") };
  const contactId = strOrNull(r, "contactId");
  if (contactId) p.contactId = contactId;
  return p;
}

/** The one record that holds each address, where exactly one does. An address two records hold is not tied to either. */
async function contactsOf(ctx: ContactsCtx, channel: Channel, addresses: string[]): Promise<Map<string, string>> {
  const found = await holders(ctx, channel === "email" ? { emails: addresses } : { phones: addresses });
  const out = new Map<string, string>();
  for (const address of addresses) {
    const ids = found.get(`${channel === "email" ? "email" : "phone"}:${address}`);
    if (ids && ids.size === 1) out.set(address, [...ids][0] as string);
  }
  return out;
}

const WORSE: Record<string, "bounced" | "complained"> = { bounce_hard: "bounced", complaint: "complained" };

/** A hard bounce or a complaint shows on the contact as its deliverability badge. A failure here never stops the list from being written. */
async function markBadge(ctx: ContactsCtx, contactId: string, reason: Reason): Promise<void> {
  const badge = WORSE[reason];
  if (!badge) return;
  try {
    const rec = await getRecord(ctx, "contact", contactId);
    if (!rec) return;
    const have = text(rec.fields.deliverability);
    if (have === "complained" || have === badge) return;
    await ctx.call("records.update", { type: "contact", recordId: contactId, patch: { deliverability: badge } });
  } catch {
    ctx.log.warn("deliverability badge not updated", { contactId, reason, traceId: ctx.trace.traceId });
  }
}

export async function suppressionAdd(
  ctx: ContactsCtx, input: { channel: Channel; addresses: string[]; reason: Reason; source?: string; note?: string },
): Promise<{ added: number; rows: SuppressionOut[] }> {
  ensure(ctx);
  const channel = channelOf(ctx, input.channel);
  if (!PRIORITY.includes(input.reason)) bad(ctx, "Reason is not one of the list reasons.");
  if (input.source !== undefined && (typeof input.source !== "string" || input.source.length > 200)) bad(ctx, "Source must be text up to 200 characters.");
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) bad(ctx, "Note must be text up to 1000 characters.");
  const asked = stringList(ctx, input.addresses, "Addresses", MAX_CHECK);
  const addresses: string[] = [];
  for (const raw of asked) {
    const address = normChannel(channel, raw);
    if (!address) bad(ctx, channel === "email" ? `"${raw}" is not an email address.` : `"${raw}" is not a phone number with a country code.`);
    if (!addresses.includes(address)) addresses.push(address);
  }
  const owners = await contactsOf(ctx, channel, addresses);
  const rows: Row[] = [];
  for (const address of addresses) {
    const row = insertRow(ctx, { channel, address, reason: input.reason, source: input.source ?? "manual", note: input.note, contactId: owners.get(address), addedAt: ctx.now() });
    if (!row) continue;
    rows.push(row);
    const contactId = strOrNull(row, "contactId");
    if (contactId && channel === "email") await markBadge(ctx, contactId, input.reason);
  }
  return { added: rows.length, rows: rows.map(rowOut) };
}

// ---- contacts.suppression.remove

export async function suppressionRemove(ctx: ContactsCtx, input: { suppressionId: string; note?: string }): Promise<{ removed: boolean }> {
  ensure(ctx);
  if (!isId("sup", input.suppressionId)) bad(ctx, "Suppression id is not valid.");
  if (ctx.principal.kind !== "person") refuse(ctx, "Only a person can take an address off the suppression list.");
  const row = first(ctx.db.all(`SELECT * FROM contacts_suppression WHERE id = ? AND deleted_at IS NULL`, input.suppressionId)) ?? missing(ctx, "That address is not on the list.");
  const now = ctx.now();
  ctx.db.run(`UPDATE contacts_suppression SET deleted_at = ?, note = ?, version = ?, updated_at = ? WHERE id = ?`, now, input.note ?? strOrNull(row, "note"), num(row, "version") + 1, now, input.suppressionId);
  ctx.emit("suppression.removed", `entity/${input.suppressionId}`, eventPayload(row));
  return { removed: true };
}

// ---- contacts.suppression.import

/** The first cell of a CSV, semicolon or tab separated line, without quotes. */
function firstCell(line: string): string {
  return (line.split(/[,;\t]/)[0] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

const HEADERS = new Set(["email", "emails", "email address", "address", "phone", "phone number", "number", "mobile"]);

export async function suppressionImport(
  ctx: ContactsCtx, input: { channel: Channel; fileId: string; reason?: Reason; idempotencyKey?: string },
): Promise<{ added: number; skipped: number }> {
  ensure(ctx);
  const channel = channelOf(ctx, input.channel);
  if (!isId("fil", input.fileId)) bad(ctx, "File id is not valid.");
  if (input.reason !== undefined && !PRIORITY.includes(input.reason)) bad(ctx, "Reason is not one of the list reasons.");
  const file = obj(await ctx.call("files.read", { fileId: input.fileId, as: "text" }));
  if (file.truncated === true) refuse(ctx, "The file is too large to read in one go. Split it and import the parts.");
  const lines = text(file.text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length > MAX_IMPORT) refuse(ctx, `A file can hold up to ${MAX_IMPORT} addresses.`);
  const valid: string[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    const cell = firstCell(line);
    const address = normChannel(channel, cell);
    if (address && !valid.includes(address)) valid.push(address);
    else if (address || !(i === 0 && HEADERS.has(cell.toLowerCase()))) skipped++;   // a repeated or malformed value is skipped; a header line is not a value
  });
  const owners = await contactsOf(ctx, channel, valid);
  const reason = input.reason ?? `import`;
  let added = 0;
  for (const address of valid) {
    const row = insertRow(ctx, { channel, address, reason, source: `import:${input.fileId}`, contactId: owners.get(address), addedAt: ctx.now() });
    if (!row) { skipped++; continue; }
    added++;
    const contactId = strOrNull(row, "contactId");
    if (contactId && channel === "email") await markBadge(ctx, contactId, reason);
  }
  return { added, skipped };
}

// ---- contacts.apply_optout

const OPTOUT_SOURCES = ["sms_stop", "email_unsubscribe", "link", "reply"];

export async function applyOptout(
  ctx: ContactsCtx, input: { channel: Channel; address: string; keyword: string; source: string; at?: number },
): Promise<{ suppressionId: string; contactId?: string }> {
  ensure(ctx);
  const channel = channelOf(ctx, input.channel);
  const address = normChannel(channel, typeof input.address === "string" ? input.address : "");
  if (!address) bad(ctx, "Address is not valid for this channel.");
  if (typeof input.keyword !== "string" || input.keyword.trim() === "" || input.keyword.length > 100) bad(ctx, "Keyword must be 1 to 100 characters.");
  if (!OPTOUT_SOURCES.includes(input.source)) bad(ctx, "Source must be sms_stop, email_unsubscribe, link or reply.");
  if (input.at !== undefined && (!Number.isSafeInteger(input.at) || input.at < 0)) bad(ctx, "Time is not valid.");
  const reason: Reason = input.source === "sms_stop" ? "stop" : "unsubscribe";
  const owners = await contactsOf(ctx, channel, [address]);
  const contactId = owners.get(address);

  // the address is suppressed once; a second STOP finds the first row and only makes sure the contact carries it
  const row = insertRow(ctx, { channel, address, reason, source: `optout:${input.source}`, note: input.keyword.trim(), contactId, addedAt: input.at ?? ctx.now() }) ?? onList(ctx, channel, address);
  if (!row) throw fail("internal.unexpected", ctx.trace.traceId);

  if (contactId && channel !== "call") {
    const rec = await getRecord(ctx, "contact", contactId);
    if (rec) {
      const before = prefsOf(rec.fields);
      const patch: { contactId: string; optedOut: Channel[]; source: string; emailConsent?: "denied"; smsConsent?: "denied" } = {
        contactId, optedOut: [...new Set([...before.optedOut, channel])], source: `${input.source}: ${input.keyword.trim()}`,
      };
      if (channel === "email") patch.emailConsent = "denied";
      if (channel === "sms") patch.smsConsent = "denied";
      await preferencesSet(ctx, patch);
    }
  }
  const out: { suppressionId: string; contactId?: string } = { suppressionId: str(row, "id") };
  if (contactId) out.contactId = contactId;
  return out;
}
