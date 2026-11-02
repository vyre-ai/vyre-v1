// How a private line meets a contact's history (owner, 2 Nov). One rule: a text or call with a known contact is that contact's history, for whoever can open the record, and shows in the Inbox only for the people on the number.
// A text from an unknown number stays with them until it is matched to a contact. An assignee who cannot open the record reads their line and nothing else of that history.
import test from "node:test";
import assert from "node:assert/strict";
import { counts, linkMessage, listByContact, match, sendOptions, thread, unmatched } from "../handlers/index.ts";
import { harness } from "../fixtures/harness.ts";

const NOW = 1_760_000_000_000;
const LEE = { id: "rec_lee00001", type: "contact" as const, name: "Lee Pat", emails: ["pat@acme.test"], phones: ["+14155550177"] };
const link = (o: Record<string, unknown>) => ({ channel: "sms", ref: { kind: "sms", id: `sms_${Math.random().toString(36).slice(2)}` }, direction: "in", at: NOW, preview: "On my way", ...o });

async function world() {
  const h = harness({
    contacts: [LEE] as never,
    mailboxes: [{ id: "mbx_work1", address: "maya@firm.test", kind: "personal", state: "syncing", provider: "google" }] as never,
    numbers: [{ id: "num_front", e164: "+14155550123", state: "active", capabilities: ["voice", "sms"] }, { id: "num_back1", e164: "+14155550124", state: "active", capabilities: ["voice", "sms"] }],
  });
  const known = (await linkMessage(h.ctx, link({ address: "+14155550177", numberId: "num_front" }) as never)).conversationId as string;
  await linkMessage(h.ctx, link({ channel: "email", ref: { kind: "mail_message", id: "eml_lee1" }, address: "pat@acme.test", mailboxId: "mbx_work1", preview: "Private contract note" }) as never);
  const stranger = (await linkMessage(h.ctx, link({ address: "+14155550999", numberId: "num_front", preview: "Who is this?" }) as never)).conversationId as string;
  return { h, known, stranger };
}
const inList = async (h: ReturnType<typeof harness>): Promise<string[]> => ((await listByContact(h.ctx, {})).rows as unknown as { id: string }[]).map((r) => r.id);
const refused = async (p: Promise<unknown>): Promise<void> => { await assert.rejects(p, (e: { error?: { code?: string } }) => /not_found/.test(e.error?.code ?? "")); };

test("someone on the number sees a known contact's text in their Inbox, and the whole history when they can open the contact", async () => {
  const { h, known } = await world();
  h.onLines(["num_front"]);
  assert.ok((await inList(h)).includes(known));
  const seen = await thread(h.ctx, { contactId: LEE.id });
  assert.deepEqual(seen.items.map((i) => i.kind).sort(), ["email", "sms"]);
});

test("someone not on the number with access to the record: nothing in their Inbox, the text on the contact's Conversation tab", async () => {
  const { h, known } = await world();
  h.onLines([]);
  h.denied.add("mailbox:mbx_work1");
  assert.ok(!(await inList(h)).includes(known), "the Inbox is for the people on the line");
  const seen = await thread(h.ctx, { contactId: LEE.id });
  assert.ok(seen.items.some((i) => i.kind === "sms" && i.preview === "On my way"), "the history is for whoever can open the contact");
});

test("with no access to the record and not on the number: hidden, by contact and by id", async () => {
  const { h, known } = await world();
  h.onLines([]);
  h.denied.add(`record:${LEE.id}`).add("mailbox:mbx_work1");
  await refused(thread(h.ctx, { contactId: LEE.id }));
  await refused(thread(h.ctx, { conversationId: known }));
  assert.ok(!(await inList(h)).includes(known));
});

test("someone on the number who cannot open the record reads their line and nothing else of that history", async () => {
  const { h } = await world();
  h.onLines(["num_front"]);
  h.denied.add(`record:${LEE.id}`).add("mailbox:mbx_work1");
  const seen = await thread(h.ctx, { contactId: LEE.id });
  assert.deepEqual(seen.items.map((i) => i.preview), ["On my way"]);
});

test("taking someone off the number closes what only the number opened", async () => {
  const { h, known } = await world();
  h.onLines(["num_front"]);
  h.denied.add(`record:${LEE.id}`).add("mailbox:mbx_work1");
  assert.ok((await inList(h)).includes(known));
  h.onLines([]);
  assert.ok(!(await inList(h)).includes(known));
  await refused(thread(h.ctx, { conversationId: known }));
});

test("an unknown number stays with the people on the line until it is matched, then it is that contact's history", async () => {
  const { h, stranger } = await world();
  h.onLines(["num_front"]);
  assert.ok((await unmatched(h.ctx, {})).rows.some((r) => (r as unknown as { id: string }).id === stranger));
  await match(h.ctx, { conversationId: stranger, recordId: LEE.id } as never);
  h.onLines([]);
  h.denied.add("mailbox:mbx_work1");
  const seen = await thread(h.ctx, { contactId: LEE.id });
  assert.ok(seen.items.some((i) => i.preview === "Who is this?"), "matched: it joins the contact's history for whoever can open the contact");
});

test("an unknown number is closed to anyone else, by list and by id", async () => {
  const { h, stranger } = await world();
  h.onLines([]);
  assert.ok(!(await unmatched(h.ctx, {})).rows.some((r) => (r as unknown as { id: string }).id === stranger));
  await refused(thread(h.ctx, { conversationId: stranger }));
});

test("sending from a contact: only your numbers, the one the thread came in on, else the one you used last; none is an empty list the composer says so about", async () => {
  const { h } = await world();
  h.onLines(["num_front", "num_back1"], "num_back1");
  const both = await sendOptions(h.ctx, { contactId: LEE.id });
  assert.deepEqual(both.inboxes.filter((o) => o.kind === "number").map((o) => o.id).sort(), ["num_back1", "num_front"]);
  assert.equal(both.inboxes.find((o) => o.isDefault)?.id, "num_front", "a reply goes out on the number it came in on");
  h.onLines(["num_back1"], "num_back1");
  assert.equal((await sendOptions(h.ctx, { contactId: LEE.id })).inboxes.find((o) => o.kind === "number" && o.isDefault)?.id, "num_back1");
  h.onLines([]);
  assert.deepEqual((await sendOptions(h.ctx, { contactId: LEE.id })).inboxes.filter((o) => o.kind === "number"), []);
});

test("the sidebar counts a person's own numbers, never another's they reach through a contact's history", async () => {
  const { h } = await world();
  h.onLines(["num_front"]);
  assert.deepEqual((await counts(h.ctx)).byInbox.filter((c) => c.kind === "number").map((c) => c.id), ["num_front"]);
  h.onLines(["num_front", "num_back1"]);
  assert.deepEqual((await counts(h.ctx)).byInbox.filter((c) => c.kind === "number").map((c) => [c.id, c.unread > 0]), [["num_front", true], ["num_back1", false]], "a number with nothing unread stays listed: it can still send");
  h.onLines([]);
  assert.deepEqual((await counts(h.ctx)).byInbox.filter((c) => c.kind === "number"), []);
});
