// contacts.suppression.*, contacts.apply_optout (spec 2.18 Contact preferences and suppression): the one list the single send API consults for every
// sender; bounces, complaints, STOP and UNSUBSCRIBE write to it; only a person takes an address off it.
import test from "node:test";
import assert from "node:assert/strict";
import { applyOptout, suppressionAdd, suppressionCheck, suppressionImport, suppressionList, suppressionRemove } from "../handlers/suppression.ts";
import { addressAdd } from "../handlers/match.ts";
import { codeOf, contractErrors, harness, NOW } from "../fixtures/harness.ts";
import type { Harness, HarnessOptions } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

function world(o: HarnessOptions = {}): Harness {
  const h = harness(o);
  h.contact("rec_pat01", { name: "Pat Lee", email: "pat@x.test", phone: "+14155550123" });
  h.contact("rec_lee01", { name: "Lee Roe", email: "lee@x.test" });
  return h;
}

const live = (h: Harness) => h.rows(`SELECT * FROM contacts_suppression WHERE deleted_at IS NULL`);

// ---- add

test("an address is put on the list with its reason, who added it, and an event", async () => {
  const h = world();
  const out = await suppressionAdd(h.ctx, { channel: "email", addresses: ["Pat@X.test"], reason: "unsubscribe", source: "link", note: "asked in a reply" });
  assert.equal(out.added, 1);
  assert.deepEqual(contractErrors("contacts.suppression.add", "out", out), []);
  const [row] = out.rows;
  assert.deepEqual(
    [row!.channel, row!.address, row!.reason, row!.source, row!.addedBy, row!.addedAt, row!.note, row!.contactId],
    ["email", "pat@x.test", "unsubscribe", "link", "usr_maya01", NOW, "asked in a reply", "rec_pat01"],
  );
  assert.deepEqual(h.named("suppression.added").map((e) => [e.subject, e.payload]), [
    [`entity/${row!.id}`, { suppressionId: row!.id, channel: "email", reason: "unsubscribe", contactId: "rec_pat01" }],
  ]);
});

test("many addresses at once: normalised, repeats collapsed, addresses already listed skipped", async () => {
  const h = world();
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["a@x.test"], reason: "manual" });
  const out = await suppressionAdd(h.ctx, { channel: "email", addresses: ["A@x.test", " b@x.test", "B@X.TEST", "c@x.test"], reason: "bounce_hard" });
  assert.deepEqual(out.rows.map((r) => r.address), ["b@x.test", "c@x.test"]);
  assert.equal(out.added, 2);
  assert.equal(live(h).length, 3);
  assert.deepEqual(h.named("suppression.added").length, 3);
  assert.equal(live(h).find((r) => r.address === "a@x.test")!.reason, "manual", "the first reason stands");
});

test("a number is kept in E.164, and the same number on another channel is another row", async () => {
  const h = world();
  const out = await suppressionAdd(h.ctx, { channel: "sms", addresses: ["+1 (415) 555-0123"], reason: "stop" });
  assert.equal(out.rows[0]!.address, "+14155550123");
  assert.equal(out.rows[0]!.contactId, "rec_pat01");
  assert.equal((await suppressionAdd(h.ctx, { channel: "call", addresses: ["+14155550123"], reason: "manual" })).added, 1);
  assert.equal((await suppressionAdd(h.ctx, { channel: "sms", addresses: ["+14155550123"], reason: "manual" })).added, 0);
});

test("an address two records hold is not tied to either", async () => {
  const h = world();
  h.contact("rec_dup01", { name: "Pat Twin", email: "pat@x.test" });
  const out = await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "manual" });
  assert.equal(out.rows[0]!.contactId, undefined);
});

test("an address from the index is tied to its contact", async () => {
  const h = world();
  await addressAdd(h.ctx, { contactId: "rec_lee01", kind: "email", value: "lee@home.test", idempotencyKey: "k1" });
  assert.equal((await suppressionAdd(h.ctx, { channel: "email", addresses: ["lee@home.test"], reason: "manual" })).rows[0]!.contactId, "rec_lee01");
});

test("a hard bounce or a complaint shows on the contact's badge, and a complaint is never downgraded", async () => {
  const h = world();
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "bounce_hard" });
  assert.equal(h.records.get("rec_pat01")!.fields.deliverability, "bounced");
  h.records.get("rec_pat01")!.fields.deliverability = "complained";
  const updates = h.calls("records.update").length;
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["lee@x.test"], reason: "unsubscribe" });
  assert.equal(h.records.get("rec_lee01")!.fields.deliverability, undefined, "an unsubscribe is not a deliverability problem");
  h.contact("rec_new01", { name: "New", email: "new@x.test", deliverability: "complained" });
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["new@x.test"], reason: "bounce_hard" });
  assert.equal(h.records.get("rec_new01")!.fields.deliverability, "complained");
  assert.equal(h.calls("records.update").length, updates);
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["lee@x.test"], reason: "complaint" });   // already listed: nothing to do
  assert.equal(h.records.get("rec_lee01")!.fields.deliverability, undefined);
});

test("the badge is best effort: the list is written even when the record cannot be updated", async () => {
  const h = world();
  const call = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap === "records.update") throw new Error("records are down");
    return call(cap, input);
  };
  const out = await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "complaint" });
  assert.equal(out.added, 1);
  assert.equal(live(h).length, 1);
});

test("add refuses a channel, reason or address that does not fit, and writes nothing", async () => {
  const h = world();
  await refused(suppressionAdd(h.ctx, { channel: "fax" as unknown as "email", addresses: ["a@x.test"], reason: "manual" }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "email", addresses: ["a@x.test"], reason: "dislike" as unknown as "manual" }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "email", addresses: [], reason: "manual" }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "email", addresses: ["a@x.test", "nope"], reason: "manual" }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "sms", addresses: ["4155550123"], reason: "stop" }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "email", addresses: ["a@x.test"], reason: "manual", note: "x".repeat(1001) }), "validation.bad_input");
  await refused(suppressionAdd(h.ctx, { channel: "email", addresses: Array.from({ length: 5001 }, (_, i) => `a${i}@x.test`), reason: "manual" }), "validation.bad_input");
  assert.equal(live(h).length, 0);
});

// ---- check

test("the check answers with the strongest reason for each listed address, in the form it was stored", async () => {
  const h = world();
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["a@x.test"], reason: "manual" });
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["b@x.test"], reason: "unsubscribe" });
  h.ctx.db.run(
    `INSERT INTO contacts_suppression (id, channel, address, reason, source, "contactId", "addedAt", "addedBy", note, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "sup_second", "email", "b@x.test", "complaint", "test", null, NOW, "usr_x", null, 1, NOW, null,
  );
  const input = { channel: "email" as const, addresses: ["B@X.test", "c@x.test", "a@x.test", "A@x.test", "not an address"] };
  assert.deepEqual(contractErrors("contacts.suppression.check", "in", input), []);
  const out = await suppressionCheck(h.ctx, input);
  assert.deepEqual(out.suppressed, [{ address: "b@x.test", reason: "complaint" }, { address: "a@x.test", reason: "manual" }]);
  assert.deepEqual(contractErrors("contacts.suppression.check", "out", out), []);
});

test("the check keeps channels apart and ignores removed rows", async () => {
  const h = world();
  await suppressionAdd(h.ctx, { channel: "sms", addresses: ["+14155550123"], reason: "stop" });
  assert.deepEqual((await suppressionCheck(h.ctx, { channel: "sms", addresses: ["+14155550123"] })).suppressed, [{ address: "+14155550123", reason: "stop" }]);
  assert.deepEqual((await suppressionCheck(h.ctx, { channel: "call", addresses: ["+14155550123"] })).suppressed, []);
  assert.deepEqual((await suppressionCheck(h.ctx, { channel: "email", addresses: ["+14155550123"] })).suppressed, []);
  const [row] = live(h);
  await suppressionRemove(h.ctx, { suppressionId: String(row!.id) });
  assert.deepEqual((await suppressionCheck(h.ctx, { channel: "sms", addresses: ["+14155550123"] })).suppressed, []);
});

test("the check refuses nothing it can answer and a list it cannot", async () => {
  const h = world();
  await refused(suppressionCheck(h.ctx, { channel: "email", addresses: [] }), "validation.bad_input");
  await refused(suppressionCheck(h.ctx, { channel: "pager" as unknown as "email", addresses: ["a@x.test"] }), "validation.bad_input");
  await refused(suppressionCheck(h.ctx, { channel: "email", addresses: Array.from({ length: 5001 }, (_, i) => `a${i}@x.test`) }), "validation.bad_input");
  assert.deepEqual((await suppressionCheck(h.ctx, { channel: "email", addresses: ["whoever@x.test"] })).suppressed, []);
});

// ---- list

test("the list is newest first, filtered, searched and paged with a total", async () => {
  const h = world();
  const reasons = ["manual", "bounce_hard", "unsubscribe", "manual", "complaint"] as const;
  for (const [i, reason] of reasons.entries()) {
    h.advance(1000);
    await suppressionAdd(h.ctx, { channel: i === 3 ? "sms" : "email", addresses: [i === 3 ? "+14155550999" : `user${i}@x.test`], reason });
  }
  const all = await suppressionList(h.ctx, {});
  assert.equal(all.total, 5);
  assert.deepEqual(all.rows.map((r) => r.reason), ["complaint", "manual", "unsubscribe", "bounce_hard", "manual"]);
  assert.deepEqual(contractErrors("contacts.suppression.list", "out", all), []);
  assert.deepEqual((await suppressionList(h.ctx, { channel: "sms" })).rows.map((r) => r.address), ["+14155550999"]);
  assert.deepEqual((await suppressionList(h.ctx, { reason: "manual" })).total, 2);
  assert.deepEqual((await suppressionList(h.ctx, { query: "USER2" })).rows.map((r) => r.address), ["user2@x.test"]);
  assert.deepEqual((await suppressionList(h.ctx, { query: "zz%_" })).total, 0);
  const first = await suppressionList(h.ctx, { limit: 2 });
  assert.deepEqual([first.rows.length, first.next, first.total], [2, "2", 5]);
  const last = await suppressionList(h.ctx, { limit: 2, cursor: "4" });
  assert.deepEqual([last.rows.length, last.next], [1, undefined]);
  await refused(suppressionList(h.ctx, { limit: 0 }), "validation.bad_input");
  await refused(suppressionList(h.ctx, { cursor: "-1" }), "validation.bad_input");
  await refused(suppressionList(h.ctx, { reason: "dislike" as unknown as "manual" }), "validation.bad_input");
});

// ---- remove

test("a person takes an address off the list, audited by the event, and the check stops matching", async () => {
  const h = world();
  const added = await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "unsubscribe" });
  const id = added.rows[0]!.id;
  assert.deepEqual(await suppressionRemove(h.ctx, { suppressionId: id, note: "asked to hear from us again" }), { removed: true });
  assert.deepEqual(h.named("suppression.removed").map((e) => [e.subject, e.payload]), [
    [`entity/${id}`, { suppressionId: id, channel: "email", reason: "unsubscribe", contactId: "rec_pat01" }],
  ]);
  assert.equal(live(h).length, 0);
  assert.equal(h.rows(`SELECT * FROM contacts_suppression WHERE id = ?`, id)[0]!.note, "asked to hear from us again");
  await refused(suppressionRemove(h.ctx, { suppressionId: id }), "validation.not_found");
  assert.equal((await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "manual" })).added, 1);   // can be listed again
});

test("an agent or an automation cannot take an address off the list", async () => {
  for (const kind of ["agent", "service", "actor"] as const) {
    const h = world({ principal: { kind, id: kind === "agent" ? "agt_scout01" : `${kind === "service" ? "svc" : "act"}_engine01` } });
    const added = await suppressionAdd(h.ctx, { channel: "email", addresses: ["pat@x.test"], reason: "complaint" });
    await refused(suppressionRemove(h.ctx, { suppressionId: added.rows[0]!.id }), "validation.precondition_failed");
    assert.equal(live(h).length, 1);
  }
  const h = world();
  await refused(suppressionRemove(h.ctx, { suppressionId: "sup-1" }), "validation.bad_input");
  await refused(suppressionRemove(h.ctx, { suppressionId: "sup_nothing" }), "validation.not_found");
});

// ---- import

test("an import adds the first column of a file, skipping the header, blanks, repeats, bad values and what is listed", async () => {
  const h = world();
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["old@x.test"], reason: "manual" });
  h.files.set("fil_list1", "Email,Name\r\nnew1@x.test,One\n\n\"New2@X.test\";Two\nnot-an-email,Three\nnew1@x.test,Again\nold@x.test,Old\nnew3@x.test\n");
  const out = await suppressionImport(h.ctx, { channel: "email", fileId: "fil_list1", idempotencyKey: "k1" });
  assert.deepEqual(out, { added: 3, skipped: 3 });
  assert.deepEqual(contractErrors(`contacts.suppression.import`, "out", out), []);
  const rows = live(h).filter((r) => r.source !== "manual");
  assert.deepEqual(rows.map((r) => [r.address, r.reason, r.source]).sort(), [
    ["new1@x.test", `import`, "import:fil_list1"], ["new2@x.test", `import`, "import:fil_list1"], ["new3@x.test", `import`, "import:fil_list1"],
  ]);
  assert.equal(h.named("suppression.added").length, 4);
});

test("an import can give its own reason, takes numbers for text channels, and ties rows to contacts", async () => {
  const h = world();
  h.files.set("fil_stops1", "phone\n+14155550123\n+1 (212) 555-0100\n12345\n");
  const out = await suppressionImport(h.ctx, { channel: "sms", fileId: "fil_stops1", reason: "stop", idempotencyKey: "k2" });
  assert.deepEqual(out, { added: 2, skipped: 1 });
  const rows = live(h);
  assert.deepEqual(rows.map((r) => [r.address, r.reason]).sort(), [["+12125550100", "stop"], ["+14155550123", "stop"]]);
  assert.equal(rows.find((r) => r.address === "+14155550123")!.contactId, "rec_pat01");
});

test("an import refuses a file it cannot read whole and one that is not there", async () => {
  const h = world();
  const call = h.ctx.call.bind(h.ctx);
  h.files.set("fil_big001", "a@x.test\n");
  h.ctx.call = async (cap, input) => (cap === "files.read" ? { text: "a@x.test", mime: "text/csv", size: 99, version: 1, truncated: true } : call(cap, input));
  await refused(suppressionImport(h.ctx, { channel: "email", fileId: "fil_big001" }), "validation.precondition_failed");
  h.ctx.call = call;
  await refused(suppressionImport(h.ctx, { channel: "email", fileId: "fil_nothing" }), "validation.not_found");
  await refused(suppressionImport(h.ctx, { channel: "email", fileId: "file-1" }), "validation.bad_input");
  await refused(suppressionImport(h.ctx, { channel: "email", fileId: "fil_big001", reason: "dislike" as unknown as `import` }), "validation.bad_input");
  assert.equal(live(h).length, 0);
});

// ---- apply_optout

test("STOP by text suppresses the number, opts the contact out of text and withdraws text consent, once", async () => {
  const h = world();
  const input = { channel: "sms" as const, address: "+14155550123", keyword: "STOP", source: "sms_stop" as const, at: NOW - 1000 };
  assert.deepEqual(contractErrors("contacts.apply_optout", "in", input), []);
  const out = await applyOptout(h.ctx, input);
  assert.deepEqual(out.contactId, "rec_pat01");
  assert.deepEqual(contractErrors("contacts.apply_optout", "out", out), []);
  const row = live(h)[0]!;
  assert.deepEqual([row.id, row.channel, row.address, row.reason, row.source, row.note, row.addedAt], [out.suppressionId, "sms", "+14155550123", "stop", "optout:sms_stop", "STOP", NOW - 1000]);
  const fields = h.records.get("rec_pat01")!.fields;
  assert.deepEqual([fields.pref_opt_outs, fields.pref_sms_consent, fields.pref_source, fields.pref_email_consent], [["sms"], "denied", "sms_stop: STOP", undefined]);
  assert.deepEqual(h.named("contact.preferences_changed").map((e) => e.payload), [{ contactId: "rec_pat01", changed: ["smsConsent", "optedOut"], source: "sms_stop: STOP" }]);
  assert.equal(h.named("suppression.added").length, 1);

  const again = await applyOptout(h.ctx, { ...input, keyword: "STOPALL" });   // a second STOP finds the first row and changes nothing
  assert.deepEqual(again, out);
  assert.equal(live(h).length, 1);
  assert.equal(h.named("suppression.added").length, 1);
  assert.equal(h.named("contact.preferences_changed").length, 1);
});

test("an email unsubscribe suppresses the address as unsubscribed and withdraws email consent", async () => {
  const h = world();
  const out = await applyOptout(h.ctx, { channel: "email", address: "Pat@X.test", keyword: "unsubscribe", source: "email_unsubscribe" });
  assert.equal(out.contactId, "rec_pat01");
  assert.deepEqual([live(h)[0]!.reason, live(h)[0]!.address, live(h)[0]!.addedAt], ["unsubscribe", "pat@x.test", NOW]);
  const fields = h.records.get("rec_pat01")!.fields;
  assert.deepEqual([fields.pref_opt_outs, fields.pref_email_consent, fields.pref_sms_consent], [["email"], "denied", undefined]);
  // an opt-out the contact already carries on the other channel is kept
  await applyOptout(h.ctx, { channel: "sms", address: "+14155550123", keyword: "STOP", source: "sms_stop" });
  assert.deepEqual([...(h.records.get("rec_pat01")!.fields.pref_opt_outs as string[])].sort(), ["email", "sms"]);
});

test("an opt-out from a stranger is still suppressed, and a call number is suppressed without touching any contact", async () => {
  const h = world();
  const stranger = await applyOptout(h.ctx, { channel: "email", address: "nobody@x.test", keyword: "STOP", source: "reply" });
  assert.equal(stranger.contactId, undefined);
  assert.equal(h.calls("records.update").length, 0);
  const call = await applyOptout(h.ctx, { channel: "call", address: "+14155550123", keyword: "do not call", source: "link" });
  assert.equal(call.contactId, "rec_pat01");
  assert.equal(h.calls("records.update").length, 0, "calls have no consent field to withdraw");
  assert.deepEqual(live(h).map((r) => [r.channel, r.reason]).sort(), [["call", "unsubscribe"], ["email", "unsubscribe"]]);
});

test("opt-outs refuse what they cannot apply", async () => {
  const h = world();
  const ok = { channel: "email" as const, address: "a@x.test", keyword: "STOP", source: "reply" as const };
  await refused(applyOptout(h.ctx, { ...ok, channel: "fax" as unknown as "email" }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, address: "nope" }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, channel: "sms", address: "4155550123" }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, keyword: "  " }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, keyword: "x".repeat(101) }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, source: "carrier" as unknown as "reply" }), "validation.bad_input");
  await refused(applyOptout(h.ctx, { ...ok, at: -5 }), "validation.bad_input");
  assert.equal(live(h).length, 0);
});
