// A hold's task is titled by what the tool does (lane l-chrome2a): a link read is "Open example.com", never "Send a message" because the Gate files it under the send act; no module name or raw capability name reaches
// the title or the summary a person reads. A message is still "Send a message".
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { as, bot, parkInput } from "../fixtures/seed.ts";

async function park(over: Record<string, unknown>, id: string): Promise<{ title: string; summary: string }> {
  const h = harness();
  await h.call("gate.park", parkInput({ decisionId: id, ...over }), as(bot));
  const t = h.callsTo("tasks.create")[0]!.input as { title: string; summary: string };
  return { title: t.title, summary: t.summary };
}

test("a held link read is titled by the site it opens, with no message words and no module name", async () => {
  const t = await park({ capName: "automations.read_link", input: { url: "https://www.example.com/pricing?x=1" }, act: "send" }, "d_link");
  assert.equal(t.title, "Approve: Open example.com");
  assert.ok(!/message|automations|via/i.test(`${t.title} ${t.summary}`), `${t.title} / ${t.summary}`);
});

test("other held acts that are not messages read in their own words", async () => {
  const refund = await park({ capName: "stripe.refund.create", input: { chargeId: "ch_1", amount: 500 }, act: "pay" }, "d_refund");
  assert.equal(refund.title, "Approve: Refund a payment");
  const mcp = await park({ capName: "engine.mcp.read", input: { server: "x", tool: "list" }, act: "send" }, "d_mcp");
  assert.equal(mcp.title, "Approve: Read from an outside tool");
  assert.ok(!/message|engine\./i.test(`${mcp.title} ${mcp.summary}`), `${mcp.title} / ${mcp.summary}`);
  const docs = await park({ capName: "automations.read_docs", input: { url: "https://docs.example.com" }, act: "send" }, "d_docs");
  assert.equal(docs.title, "Approve: Read the documentation");
});

test("a message, an email and a text keep the message words", async () => {
  assert.equal((await park({ capName: "chat.message_person", input: { to: "usr_bob", body: "hi" }, act: "send" }, "d_dm")).title, "Approve: Send a message");
  assert.equal((await park({ capName: "mail.send", act: "send" }, "d_mail")).title, "Approve: Send an email");
});
