// P-CC_39: inbox.item.erase removes the conversation entries of one message, text or call. The words of the item (preview, subject) are gone from the entry and from the conversation row; what other
// items say stays; a conversation left empty shows nothing; erasing again changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { itemErase, linkMessage } from "../handlers/index.ts";
import { contractErrors, eventErrors, harness, LEE, link, NOW } from "../fixtures/harness.ts";

const conv = (h: ReturnType<typeof harness>) => h.rows(`SELECT * FROM inbox_conversation`)[0] as Record<string, unknown>;
const itemRows = (h: ReturnType<typeof harness>) => h.rows(`SELECT id, "refId", preview FROM inbox_item ORDER BY at ASC`);

test("erasing one item removes its entry and its words; the conversation falls back to the item that remains", async () => {
  const h = harness({ contacts: [{ ...LEE }] });
  await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_keep0001", preview: "Thanks for the lunch", at: NOW + 1 }));
  await linkMessage(h.ctx, link({ channel: "sms", address: "+14155550177", id: "sms_gone0001", numberId: "num_main1", preview: "I want to change my will", at: NOW + 2 }));
  assert.equal(conv(h)["lastPreview"], "I want to change my will");
  const out = await itemErase(h.ctx, { refId: "sms_gone0001", idempotencyKey: "k1" });
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(contractErrors("inbox.item.erase", "out", out), []);
  assert.deepEqual(itemRows(h).map((r) => r["refId"]), ["eml_keep0001"]);
  assert.equal(conv(h)["lastPreview"], "Thanks for the lunch");
  assert.equal(conv(h)["lastChannel"], "email");
  assert.ok(!JSON.stringify([h.rows(`SELECT * FROM inbox_item`), h.rows(`SELECT * FROM inbox_conversation`)]).includes("change my will"), "the words are gone from every row");
  assert.deepEqual(h.named("inbox.item_erased").map((e) => e.payload), [{ refId: "sms_gone0001", removed: 1 }]);
  for (const e of h.named("inbox.item_erased")) assert.deepEqual(eventErrors(e.name, e.payload), []);
  assert.deepEqual(await itemErase(h.ctx, { refId: "sms_gone0001", idempotencyKey: "k2" }), { erased: false });
  assert.equal(h.named("inbox.item_erased").length, 1);
});

test("a conversation left with no items shows no preview and nothing unread, and stays the contact's", async () => {
  const h = harness({ contacts: [{ ...LEE }] });
  await linkMessage(h.ctx, link({ address: "pat@acme.test", id: "eml_only0001", preview: "My diagnosis is private", at: NOW + 1 }));
  assert.equal(conv(h)["unreadCount"], 1);
  await itemErase(h.ctx, { refId: "eml_only0001", idempotencyKey: "k1" });
  const c = conv(h);
  assert.deepEqual([c["lastPreview"], c["unreadCount"], c["lastMessageAt"], c["contactId"]], ["", 0, null, LEE.id]);
  assert.equal(itemRows(h).length, 0);
});
