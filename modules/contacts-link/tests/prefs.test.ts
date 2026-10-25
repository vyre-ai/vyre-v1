// contacts.preferences.get and .set, contacts.deliverability, contacts.route_owner (spec 2.18 Contact preferences and suppression, Contact owner,
// Message status and deliverability). The preferences live on the contact record; deliverability is read from the list and the record; the owner
// of an unowned reply is the contact's owner, then the campaign's, then the shared inbox.
import test from "node:test";
import assert from "node:assert/strict";
import { deliverability, preferencesGet, preferencesSet, routeOwner } from "../handlers/prefs.ts";
import { addressAdd } from "../handlers/match.ts";
import { codeOf, contractErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

function seedSuppression(h: Harness, o: { id: string; channel?: string; address: string; reason: string; contactId?: string; at?: number; deleted?: boolean }): void {
  h.ctx.db.run(
    `INSERT INTO contacts_suppression (id, channel, address, reason, source, "contactId", "addedAt", "addedBy", note, version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.id, o.channel ?? "email", o.address, o.reason, "test", o.contactId ?? null, o.at ?? NOW, "usr_maya01", null, 1, NOW, o.deleted ? NOW : null,
  );
}

// ---- preferences

test("a contact with nothing set has unknown consent, is not Do-not-contact and has no opt-outs", async () => {
  const h = harness();
  h.contact("rec_pat01", { name: "Pat Lee" });
  const out = await preferencesGet(h.ctx, { contactId: "rec_pat01" });
  assert.deepEqual(out, { emailConsent: "unknown", smsConsent: "unknown", doNotContact: false, optedOut: [] });
  assert.deepEqual(contractErrors("contacts.preferences.get", "out", out), []);
});

test("the preferences a record holds are read back", async () => {
  const h = harness();
  h.contact("rec_pat01", { pref_email_consent: "granted", pref_sms_consent: "denied", pref_do_not_contact: true, pref_opt_outs: ["sms", "call", "fax"], pref_source: "form", pref_at: 123 });
  assert.deepEqual(await preferencesGet(h.ctx, { contactId: "rec_pat01" }), {
    emailConsent: "granted", smsConsent: "denied", doNotContact: true, optedOut: ["sms", "call"], source: "form", at: 123,
  });
});

test("setting preferences writes the changed fields, stamps the source and the time, and says what changed", async () => {
  const h = harness();
  h.contact("rec_pat01", { name: "Pat Lee" });
  const input = { contactId: "rec_pat01", emailConsent: "granted" as const, optedOut: ["sms" as const], source: "form" };
  assert.deepEqual(contractErrors("contacts.preferences.set", "in", input), []);
  const out = await preferencesSet(h.ctx, input);
  assert.deepEqual(out, { emailConsent: "granted", smsConsent: "unknown", doNotContact: false, optedOut: ["sms"], source: "form", at: NOW });
  assert.deepEqual(contractErrors("contacts.preferences.set", "out", out), []);
  assert.deepEqual(h.calls("records.update").map((c) => c.input), [
    { type: "contact", recordId: "rec_pat01", patch: { pref_email_consent: "granted", pref_opt_outs: ["sms"], pref_source: "form", pref_at: NOW } },
  ]);
  assert.deepEqual(h.named("contact.preferences_changed").map((e) => [e.subject, e.payload]), [
    ["record/rec_pat01", { contactId: "rec_pat01", changed: ["emailConsent", "optedOut"], source: "form" }],
  ]);
});

test("without a source the change is stamped manual, and Do-not-contact can be set and cleared", async () => {
  const h = harness();
  h.contact("rec_pat01", {});
  assert.equal((await preferencesSet(h.ctx, { contactId: "rec_pat01", doNotContact: true })).source, "manual");
  assert.equal((await preferencesGet(h.ctx, { contactId: "rec_pat01" })).doNotContact, true);
  h.advance(1000);
  const cleared = await preferencesSet(h.ctx, { contactId: "rec_pat01", doNotContact: false, smsConsent: "denied" });
  assert.deepEqual([cleared.doNotContact, cleared.smsConsent, cleared.at], [false, "denied", NOW + 1000]);
  assert.deepEqual(h.named("contact.preferences_changed").map((e) => e.payload.changed), [["doNotContact"], ["smsConsent", "doNotContact"]]);
});

test("a call that changes nothing writes nothing and announces nothing", async () => {
  const h = harness();
  h.contact("rec_pat01", { pref_email_consent: "granted", pref_opt_outs: ["sms", "call"], pref_source: "form", pref_at: 5 });
  const out = await preferencesSet(h.ctx, { contactId: "rec_pat01", emailConsent: "granted", optedOut: ["call", "sms"], doNotContact: false, source: "other" });
  assert.deepEqual([out.source, out.at], ["form", 5]);
  assert.equal(h.calls("records.update").length, 0);
  assert.equal(h.emitted.length, 0);
});

test("opt-outs listed twice are kept once", async () => {
  const h = harness();
  h.contact("rec_pat01", {});
  const out = await preferencesSet(h.ctx, { contactId: "rec_pat01", optedOut: ["email", "email", "sms"] });
  assert.deepEqual(out.optedOut, ["email", "sms"]);
});

test("preferences refuse values that are not choices and contacts that are not there", async () => {
  const h = harness();
  h.contact("rec_pat01", {});
  h.company("rec_acme1", {});
  await refused(preferencesSet(h.ctx, { contactId: "rec_pat01", emailConsent: "maybe" as unknown as "granted" }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "rec_pat01", smsConsent: "" as unknown as "granted" }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "rec_pat01", doNotContact: "yes" as unknown as boolean }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "rec_pat01", optedOut: ["fax"] as unknown as ["email"] }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "rec_pat01", source: "x".repeat(201) }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "pat", doNotContact: true }), "validation.bad_input");
  await refused(preferencesSet(h.ctx, { contactId: "rec_nobody", doNotContact: true }), "validation.not_found");
  await refused(preferencesGet(h.ctx, { contactId: "rec_acme1" }), "validation.not_found");   // a company has no preferences group
  assert.equal(h.calls("records.update").length, 0);
});

// ---- deliverability

test("a contact with no events is good", async () => {
  const h = harness();
  h.contact("rec_pat01", { email: "pat@x.test" });
  const out = await deliverability(h.ctx, { contactId: "rec_pat01" });
  assert.deepEqual(out, { state: "good", reasons: [] });
  assert.deepEqual(contractErrors("contacts.deliverability", "out", out), []);
});

test("a complaint on the contact's email makes the badge complained, with when and why", async () => {
  const h = harness();
  h.contact("rec_pat01", { email: "Pat@x.test" });
  seedSuppression(h, { id: "sup_c1", address: "pat@x.test", reason: "complaint", at: NOW - 5000 });
  const out = await deliverability(h.ctx, { contactId: "rec_pat01" });
  assert.deepEqual(out, { state: "complained", lastEventAt: NOW - 5000, reasons: ["complaint: pat@x.test"] });
  assert.deepEqual(contractErrors("contacts.deliverability", "out", out), []);
});

test("a hard bounce makes it bounced, a complaint outranks it, and an address from the index counts", async () => {
  const h = harness();
  h.contact("rec_pat01", { email: "pat@x.test" });
  await addressAdd(h.ctx, { contactId: "rec_pat01", kind: "email", value: "pat@home.test", idempotencyKey: "k1" });
  seedSuppression(h, { id: "sup_b1", address: "pat@x.test", reason: "bounce_hard", at: NOW - 1000 });
  assert.deepEqual((await deliverability(h.ctx, { contactId: "rec_pat01" })).state, "bounced");
  seedSuppression(h, { id: "sup_c1", address: "pat@home.test", reason: "complaint", at: NOW - 2000 });
  const out = await deliverability(h.ctx, { contactId: "rec_pat01" });
  assert.deepEqual(out, { state: "complained", lastEventAt: NOW - 1000, reasons: ["complaint: pat@home.test", "hard bounce: pat@x.test"] });
});

test("a row tied to the contact counts even when its address is not on the record any more", async () => {
  const h = harness();
  h.contact("rec_pat01", { email: "pat@new.test" });
  seedSuppression(h, { id: "sup_b1", address: "pat@old.test", reason: "bounce_hard", contactId: "rec_pat01" });
  assert.equal((await deliverability(h.ctx, { contactId: "rec_pat01" })).state, "bounced");
});

test("unsubscribes, removed rows and other people's rows do not count; the record's own badge does", async () => {
  const h = harness();
  h.contact("rec_pat01", { email: "pat@x.test" });
  seedSuppression(h, { id: "sup_u1", address: "pat@x.test", reason: "unsubscribe" });
  seedSuppression(h, { id: "sup_d1", address: "pat@x.test", reason: "complaint", deleted: true });
  seedSuppression(h, { id: "sup_o1", address: "other@x.test", reason: "complaint" });
  seedSuppression(h, { id: "sup_s1", channel: "sms", address: "+14155550123", reason: "stop", contactId: "rec_pat01" });
  assert.deepEqual(await deliverability(h.ctx, { contactId: "rec_pat01" }), { state: "good", reasons: [] });
  h.records.get("rec_pat01")!.fields.deliverability = "risky";
  assert.deepEqual(await deliverability(h.ctx, { contactId: "rec_pat01" }), { state: "risky", reasons: ["marked risky on the record"] });
  await refused(deliverability(h.ctx, { contactId: "rec_nobody" }), "validation.not_found");
});

// ---- route_owner

test("an unowned reply goes to the contact's owner first", async () => {
  const h = harness();
  h.contact("rec_pat01", { owner: "usr_ann01" });
  h.campaigns.set("cmp_spring", { owner: "usr_bob01" });
  const out = await routeOwner(h.ctx, { contactId: "rec_pat01", campaignId: "cmp_spring", mailboxId: "mbx_hello" });
  assert.deepEqual(out, { ownerId: "usr_ann01", via: "owner" });
  assert.deepEqual(contractErrors("contacts.route_owner", "out", out), []);
  assert.equal(h.calls("campaigns.get").length, 0);
});

test("then to the campaign's owner, then to the shared inbox", async () => {
  const h = harness();
  h.contact("rec_pat01", { name: "No owner" });
  h.campaigns.set("cmp_spring", { owner: "usr_bob01" });
  assert.deepEqual(await routeOwner(h.ctx, { contactId: "rec_pat01", campaignId: "cmp_spring" }), { ownerId: "usr_bob01", via: "campaign_owner" });
  assert.deepEqual(await routeOwner(h.ctx, { contactId: "rec_pat01", mailboxId: "mbx_hello" }), { via: "shared_inbox", mailboxId: "mbx_hello" });
  assert.deepEqual(await routeOwner(h.ctx, {}), { via: "shared_inbox" });
  assert.deepEqual(await routeOwner(h.ctx, { contactId: "rec_nobody", mailboxId: "mbx_hello" }), { via: "shared_inbox", mailboxId: "mbx_hello" });
});

test("route_owner refuses ids that are not ids", async () => {
  const h = harness();
  await refused(routeOwner(h.ctx, { contactId: "pat" }), "validation.bad_input");
  await refused(routeOwner(h.ctx, { campaignId: "spring" }), "validation.bad_input");
  await refused(routeOwner(h.ctx, { mailboxId: "hello" }), "validation.bad_input");
});
