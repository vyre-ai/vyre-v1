// contacts.dnd_screen (spec 2.18 Contact preferences and suppression; ARCH 8.2, lead ruling 22, the owner's standing rule):
// "Do-not-contact screening blocks adds only; it never removes or deletes a record or a person."
//
// This handler only READS. It answers which of the candidates being added to an audience, a campaign, a Journey enrolment or an import may be
// added and which may not. It writes nothing: no membership, no preference, no record, no list row. `removed` is always 0, so a screening run
// over a seeded audience changes zero existing memberships. A candidate is refused when its contact is marked Do-not-contact, or when its
// email or number is on the suppression list; every other candidate is allowed.
import { bad, ensure, holders, isId, normalize, normPhone, obj, queryRecords } from "../projections.ts";
import type { ContactsCtx } from "../projections.ts";
import { prefsOf } from "./prefs.ts";
import { reasonFor } from "./suppression.ts";
import type { Reason } from "./suppression.ts";

export interface Candidate {
  ref: string;
  contactId?: string;
  email?: string;
  phone?: string;
}

export interface Screened {
  allowed: string[];
  refused: { ref: string; reason: Reason }[];
  removed: 0;
}

const CONTEXTS = ["audience", "campaign", "journey_enrol", `import`];
const MAX_CANDIDATES = 20_000;
const BATCH = 200;

export async function dndScreen(ctx: ContactsCtx, input: { context: string; contextId?: string; candidates: Candidate[] }): Promise<Screened> {
  ensure(ctx);
  if (!CONTEXTS.includes(input.context)) bad(ctx, "Context must be audience, campaign, journey_enrol or import.");
  if (input.contextId !== undefined && (typeof input.contextId !== "string" || input.contextId.length > 200)) bad(ctx, "Context id must be text up to 200 characters.");
  if (!Array.isArray(input.candidates) || input.candidates.length === 0 || input.candidates.length > MAX_CANDIDATES) bad(ctx, `Candidates must be a list of 1 to ${MAX_CANDIDATES}.`);
  const refs = new Set<string>();
  for (const c of input.candidates) {
    if (!c || typeof c.ref !== "string" || c.ref === "" || c.ref.length > 200) bad(ctx, "Every candidate needs a ref of 1 to 200 characters.");
    if (refs.has(c.ref)) bad(ctx, `The ref "${c.ref}" appears twice.`);
    refs.add(c.ref);
    if (c.contactId !== undefined && !isId("rec", c.contactId)) bad(ctx, "Contact id is not valid.");
  }

  // contacts named by id, and contacts found by the address the candidate carries
  const emails = input.candidates.map((c) => (c.email === undefined ? "" : normalize("email", c.email)));
  const phones = input.candidates.map((c) => (c.phone === undefined ? "" : normPhone(c.phone)));
  const found = await holders(ctx, { emails: emails.filter(Boolean), phones: phones.filter(Boolean) });
  const contactsOf = (i: number): string[] => {
    const c = input.candidates[i] as Candidate;
    const ids = new Set<string>();
    if (c.contactId) ids.add(c.contactId);
    for (const id of found.get(`email:${emails[i]}`) ?? []) ids.add(id);
    for (const id of found.get(`phone:${phones[i]}`) ?? []) ids.add(id);
    return [...ids];
  };
  const wanted = [...new Set(input.candidates.flatMap((_, i) => contactsOf(i)))];
  const dnd = new Set<string>();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const chunk = wanted.slice(i, i + BATCH);
    for (const rec of await queryRecords(ctx, "contact", { field: "id", op: "in", value: chunk }, BATCH)) {
      if (prefsOf(obj(rec.fields)).doNotContact) dnd.add(rec.id);
    }
  }

  const allowed: string[] = [];
  const refused: { ref: string; reason: Reason }[] = [];
  input.candidates.forEach((c, i) => {
    let reason: Reason | null = contactsOf(i).some((id) => dnd.has(id)) ? "do_not_contact" : null;
    const email = emails[i] ?? "";
    const phone = phones[i] ?? "";
    if (!reason && email) reason = reasonFor(ctx, "email", email);
    if (!reason && phone) reason = reasonFor(ctx, "sms", phone);
    if (reason) refused.push({ ref: c.ref, reason });
    else allowed.push(c.ref);
  });
  return { allowed, refused, removed: 0 };
}
