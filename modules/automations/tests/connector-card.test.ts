// The compact card the agent posts while it builds a connector: a checklist block as the agent, short rows, and never a key.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";
import { connectorCard } from "../handlers/connector-card.ts";

test("the card is one checklist block with a title and the rows as given, posted to the thread", async () => {
  const posts: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = harness({ calls: { "chat.post": (i) => { posts.push(i); return { message: { messageId: "msg_1" } }; } } });
  const out = await connectorCard(h.ctxFor("automations.connector_card", alice), { threadId: "thr_1", title: "Read tests", items: [{ text: "List domains: 200", done: true }, { text: "List API keys: 401", done: false }] });
  assert.deepEqual(out, { messageId: "msg_1" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].threadId, "thr_1");
  assert.deepEqual(posts[0].blocks, [{ type: "checklist", v: 1, data: { title: "Read tests", items: [{ text: "List domains: 200", done: true }, { text: "List API keys: 401", done: false }] } }]);
});

test("a card with no rows or a key in a row is refused", async () => {
  const h = harness({ calls: { "chat.post": () => ({ message: { messageId: "x" } }) } });
  const ctx = h.ctxFor("automations.connector_card", alice);
  await assert.rejects(connectorCard(ctx, { threadId: "thr_1", title: "t", items: [] }));
  await assert.rejects(connectorCard(ctx, { threadId: "thr_1", title: "t", items: [{ text: "Authorization: Bearer sk_live_abcdefghijklmnop123456", done: true }] }));   // secret-scan: fake
});
