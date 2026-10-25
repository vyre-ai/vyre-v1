// contacts.duplicates.list and .dismiss (spec 2.18 Matching: "likely duplicates are suggested; a merge keeps all history"). Suggestions are pairs of
// records that share an email, a phone number, a handle or a website, or the same two-word name; a dismissed pair is not suggested again.
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd, duplicatesDismiss, duplicatesList, suggestionIdOf } from "../handlers/match.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

function world(): Harness {
  const h = harness();
  h.contact("rec_a01", { name: "Maya Cole", email: "maya@acme.com", phone: "+14155550123" });
  h.contact("rec_a02", { name: "M. Cole", email: "Maya@Acme.com" });
  h.contact("rec_b01", { name: "Sam Ortiz", phone: "+14155550123" });
  h.contact("rec_c01", { name: "Pat Lee" });
  h.contact("rec_c02", { name: "pat  LEE" });
  h.contact("rec_d01", { name: "Lee", company: "rec_co1" });
  h.contact("rec_d02", { name: "Lee", company: "rec_co1" });
  h.company("rec_co1", { name: "Acme Corp", website: "https://www.acme.com" });
  h.company("rec_co2", { name: "Acme Corporation", website: "acme.com/about" });
  return h;
}

test("records that share an email, a phone number, a website or a two-word name are suggested, strongest first", async () => {
  const h = world();
  const out = await duplicatesList(h.ctx, {});
  assert.deepEqual(out.suggestions, [
    { suggestionId: "rec_a01|rec_a02", type: "contact", ids: ["rec_a01", "rec_a02"], score: 0.95, reasons: ["same email address"] },
    { suggestionId: "rec_a01|rec_b01", type: "contact", ids: ["rec_a01", "rec_b01"], score: 0.9, reasons: ["same phone number"] },
    { suggestionId: "rec_co1|rec_co2", type: "company", ids: ["rec_co1", "rec_co2"], score: 0.9, reasons: ["same website"] },
    { suggestionId: "rec_c01|rec_c02", type: "contact", ids: ["rec_c01", "rec_c02"], score: 0.6, reasons: ["same name"] },
  ]);
  assert.equal(out.total, 4);
  assert.deepEqual(contractErrors("contacts.duplicates.list", "out", out), []);
});

test("a one-word name alone is not a reason, even with the same company the single word is too common", async () => {
  const h = world();
  const out = await duplicatesList(h.ctx, {});
  assert.ok(!out.suggestions.some((s) => s.ids.includes("rec_d01")));
});

test("an address on the index counts like the record's own, and reasons add up on one pair", async () => {
  const h = world();
  await addressAdd(h.ctx, { contactId: "rec_c01", kind: "email", value: "pat@work.test", idempotencyKey: "k1" });
  await addressAdd(h.ctx, { contactId: "rec_c02", kind: "handle", value: "@patlee", idempotencyKey: "k2" });
  h.records.get("rec_c02")!.fields.email = "pat@work.test";
  const pair = (await duplicatesList(h.ctx, {})).suggestions.find((s) => s.suggestionId === "rec_c01|rec_c02")!;
  assert.deepEqual([pair.score, pair.reasons], [0.95, ["same name", "same email address"]]);
});

test("the type filter limits the suggestions to contacts or to companies", async () => {
  const h = world();
  assert.deepEqual((await duplicatesList(h.ctx, { type: "company" })).suggestions.map((s) => s.suggestionId), ["rec_co1|rec_co2"]);
  assert.equal((await duplicatesList(h.ctx, { type: "contact" })).total, 3);
  await refused(duplicatesList(h.ctx, { type: "person" as unknown as "contact" }), "validation.bad_input");
});

test("suggestions are paged with a cursor and a total", async () => {
  const h = world();
  const first = await duplicatesList(h.ctx, { limit: 3 });
  assert.deepEqual([first.suggestions.length, first.next, first.total], [3, "3", 4]);
  const rest = await duplicatesList(h.ctx, { limit: 3, cursor: first.next! });
  assert.deepEqual([rest.suggestions.map((s) => s.suggestionId), rest.next], [["rec_c01|rec_c02"], undefined]);
  await refused(duplicatesList(h.ctx, { limit: 0 }), "validation.bad_input");
  await refused(duplicatesList(h.ctx, { cursor: "x" }), "validation.bad_input");
});

test("a dismissed pair is not suggested again, in either order, and dismissing twice is harmless", async () => {
  const h = world();
  assert.deepEqual(await duplicatesDismiss(h.ctx, { suggestionId: "rec_a02|rec_a01" }), { dismissed: true });
  assert.deepEqual(await duplicatesDismiss(h.ctx, { suggestionId: "rec_a01|rec_a02" }), { dismissed: true });
  assert.equal(h.rows(`SELECT * FROM contacts_dismissed`).length, 1);
  assert.equal(h.rows(`SELECT * FROM contacts_dismissed`)[0]!.suggestionId, suggestionIdOf("rec_a01", "rec_a02"));
  const out = await duplicatesList(h.ctx, {});
  assert.deepEqual(out.suggestions.map((s) => s.suggestionId), ["rec_a01|rec_b01", "rec_co1|rec_co2", "rec_c01|rec_c02"]);
  assert.equal(h.records.size, 9, "dismissing keeps every record");
});

test("a suggestion id that is not a pair of records is refused", async () => {
  const h = world();
  await refused(duplicatesDismiss(h.ctx, { suggestionId: "rec_a01" }), "validation.bad_input");
  await refused(duplicatesDismiss(h.ctx, { suggestionId: "rec_a01|rec_a01" }), "validation.bad_input");
  await refused(duplicatesDismiss(h.ctx, { suggestionId: "a|b" }), "validation.bad_input");
  await refused(duplicatesDismiss(h.ctx, { suggestionId: "" }), "validation.bad_input");
});
