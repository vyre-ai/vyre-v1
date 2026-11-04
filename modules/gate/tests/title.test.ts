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

test("a calendar event is an event, not a message", async () => {
  const g = await park({ capName: "google.calendar.create_event", input: { summary: "Prep", attendees: [{ email: "a@b.c" }], start: { dateTime: "2026-11-04T14:00:00Z" } }, act: "send" }, "d_ev");
  assert.equal(g.title, "Approve: Add a calendar event");
  assert.ok(!/message|google/i.test(`${g.title} ${g.summary}`), `${g.title} / ${g.summary}`);
});

// An agent's own hold says who wants what, from the real input, in one sentence the card, the footer, the top bar and the task all share (lane l-threadreplies).
async function parkAs(over: Record<string, unknown>, id: string): Promise<{ title: string; summary: string; block: any }> {
  const h = harness();
  h.callee("access.principals.get", (i: any) => ({ principal: { name: i.principal.id === "agt_bot" ? "Intake" : i.principal.id === "usr_bob" ? "Noah Berg" : "Someone" } }));
  h.callee("access.principals.list", () => ({ principals: [{ id: "usr_bob", name: "Noah Berg" }, { id: "usr_cara", name: "Cara Lund" }] }));
  h.callee("files.get", () => ({ file: { name: "Q4 pricing.docx" } }));
  await h.call("gate.park", parkInput({ decisionId: id, ...over }), as(bot));
  const t = h.callsTo("tasks.create")[0]!.input as { title: string; summary: string; blocks: any[] };
  return { title: t.title, summary: t.summary, block: t.blocks[0] };
}

test("a held message names who the agent wants to message, from the id or from the handle it was given, with no Approve: in front", async () => {
  const byId = await parkAs({ capName: "chat.message_person", input: { to: "usr_bob", body: "The call is Thursday." }, act: "send" }, "s_dm1");
  assert.equal(byId.title, "Intake wants to message Noah Berg");
  assert.equal(byId.summary, "Intake wants to message Noah Berg");
  assert.equal(byId.block.data.outward.to[0].name, "Noah Berg", "the card's recipient carries the name");
  const byHandle = await parkAs({ capName: "chat.message_person", input: { to: "noah", body: "hi" }, act: "send" }, "s_dm2");
  assert.equal(byHandle.title, "Intake wants to message Noah Berg", "a first-name handle is found in the directory");
  assert.ok(!/Approve:|teammate/.test(`${byId.title} ${byHandle.title}`));
});

test("a held email names the addresses and a held file share names the file", async () => {
  const mail = await parkAs({ capName: "mail.send", input: { to: [{ address: "aliza@example.com" }], subject: "Retainer", text: "Dear Aliza" }, act: "send" }, "s_mail");
  assert.equal(mail.title, "Intake wants to email aliza@example.com");
  const share = await parkAs({ capName: "files.share_external", input: { fileId: "fil_1" }, act: "send" }, "s_share");
  assert.equal(share.title, "Intake wants to share Q4 pricing.docx with a link for someone outside the Space");
  assert.ok(!/Approve:/.test(share.title));
});

test("a hold nobody named keeps the act's own words", async () => {
  const h = harness();
  await h.call("gate.park", parkInput({ decisionId: "s_plain", capName: "stripe.refund.create", input: { chargeId: "ch_1", amount: 500 }, act: "pay" }), as(bot));
  assert.equal((h.callsTo("tasks.create")[0]!.input as { title: string }).title, "Approve: Refund a payment");
});

test("a hold for a bare verb names what it acts on from the capability's scope", async () => {
  const rec = await parkAs({ capName: "records.update", input: { type: "contact", recordId: "rec_1", patch: { name: "Renamed" } }, act: "approve" }, "s_rec");
  assert.equal(rec.title, "Intake wants to change a record");
  const file = await parkAs({ capName: "files.write", input: { fileId: "fil_1" }, act: "approve" }, "s_file");
  assert.equal(file.title, "Intake wants to edit a file");
});
