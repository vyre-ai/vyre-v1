// contacts.resolve, contacts.address.*, contacts.duplicates.* (spec 2.18 Matching: "every message matches a record by address or number; unsure
// matches go to Needs you"; "one contact record holds every email, phone and handle; likely duplicates are suggested; a merge keeps all history").
//
// The match rule. An email, a phone number or a handle that a contact or company holds, exactly after normalising, is a SURE match (score 1).
// A company whose website is on the sender's domain (never a free mail domain) and a record whose name resembles the given name are UNSURE
// matches (below 0.8): they are offered, never filed on their own. A free-text name never makes a sure match.
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, ensure, findRecord, first, holdersOf, isId, missing, nameOf, newId, normalize, normPhone, num, queryRecords, rowsOf, str, text } from "../projections.ts";
import type { ContactsCtx, RecordLite, RecordType, Row } from "../projections.ts";

export interface Candidate {
  recordId: string;
  type: RecordType;
  name: string;
  via: "address" | "phone" | "handle" | "name";
  score: number;
}

/** A score at or above this is a sure match. Exact addresses score 1; nothing else reaches it. */
export const SURE = 0.8;
const DOMAIN_SCORE = 0.5;
const NAME_EXACT = 0.7;

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "fastmail.com",
]);

/** The host of a website value, lower case, without a leading www. Empty when it is not a web address. */
export function hostOf(website: string): string {
  const w = website.trim();
  if (!w) return "";
  try {
    return new URL(w.includes("://") ? w : `https://${w}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const words = (name: string): string[] => name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** How alike two names are: 0.7 when they read the same, else up to 0.6 by the share of words they have in common, 0 below half. */
export function nameScore(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x.join(" ") === y.join(" ")) return NAME_EXACT;
  const same = x.filter((w) => y.includes(w));
  const share = new Set(same).size / new Set([...x, ...y]).size;
  return share >= 0.5 ? Math.round((0.2 + 0.4 * share) * 100) / 100 : 0;
}

// ---- contacts.resolve

export async function resolve(
  ctx: ContactsCtx, input: { email?: string; phone?: string; handle?: string; name?: string },
): Promise<{ sure: Candidate[]; unsure: Candidate[] }> {
  ensure(ctx);
  const email = input.email === undefined ? "" : normalize("email", input.email);
  const phone = input.phone === undefined ? "" : normPhone(input.phone);
  const handle = input.handle === undefined ? "" : normalize("handle", input.handle);
  const name = input.name === undefined ? "" : input.name.trim();
  if (input.email !== undefined && !email) bad(ctx, "Email is not an email address.");
  if (input.phone !== undefined && !phone) bad(ctx, "Phone is not a number with a country code, like +14155550123.");
  if (input.handle !== undefined && !handle) bad(ctx, "Handle is empty.");
  if (input.name !== undefined && (!name || name.length > 200)) bad(ctx, "Name must be from 1 to 200 characters.");
  if (!email && !phone && !handle && !name) bad(ctx, "Give an email, a phone number, a handle or a name.");

  const best = new Map<string, Candidate>();
  const known = new Map<string, RecordLite | null>();
  const lookup = async (id: string): Promise<RecordLite | null> => {
    if (!known.has(id)) known.set(id, await findRecord(ctx, id));
    return known.get(id) ?? null;
  };
  const keep = (rec: RecordLite, via: Candidate["via"], score: number): void => {
    const have = best.get(rec.id);
    if (!have || score > have.score) best.set(rec.id, { recordId: rec.id, type: rec.type, name: nameOf(rec), via, score });
  };
  const exact = async (kind: "email" | "phone" | "handle", value: string, via: Candidate["via"]): Promise<void> => {
    for (const id of await holdersOf(ctx, kind, value)) {
      const rec = await lookup(id);
      if (rec) keep(rec, via, 1);
    }
  };

  if (email) {
    await exact("email", email, "address");
    const domain = email.split("@")[1] ?? "";
    if (domain && !FREE_MAIL.has(domain)) {
      // a company site on the sender's domain, on a parent of it (mail.acme.com is acme.com) or on a subdomain of it
      const labels = domain.split(".");
      const suffixes = labels.slice(0, Math.max(1, labels.length - 1)).map((_, i) => labels.slice(i).join("."));
      for (const co of await queryRecords(ctx, "company", { or: suffixes.map((value) => ({ field: "website", op: "contains" as const, value })) }, 50)) {
        const host = hostOf(text(co.fields.website));
        if (host !== "" && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`))) keep(co, "address", DOMAIN_SCORE);
      }
    }
  }
  if (phone) await exact("phone", phone, "phone");
  if (handle) await exact("handle", handle, "handle");
  if (name) {
    const longest = words(name).sort((p, q) => q.length - p.length)[0] ?? "";
    if (longest) {
      for (const type of ["contact", "company"] as const) {
        for (const rec of await queryRecords(ctx, type, { field: "name", op: "contains", value: longest }, 200)) {
          const score = nameScore(name, nameOf(rec));
          if (score > 0) keep(rec, "name", score);
        }
      }
    }
  }

  const all = [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.recordId.localeCompare(b.recordId));
  return { sure: all.filter((c) => c.score >= SURE), unsure: all.filter((c) => c.score < SURE) };
}

// ---- contacts.address.*

export interface AddressOut {
  id: string;
  contactId: string;
  kind: "email" | "phone" | "handle";
  value: string;
  primary: boolean;
  verified: boolean;
}

const KINDS = ["email", "phone", "handle"] as const;

function addressOut(row: Row): AddressOut {
  const kind = str(row, "kind");
  return {
    id: str(row, "id"), contactId: str(row, "contactId"), kind: kind === "phone" ? "phone" : kind === "handle" ? "handle" : "email",
    value: str(row, "value"), primary: num(row, "primary") === 1, verified: num(row, "verified") === 1,
  };
}

function loadAddress(ctx: ContactsCtx, id: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM contacts_link_address WHERE id = ? AND deleted_at IS NULL`, id));
}

export async function addressList(ctx: ContactsCtx, input: { contactId: string }): Promise<{ addresses: AddressOut[] }> {
  ensure(ctx);
  if (!isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM contacts_link_address WHERE "contactId" = ? AND deleted_at IS NULL`, input.contactId));
  rows.sort((a, b) => num(b, "primary") - num(a, "primary") || num(b, "updated_at") - num(a, "updated_at") || str(a, "id").localeCompare(str(b, "id")));
  return { addresses: rows.map(addressOut) };
}

export async function addressAdd(
  ctx: ContactsCtx, input: { contactId: string; kind: "email" | "phone" | "handle"; value: string; primary?: boolean; idempotencyKey?: string },
): Promise<{ address: AddressOut }> {
  ensure(ctx);
  if (!isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (!KINDS.includes(input.kind)) bad(ctx, "Kind must be email, phone or handle.");
  if (typeof input.value !== "string") bad(ctx, "Value is required.");
  const normalized = normalize(input.kind, input.value);
  if (!normalized) bad(ctx, input.kind === "email" ? "Value is not an email address." : input.kind === "phone" ? "Value is not a phone number with a country code." : "Value is empty.");
  const rec = (await findRecord(ctx, input.contactId)) ?? missing(ctx, "That contact or company does not exist.");
  const wantPrimary = input.primary === true && input.kind !== "handle";

  // The address belongs to one record. The same record asking again gets its row back; another record holding it is a duplicate.
  const holders = await holdersOf(ctx, input.kind, normalized);
  if (holders.some((id) => id !== rec.id)) throw fail("validation.duplicate", ctx.trace.traceId, { message: "Another contact or company already holds that address." });
  const have = first(ctx.db.all(`SELECT * FROM contacts_link_address WHERE "contactId" = ? AND kind = ? AND normalized = ? AND deleted_at IS NULL`, rec.id, input.kind, normalized));
  let row = have;
  if (!row) {
    const now = ctx.now();
    const id = newId("adr", now);
    // The row as it is stored, built from the values written, so nothing is read back (and nothing can refuse) after the write.
    const made: Row = { id, contactId: rec.id, kind: input.kind, value: input.value.trim(), normalized, primary: 0, verified: 0, version: 1, updated_at: now, deleted_at: null };
    ctx.db.run(
      `INSERT INTO contacts_link_address (id, "contactId", kind, value, normalized, "primary", verified, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, rec.id, input.kind, input.value.trim(), normalized, 0, 0, 1, now, null,
    );
    ctx.emit("contact.address_added", `record/${rec.id}`, { contactId: rec.id, kind: input.kind, addressId: id });
    row = made;
  }
  if (wantPrimary && num(row, "primary") !== 1) row = await makePrimary(ctx, rec, row);
  return { address: addressOut(row) };
}

export async function addressRemove(ctx: ContactsCtx, input: { contactId: string; addressId: string }): Promise<{ removed: boolean }> {
  ensure(ctx);
  if (!isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (!isId("adr", input.addressId)) bad(ctx, "Address id is not valid.");
  const row = loadAddress(ctx, input.addressId);
  if (!row || str(row, "contactId") !== input.contactId) return { removed: false };
  const now = ctx.now();
  ctx.db.run(`UPDATE contacts_link_address SET deleted_at = ?, "primary" = ?, version = ?, updated_at = ? WHERE id = ?`, now, 0, num(row, "version") + 1, now, input.addressId);
  ctx.emit("contact.address_removed", `record/${input.contactId}`, { contactId: input.contactId, kind: str(row, "kind"), addressId: input.addressId });
  return { removed: true };
}

export async function addressSetPrimary(ctx: ContactsCtx, input: { contactId: string; addressId: string }): Promise<{ address: AddressOut }> {
  ensure(ctx);
  if (!isId("rec", input.contactId)) bad(ctx, "Contact id is not valid.");
  if (!isId("adr", input.addressId)) bad(ctx, "Address id is not valid.");
  const row = loadAddress(ctx, input.addressId);
  if (!row || str(row, "contactId") !== input.contactId) return missing(ctx, "That contact does not hold this address.");
  const rec = (await findRecord(ctx, input.contactId)) ?? missing(ctx, "That contact or company does not exist.");
  if (num(row, "primary") === 1) return { address: addressOut(row) };
  return { address: addressOut(await makePrimary(ctx, rec, row)) };
}

/**
 * Make an address the primary email or phone of its record: the record's own field takes the value, the one it held becomes an address of
 * its own (so no address is lost), and exactly one row of that kind is flagged primary.
 */
async function makePrimary(ctx: ContactsCtx, rec: RecordLite, row: Row): Promise<Row> {
  const kind = str(row, "kind");
  if (kind !== "email" && kind !== "phone") bad(ctx, "Only an email or a phone number can be primary.");
  if (kind === "email" && rec.type === "company") bad(ctx, "A company has no primary email.");
  const field = kind === "email" ? "email" : "phone";
  const now = ctx.now();
  const old = text(rec.fields[field]);
  const oldNorm = old ? normalize(kind, old) : "";
  if (oldNorm && oldNorm !== str(row, "normalized")) {
    const kept = first(ctx.db.all(`SELECT id FROM contacts_link_address WHERE "contactId" = ? AND kind = ? AND normalized = ? AND deleted_at IS NULL`, rec.id, kind, oldNorm));
    if (!kept) {
      const id = newId("adr", now);
      ctx.db.run(
        `INSERT INTO contacts_link_address (id, "contactId", kind, value, normalized, "primary", verified, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, rec.id, kind, old, oldNorm, 0, 0, 1, now, null,
      );
      ctx.emit("contact.address_added", `record/${rec.id}`, { contactId: rec.id, kind, addressId: id });
    }
  }
  await ctx.call("records.update", { type: rec.type, recordId: rec.id, patch: { [field]: str(row, "value") } });
  for (const other of rowsOf(ctx.db.all(`SELECT * FROM contacts_link_address WHERE "contactId" = ? AND kind = ? AND deleted_at IS NULL`, rec.id, kind))) {
    const flag = str(other, "id") === str(row, "id") ? 1 : 0;
    if (num(other, "primary") === flag) continue;
    ctx.db.run(`UPDATE contacts_link_address SET "primary" = ?, version = ?, updated_at = ? WHERE id = ?`, flag, num(other, "version") + 1, now, str(other, "id"));
  }
  return loadAddress(ctx, str(row, "id")) ?? row;
}

// ---- contacts.duplicates.*

export interface Suggestion {
  suggestionId: string;
  type: RecordType;
  ids: string[];
  score: number;
  reasons: string[];
}

const GROUP_CAP = 20;
const SUGGESTION = /^rec_[a-z0-9]+\|rec_[a-z0-9]+$/;

export const suggestionIdOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function duplicatesList(
  ctx: ContactsCtx, input: { type?: "contact" | "company"; cursor?: string; limit?: number },
): Promise<{ suggestions: Suggestion[]; next?: string; total: number }> {
  ensure(ctx);
  if (input.type !== undefined && input.type !== "contact" && input.type !== "company") bad(ctx, "Type must be contact or company.");
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "Limit must be from 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "Cursor is not valid.");
  const dismissed = new Set(rowsOf(ctx.db.all(`SELECT "suggestionId" FROM contacts_link_dismissed`)).map((r) => str(r, "suggestionId")));

  const found = new Map<string, Suggestion>();
  for (const type of input.type ? [input.type] : (["contact", "company"] as const)) {
    const records = await queryRecords(ctx, type, undefined, 5000);
    const byKey = new Map<string, { ids: Set<string>; reason: string; score: number }>();
    const put = (key: string, id: string, reason: string, score: number): void => {
      const g = byKey.get(key) ?? { ids: new Set<string>(), reason, score };
      g.ids.add(id);
      byKey.set(key, g);
    };
    const present = new Set(records.map((r) => r.id));
    for (const r of records) {
      const email = normalize("email", text(r.fields.email));
      const phone = normPhone(text(r.fields.phone));
      const host = hostOf(text(r.fields.website));
      const words2 = nameKey(nameOf(r));
      if (email) put(`email:${email}`, r.id, "same email address", 0.95);
      if (phone) put(`phone:${phone}`, r.id, "same phone number", 0.9);
      if (host) put(`site:${host}`, r.id, "same website", 0.9);
      if (words2.split(" ").length >= 2) {
        const withCompany = text(r.fields.company);
        put(withCompany ? `name+co:${words2}|${withCompany}` : `name:${words2}`, r.id, withCompany ? "same name and company" : "same name", withCompany ? 0.8 : 0.6);
      }
    }
    for (const a of rowsOf(ctx.db.all(`SELECT * FROM contacts_link_address WHERE deleted_at IS NULL`))) {
      const id = str(a, "contactId");
      if (!present.has(id)) continue;
      const kind = str(a, "kind");
      put(`${kind}:${str(a, "normalized")}`, id, kind === "email" ? "same email address" : kind === "phone" ? "same phone number" : "same handle", kind === "email" ? 0.95 : 0.9);
    }
    for (const g of byKey.values()) {
      const ids = [...g.ids].sort().slice(0, GROUP_CAP);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i] as string;
          const b = ids[j] as string;
          const sid = suggestionIdOf(a, b);
          if (dismissed.has(sid)) continue;
          const have = found.get(sid);
          if (!have) found.set(sid, { suggestionId: sid, type, ids: [a, b], score: g.score, reasons: [g.reason] });
          else {
            have.score = Math.max(have.score, g.score);
            if (!have.reasons.includes(g.reason)) have.reasons.push(g.reason);
          }
        }
      }
    }
  }
  const all = [...found.values()].sort((x, y) => y.score - x.score || x.suggestionId.localeCompare(y.suggestionId));
  const out: { suggestions: Suggestion[]; next?: string; total: number } = { suggestions: all.slice(offset, offset + limit), total: all.length };
  if (offset + limit < all.length) out.next = String(offset + limit);
  return out;
}

const nameKey = (name: string): string => words(name).join(" ");

export async function duplicatesDismiss(ctx: ContactsCtx, input: { suggestionId: string }): Promise<{ dismissed: boolean }> {
  ensure(ctx);
  if (typeof input.suggestionId !== "string" || !SUGGESTION.test(input.suggestionId)) bad(ctx, "Suggestion id is not valid.");
  const [a, b] = input.suggestionId.split("|") as [string, string];
  if (a === b) bad(ctx, "A record is not a duplicate of itself.");
  ctx.db.run(`INSERT OR IGNORE INTO contacts_link_dismissed ("suggestionId", "dismissedBy", "dismissedAt") VALUES (?, ?, ?)`, suggestionIdOf(a, b), ctx.principal.id, ctx.now());
  return { dismissed: true };
}
