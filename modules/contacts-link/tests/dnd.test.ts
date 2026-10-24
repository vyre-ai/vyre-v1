// contacts.dnd_screen: Do-not-contact screening blocks ADDS only (spec 2.18; ARCH 8.2; lead ruling 22, the owner's standing rule). A screening run
// over a seeded audience changes zero existing memberships and refuses only the new adds. The handler reads and never writes.
import test from "node:test";
import assert from "node:assert/strict";
import { dndScreen } from "../handlers/dnd.ts";
import type { Candidate } from "../handlers/dnd.ts";
import { suppressionAdd } from "../handlers/suppression.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

async function world(pageSize = 100): Promise<Harness> {
  const h = harness({ pageSize });
  h.contact("rec_dnd01", { name: "Dana Nix", email: "dnd@x.test", pref_do_not_contact: true });
  h.contact("rec_ok01", { name: "Olive Kay", email: "ok@x.test" });
  h.contact("rec_opt01", { name: "Opal Ray", email: "opt@x.test", pref_opt_outs: ["email"], pref_email_consent: "denied" });
  h.contact("rec_dnd02", { name: "Dane Roe", phone: "+14155550222", pref_do_not_contact: true });
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["bounced@x.test"], reason: "complaint" });
  await suppressionAdd(h.ctx, { channel: "sms", addresses: ["+14155550333"], reason: "stop" });
  return h;
}

const NEW_ADDS: Candidate[] = [
  { ref: "r1", contactId: "rec_dnd01" },
  { ref: "r2", email: "DND@x.test" },
  { ref: "r3", email: "ok@x.test" },
  { ref: "r4", email: "bounced@x.test" },
  { ref: "r5", phone: "+14155550333" },
  { ref: "r6", email: "unknown@x.test" },
  { ref: "r7", contactId: "rec_opt01" },
  { ref: "r8", phone: "+14155550222" },
];

test("candidates are refused for Do-not-contact or a suppressed address, and every other one is allowed", async () => {
  const h = await world();
  const input = { context: "campaign", contextId: "cmp_spring", candidates: NEW_ADDS };
  assert.deepEqual(contractErrors("contacts.dnd_screen", "in", input), []);
  const out = await dndScreen(h.ctx, input);
  assert.deepEqual(out.allowed, ["r3", "r6", "r7"]);   // r7 opted out of email but is not Do-not-contact: that is the send API's check, not the screen's
  assert.deepEqual(out.refused, [
    { ref: "r1", reason: "do_not_contact" }, { ref: "r2", reason: "do_not_contact" }, { ref: "r4", reason: "complaint" },
    { ref: "r5", reason: "stop" }, { ref: "r8", reason: "do_not_contact" },
  ]);
  assert.equal(out.removed, 0);
  assert.deepEqual(contractErrors("contacts.dnd_screen", "out", out), []);
});

test("adds only: a screening run over a seeded audience changes nothing that is already there", async () => {
  const h = await world();
  // the seeded audience: two people already in it, one of whom is marked Do-not-contact since they joined
  const audience = new Set(["rec_dnd01", "rec_ok01"]);
  const members = JSON.stringify([...audience]);
  const dbBefore = h.db.dump();
  const recordsBefore = JSON.stringify([...h.records.values()]);
  const writesBefore = h.writes.statements.length;
  const emittedBefore = h.emitted.length;

  const out = await dndScreen(h.ctx, { context: "audience", contextId: "aud_all", candidates: NEW_ADDS });

  assert.deepEqual(out.refused.map((r) => r.ref), ["r1", "r2", "r4", "r5", "r8"]);   // only the candidates handed in are judged
  assert.equal(out.removed, 0);
  assert.equal(JSON.stringify([...audience]), members, "memberships are not touched");
  assert.equal(h.db.dump(), dbBefore, "this module's tables are not touched");
  assert.equal(h.writes.statements.length, writesBefore, "no insert, update or delete ran");
  assert.equal(JSON.stringify([...h.records.values()]), recordsBefore, "no record changed");
  assert.equal(h.calls("records.update").length, 0);
  assert.equal(h.emitted.length, emittedBefore, "nothing was announced");
  assert.ok(h.records.has("rec_dnd01"), "the Do-not-contact person is still a person in the Space");
});

test("an existing member who is Do-not-contact can be refused as a new add and is still not removed", async () => {
  const h = await world();
  const dbBefore = h.db.dump();
  const out = await dndScreen(h.ctx, { context: "journey_enrol", candidates: [{ ref: "rec_dnd01", contactId: "rec_dnd01" }, { ref: "rec_ok01", contactId: "rec_ok01" }] });
  assert.deepEqual(out.allowed, ["rec_ok01"]);
  assert.deepEqual(out.refused, [{ ref: "rec_dnd01", reason: "do_not_contact" }]);
  assert.equal(out.removed, 0);
  assert.equal(h.db.dump(), dbBefore);
  assert.equal(h.records.size, 4);
});

test("Do-not-contact is named before a suppressed address, and an address two records hold is refused when either is Do-not-contact", async () => {
  const h = await world();
  await suppressionAdd(h.ctx, { channel: "email", addresses: ["dnd@x.test"], reason: "unsubscribe" });
  h.contact("rec_shared1", { name: "Shared One", email: "shared@x.test" });
  h.contact("rec_shared2", { name: "Shared Two", email: "shared@x.test", pref_do_not_contact: true });
  const out = await dndScreen(h.ctx, { context: `import`, candidates: [{ ref: "a", email: "dnd@x.test" }, { ref: "b", email: "shared@x.test" }] });
  assert.deepEqual(out.refused, [{ ref: "a", reason: "do_not_contact" }, { ref: "b", reason: "do_not_contact" }]);
});

test("a candidate with no usable address or contact is allowed, and a malformed address cannot refuse anyone", async () => {
  const h = await world();
  const out = await dndScreen(h.ctx, { context: `import`, candidates: [{ ref: "a" }, { ref: "b", email: "not-an-email" }, { ref: "c", phone: "555-0100" }, { ref: "d", contactId: "rec_nobody" }] });
  assert.deepEqual([out.allowed, out.refused], [["a", "b", "c", "d"], []]);
});

test("a big audience is screened in batches through the record store", async () => {
  const h = await world(100);
  const candidates: Candidate[] = [];
  for (let i = 0; i < 450; i++) {
    const id = `rec_bulk${String(i).padStart(3, "0")}`;
    h.contact(id, { name: `Bulk ${i}`, ...(i % 10 === 0 ? { pref_do_not_contact: true } : {}) });
    candidates.push({ ref: id, contactId: id });
  }
  const before = h.calls("records.query").length;
  const out = await dndScreen(h.ctx, { context: "audience", candidates });
  assert.equal(out.refused.length, 45);
  assert.equal(out.allowed.length, 405);
  assert.ok(out.refused.every((r) => r.reason === "do_not_contact" && Number(r.ref.slice(8)) % 10 === 0));
  assert.deepEqual(out.allowed.slice(0, 3), ["rec_bulk001", "rec_bulk002", "rec_bulk003"]);
  assert.equal(h.calls("records.query").length - before, 5, "batches of 200, 200 and 50 contacts; the full ones span two pages of 100");
});

test("the screen refuses input it cannot judge", async () => {
  const h = await world();
  const ok: Candidate[] = [{ ref: "a", email: "a@x.test" }];
  await refused(dndScreen(h.ctx, { context: "newsletter", candidates: ok }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", candidates: [] }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", candidates: [{ ref: "a" }, { ref: "a" }] }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", candidates: [{ ref: "" }] }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", candidates: [{ ref: "a", contactId: "contact-1" }] }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", contextId: "x".repeat(201), candidates: ok }), "validation.bad_input");
  await refused(dndScreen(h.ctx, { context: "audience", candidates: Array.from({ length: 20_001 }, (_, i) => ({ ref: `r${i}` })) }), "validation.bad_input");
});
