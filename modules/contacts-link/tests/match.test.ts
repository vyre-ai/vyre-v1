// contacts.resolve, contacts.address.*: the match rule (spec 2.18 Matching). An email, a phone number or a handle that a contact or company holds,
// exactly after normalising, is a sure match. A company on the sender's domain and a likeness of names are unsure matches. A name never is sure.
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd, addressList, addressRemove, addressSetPrimary, resolve } from "../handlers/match.ts";
import { hostOf, nameScore, SURE } from "../handlers/match.ts";
import { codeOf, contractErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Harness, HarnessOptions } from "../fixtures/harness.ts";
import { normalize, normPhone } from "../projections.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

function world(o: HarnessOptions = {}): Harness {
  const h = harness(o);
  h.contact("rec_maya01", { name: "Maya Cole", email: "maya@acme.com", phone: "+14155550123" });
  h.contact("rec_pat01", { name: "Pat Lee", email: "Pat.Lee@Gmail.com" });
  h.contact("rec_sam01", { name: "Sam Ortiz", phone: "+442071838750" });
  h.company("rec_acme1", { name: "Acme Corp", website: "https://www.acme.com", phone: "+14155550100" });
  h.company("rec_globex", { name: "Globex", website: "globex.io" });
  return h;
}

let keys = 0;
const key = (): string => `idem-${++keys}`;

// ---- the normal forms

test("an email, a phone number and a handle have one normal form", () => {
  assert.equal(normalize("email", "  Maya@Acme.COM "), "maya@acme.com");
  assert.equal(normalize("email", "not-an-email"), "");
  assert.equal(normPhone("+1 (415) 555-0123"), "+14155550123");
  assert.equal(normPhone("+44.20.7183.8750"), "+442071838750");
  assert.equal(normPhone("415-555-0123"), "");   // no country code
  assert.equal(normalize("handle", " @MayaCole "), "mayacole");
  assert.equal(hostOf("https://www.Acme.com/about"), "acme.com");
  assert.equal(hostOf("globex.io"), "globex.io");
  assert.equal(hostOf(""), "");
});

test("name likeness: the same words score 0.7, shared words up to 0.6, under half a share nothing", () => {
  assert.equal(nameScore("Maya Cole", "maya  COLE"), 0.7);
  assert.equal(nameScore("Cole Maya", "Maya Cole"), 0.6);
  assert.equal(nameScore("Maya", "Maya Cole"), 0.4);
  assert.equal(nameScore("Zed", "Maya Cole"), 0);
  assert.equal(nameScore("", "Maya"), 0);
  assert.ok(0.7 < SURE, "no name alone reaches a sure match");
});

// ---- sure matches

test("an email a record holds is a sure match, whatever its case or spacing", async () => {
  const h = world();
  const out = await resolve(h.ctx, { email: " MAYA@acme.COM " });
  assert.deepEqual(out.sure, [{ recordId: "rec_maya01", type: "contact", name: "Maya Cole", via: "address", score: 1 }]);
  assert.deepEqual(contractErrors("contacts.resolve", "out", out), []);
  const lower = await resolve(h.ctx, { email: "pat.lee@gmail.com" });   // stored as Pat.Lee@Gmail.com
  assert.deepEqual(lower.sure.map((c) => c.recordId), ["rec_pat01"]);
});

test("an address added to a contact matches like its own email, until it is removed", async () => {
  const h = world();
  const added = await addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "Sam.Ortiz@Work.test", idempotencyKey: key() });
  assert.deepEqual((await resolve(h.ctx, { email: "sam.ortiz@work.test" })).sure.map((c) => [c.recordId, c.via]), [["rec_sam01", "address"]]);
  await addressRemove(h.ctx, { contactId: "rec_sam01", addressId: added.address.id });
  const gone = await resolve(h.ctx, { email: "sam.ortiz@work.test" });
  assert.deepEqual([gone.sure, gone.unsure], [[], []]);
});

test("a phone number matches a contact or a company; the number is compared in E.164", async () => {
  const h = world();
  assert.deepEqual((await resolve(h.ctx, { phone: "+14155550123" })).sure, [{ recordId: "rec_maya01", type: "contact", name: "Maya Cole", via: "phone", score: 1 }]);
  assert.deepEqual((await resolve(h.ctx, { phone: "+14155550100" })).sure.map((c) => [c.recordId, c.type]), [["rec_acme1", "company"]]);
  await addressAdd(h.ctx, { contactId: "rec_pat01", kind: "phone", value: "+1 (212) 555-0188", idempotencyKey: key() });
  assert.deepEqual((await resolve(h.ctx, { phone: "+12125550188" })).sure.map((c) => c.recordId), ["rec_pat01"]);
  assert.deepEqual(contractErrors("contacts.resolve", "in", { phone: "+12125550188" }), []);
});

test("a handle matches only a handle on the address index", async () => {
  const h = world();
  await addressAdd(h.ctx, { contactId: "rec_maya01", kind: "handle", value: "@MayaCole", idempotencyKey: key() });
  assert.deepEqual((await resolve(h.ctx, { handle: "mayacole" })).sure.map((c) => [c.recordId, c.via]), [["rec_maya01", "handle"]]);
  assert.deepEqual((await resolve(h.ctx, { handle: "@MAYACOLE" })).sure.length, 1);
  assert.deepEqual((await resolve(h.ctx, { handle: "someoneelse" })).sure, []);
});

test("two records that hold one address are both sure, and the caller decides", async () => {
  const h = world();
  h.contact("rec_maya02", { name: "Aaron Cole", email: "maya@acme.com" });
  const out = await resolve(h.ctx, { email: "maya@acme.com" });
  assert.deepEqual(out.sure.map((c) => [c.recordId, c.score]), [["rec_maya02", 1], ["rec_maya01", 1]]);   // equal scores sort by name
});

// ---- unsure matches

test("a company on the sender's domain is an unsure match next to the contact", async () => {
  const h = world();
  const out = await resolve(h.ctx, { email: "maya@acme.com" });
  assert.deepEqual(out.sure.map((c) => c.recordId), ["rec_maya01"]);
  assert.deepEqual(out.unsure, [{ recordId: "rec_acme1", type: "company", name: "Acme Corp", via: "address", score: 0.5 }]);
  const stranger = await resolve(h.ctx, { email: "someone@acme.com" });
  assert.deepEqual([stranger.sure, stranger.unsure.map((c) => c.recordId)], [[], ["rec_acme1"]]);
  const sub = await resolve(h.ctx, { email: "a@mail.acme.com" });
  assert.deepEqual(sub.unsure.map((c) => c.recordId), ["rec_acme1"]);
});

test("a free mail domain says nothing about a company", async () => {
  const h = world();
  h.company("rec_gmail1", { name: "Gmail Holdings", website: "gmail.com" });
  const out = await resolve(h.ctx, { email: "nobody@gmail.com" });
  assert.deepEqual([out.sure, out.unsure], [[], []]);
});

test("a name is only ever an unsure match", async () => {
  const h = world();
  const exact = await resolve(h.ctx, { name: "maya cole" });
  assert.deepEqual([exact.sure, exact.unsure], [[], [{ recordId: "rec_maya01", type: "contact", name: "Maya Cole", via: "name", score: 0.7 }]]);
  assert.deepEqual((await resolve(h.ctx, { name: "Maya" })).unsure.map((c) => c.score), [0.4]);
  assert.deepEqual((await resolve(h.ctx, { name: "Zed Quinn" })).unsure, []);
  const company = await resolve(h.ctx, { name: "Acme" });   // one of the two words of "Acme Corp" is exactly half
  assert.deepEqual(company.unsure.map((c) => [c.recordId, c.type, c.score]), [["rec_acme1", "company", 0.4]]);
});

test("one candidate per record, at its best score, strongest first", async () => {
  const h = world();
  const out = await resolve(h.ctx, { email: "maya@acme.com", name: "Maya Cole", phone: "+14155550123" });
  assert.deepEqual(out.sure, [{ recordId: "rec_maya01", type: "contact", name: "Maya Cole", via: "address", score: 1 }]);
  assert.deepEqual(contractErrors("contacts.resolve", "out", out), []);
});

test("a name search pages through the record store", async () => {
  const h = harness({ pageSize: 2 });
  for (let i = 1; i <= 5; i++) h.contact(`rec_cole0${i}`, { name: `Alex Cole${i === 1 ? "" : ` ${i}`}` });
  const out = await resolve(h.ctx, { name: "Alex Cole" });
  assert.equal(out.unsure.length, 5);
  assert.ok(h.calls("records.query").length >= 3, "more than one page was read");
});

// ---- input

test("resolve needs something to match and refuses what is not an address", async () => {
  const h = world();
  await refused(resolve(h.ctx, {}), "validation.bad_input");
  await refused(resolve(h.ctx, { email: "nope" }), "validation.bad_input");
  await refused(resolve(h.ctx, { phone: "4155550123" }), "validation.bad_input");
  await refused(resolve(h.ctx, { handle: " @ " }), "validation.bad_input");
  await refused(resolve(h.ctx, { name: "  " }), "validation.bad_input");
  await refused(resolve(h.ctx, { name: "x".repeat(201) }), "validation.bad_input");
});

// ---- addresses

test("an address is added to a contact with an event, and the list shows it", async () => {
  const h = world();
  const input = { contactId: "rec_sam01", kind: "email" as const, value: " Sam@Work.test ", idempotencyKey: key() };
  const out = await addressAdd(h.ctx, input);
  assert.deepEqual(contractErrors("contacts.address.add", "out", out), []);
  assert.deepEqual([out.address.contactId, out.address.kind, out.address.value, out.address.primary, out.address.verified], ["rec_sam01", "email", "Sam@Work.test", false, false]);
  const row = h.rows(`SELECT * FROM contacts_address WHERE id = ?`, out.address.id)[0]!;
  assert.deepEqual([row.normalized, row.version, row.updated_at], ["sam@work.test", 1, NOW]);
  assert.deepEqual(h.named("contact.address_added").map((e) => [e.subject, e.payload]), [["record/rec_sam01", { contactId: "rec_sam01", kind: "email", addressId: out.address.id }]]);
  assert.deepEqual((await addressList(h.ctx, { contactId: "rec_sam01" })).addresses, [out.address]);
  assert.deepEqual(contractErrors("contacts.address.list", "out", await addressList(h.ctx, { contactId: "rec_sam01" })), []);
});

test("adding the same address to the same contact again returns its row and raises nothing more", async () => {
  const h = world();
  const a = await addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "sam@work.test", idempotencyKey: key() });
  const b = await addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "SAM@work.test", idempotencyKey: key() });
  assert.deepEqual(b, a);
  assert.equal(h.named("contact.address_added").length, 1);
  assert.equal(h.rows(`SELECT * FROM contacts_address`).length, 1);
});

test("an address another record holds, in the index or in its own email field, is a duplicate", async () => {
  const h = world();
  await refused(addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "maya@acme.com", idempotencyKey: key() }), "validation.duplicate");
  await addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "sam@work.test", idempotencyKey: key() });
  await refused(addressAdd(h.ctx, { contactId: "rec_pat01", kind: "email", value: "SAM@work.test", idempotencyKey: key() }), "validation.duplicate");
  await refused(addressAdd(h.ctx, { contactId: "rec_pat01", kind: "phone", value: "+14155550123", idempotencyKey: key() }), "validation.duplicate");
  assert.equal(h.rows(`SELECT * FROM contacts_address`).length, 1);
});

test("an address that is not one, a kind that does not exist or a record that is not there is refused", async () => {
  const h = world();
  await refused(addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "nope", idempotencyKey: key() }), "validation.bad_input");
  await refused(addressAdd(h.ctx, { contactId: "rec_sam01", kind: "phone", value: "4155550123", idempotencyKey: key() }), "validation.bad_input");
  await refused(addressAdd(h.ctx, { contactId: "rec_sam01", kind: "handle", value: " @ ", idempotencyKey: key() }), "validation.bad_input");
  await refused(addressAdd(h.ctx, { contactId: "rec_sam01", kind: "fax" as unknown as "email", value: "1", idempotencyKey: key() }), "validation.bad_input");
  await refused(addressAdd(h.ctx, { contactId: "contact-1", kind: "email", value: "a@b.test", idempotencyKey: key() }), "validation.bad_input");
  await refused(addressAdd(h.ctx, { contactId: "rec_nobody", kind: "email", value: "a@b.test", idempotencyKey: key() }), "validation.not_found");
  assert.equal(h.rows(`SELECT * FROM contacts_address`).length, 0);
});

test("a company can hold addresses too", async () => {
  const h = world();
  const out = await addressAdd(h.ctx, { contactId: "rec_acme1", kind: "email", value: "billing@acme.com", idempotencyKey: key() });
  assert.equal(out.address.contactId, "rec_acme1");
  assert.deepEqual((await resolve(h.ctx, { email: "billing@acme.com" })).sure.map((c) => [c.recordId, c.type]), [["rec_acme1", "company"]]);
});

test("a primary address becomes the record's own email, and the one it held stays as an address", async () => {
  const h = world();
  const out = await addressAdd(h.ctx, { contactId: "rec_maya01", kind: "email", value: "maya.cole@new.test", primary: true, idempotencyKey: key() });
  assert.equal(out.address.primary, true);
  assert.equal(h.records.get("rec_maya01")!.fields.email, "maya.cole@new.test");
  assert.deepEqual(h.calls("records.update").map((c) => c.input), [{ type: "contact", recordId: "rec_maya01", patch: { email: "maya.cole@new.test" } }]);
  const list = (await addressList(h.ctx, { contactId: "rec_maya01" })).addresses;
  assert.deepEqual(list.map((a) => [a.value, a.primary]), [["maya.cole@new.test", true], ["maya@acme.com", false]]);
  assert.deepEqual((await resolve(h.ctx, { email: "maya@acme.com" })).sure.map((c) => c.recordId), ["rec_maya01"]);   // the old address still matches
});

test("set_primary moves the flag between addresses of a kind and keeps exactly one", async () => {
  const h = world();
  await addressAdd(h.ctx, { contactId: "rec_maya01", kind: "email", value: "one@new.test", primary: true, idempotencyKey: key() });
  const b = await addressAdd(h.ctx, { contactId: "rec_maya01", kind: "email", value: "two@new.test", idempotencyKey: key() });
  const moved = await addressSetPrimary(h.ctx, { contactId: "rec_maya01", addressId: b.address.id });
  assert.equal(moved.address.primary, true);
  assert.deepEqual(contractErrors("contacts.address.set_primary", "out", moved), []);
  const flags = (await addressList(h.ctx, { contactId: "rec_maya01" })).addresses.filter((x) => x.kind === "email" && x.primary).map((x) => x.value);
  assert.deepEqual(flags, ["two@new.test"]);
  assert.equal(h.records.get("rec_maya01")!.fields.email, "two@new.test");
  assert.equal((await addressSetPrimary(h.ctx, { contactId: "rec_maya01", addressId: b.address.id })).address.id, b.address.id);   // already primary: no second update
  assert.equal(h.calls("records.update").length, 2);
});

test("only an email or phone can be primary, and a company has no email to make primary", async () => {
  const h = world();
  const handle = await addressAdd(h.ctx, { contactId: "rec_maya01", kind: "handle", value: "@maya", idempotencyKey: key() });
  await refused(addressSetPrimary(h.ctx, { contactId: "rec_maya01", addressId: handle.address.id }), "validation.bad_input");
  const co = await addressAdd(h.ctx, { contactId: "rec_acme1", kind: "email", value: "billing@acme.com", idempotencyKey: key() });
  await refused(addressSetPrimary(h.ctx, { contactId: "rec_acme1", addressId: co.address.id }), "validation.bad_input");
  await refused(addressSetPrimary(h.ctx, { contactId: "rec_pat01", addressId: handle.address.id }), "validation.not_found");   // not this contact's address
  const phone = await addressAdd(h.ctx, { contactId: "rec_acme1", kind: "phone", value: "+14155550177", primary: true, idempotencyKey: key() });
  assert.equal(h.records.get("rec_acme1")!.fields.phone, "+14155550177");
  assert.equal(phone.address.primary, true);
});

test("removing an address drops it from the list and the match, once; another contact's address is not removable", async () => {
  const h = world();
  const a = await addressAdd(h.ctx, { contactId: "rec_sam01", kind: "email", value: "sam@work.test", idempotencyKey: key() });
  assert.deepEqual(await addressRemove(h.ctx, { contactId: "rec_pat01", addressId: a.address.id }), { removed: false });
  assert.deepEqual(await addressRemove(h.ctx, { contactId: "rec_sam01", addressId: a.address.id }), { removed: true });
  assert.deepEqual(await addressRemove(h.ctx, { contactId: "rec_sam01", addressId: a.address.id }), { removed: false });
  assert.deepEqual((await addressList(h.ctx, { contactId: "rec_sam01" })).addresses, []);
  assert.deepEqual(h.named("contact.address_removed").map((e) => e.payload), [{ contactId: "rec_sam01", kind: "email", addressId: a.address.id }]);
  await refused(addressRemove(h.ctx, { contactId: "rec_sam01", addressId: "address-1" }), "validation.bad_input");
  // a removed address can be added again, to anyone
  assert.equal((await addressAdd(h.ctx, { contactId: "rec_pat01", kind: "email", value: "sam@work.test", idempotencyKey: key() })).address.contactId, "rec_pat01");
});
