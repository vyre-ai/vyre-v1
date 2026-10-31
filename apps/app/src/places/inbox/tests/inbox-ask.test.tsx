// "Ask for these" (record page to Inbox): a record with an email or phone opens the person's conversation with a message drafted for the fields it lacks, and a quick form when the Space can
// make one. The drafts, the quick form's link, who can use a quick form, the people a record can ask, and the composer that shows all of it. Nothing is ever sent by the ask itself.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { ContactTab, fromMenuEntries } from "../contacttab/index.ts";
import { ASK_SUBJECT, QUICK_FORM_NOTE, askRequestFor, askStart, conversationOf, getAsk, listOf, makeQuickForm, newConversation, putAsk, quickFormAvailable, seedFor, startChannel, switchText, withLink, withoutLink } from "../contacttab/ask.ts";
import type { AskRequest } from "../contacttab/ask.ts";
import { createContactTabSample } from "../contacttab/sample.ts";
import type { ContactTabSample } from "../contacttab/sample.ts";
import { InboxDataProvider } from "../sidebar/index.ts";
import { channelFieldToAdd, findContact, ownContact } from "../../records/recordpage/askfor.ts";
import { CLIENT, PROJECT, createSamplePage } from "../../records/recordpage/sample.ts";
import type { RecordRow, TypeDef } from "../../records/recordpage/model.ts";

installComposerForTests(Composer);

const has = (s: string, needle: string): boolean => s.includes(needle);
const wrap = (s: ContactTabSample, child: ReactElement): string => renderToStaticMarkup(<InboxDataProvider value={s.data}>{child}</InboxDataProvider>).replaceAll("<!-- -->", "");

const TITLES = ["Phone", "Next step due", "Tax ID"];
const FIELDS = [{ field: "phone", title: "Phone" }, { field: "due", title: "Next step due" }, { field: "tax", title: "Tax ID" }];
const request = (o: Partial<AskRequest> = {}): AskRequest => ({
  id: "ask_1", contactId: "ct_elena", name: "Elena Rivera", first: "Elena", sender: "Irfad",
  email: { to: "elena@example.test" }, phone: { to: "+1 415 555 0161" }, titles: TITLES,
  form: { type: "clients", recordId: "cl_0", name: "Details for Elena Rivera", fields: FIELDS, available: true }, ...o,
});
const tab = (ask: AskRequest, id = "elena", contactId = "ct_elena"): { out: string; s: ContactTabSample } => {
  const s = createContactTabSample();
  return { s, out: wrap(s, <ContactTab conversationId={id} contactId={contactId} ask={ask} />) };
};

// ---------------------------------------------------------------- the drafts

test("the email draft names the missing fields, in a short neutral subject, signed by the sender", () => {
  const d = seedFor(request(), "email");
  assert.equal(d.subject, "A few details for your file");
  assert.equal(d.subject, ASK_SUBJECT);
  assert.equal(d.text, "Hi Elena,\n\nCould you send me your phone, next step due and tax id?\n\nThanks,\nIrfad");
  assert.equal(listOf(["Phone"]), "phone");
  assert.equal(listOf(["Phone", "Email"]), "phone and email");
});

test("the text draft is one short line with the same ask", () => {
  const d = seedFor(request(), "sms");
  assert.equal(d.text, "Hi Elena, could you send me your phone, next step due and tax id?");
  assert.ok(!d.text.includes("\n"));
});

test("an email is the first choice when there is an address, a text when there is only a phone", () => {
  assert.equal(startChannel(request()), "email");
  const { email: _e, ...phoneOnly } = request();
  assert.equal(startChannel(phoneOnly), "sms");
});

test("the quick form's link joins an untouched draft and leaves it again; an edited draft keeps its words", () => {
  const r = request(), url = "https://acme.example/f/details?t=abc";
  const plain = seedFor(r, "email").text;
  const linked = withLink(r, "email", plain, url);
  assert.ok(linked.includes(`The quickest way is this form: ${url}`) && linked.includes("Thanks,\nIrfad"));
  assert.equal(withoutLink(r, "email", linked, url), plain);
  assert.equal(withLink(r, "email", linked, url), linked, "the link is never added twice");
  const edited = "Elena, one thing: please send the missing items.";
  const editedLinked = withLink(r, "email", edited, url);
  assert.equal(editedLinked, `${edited}\n\n${url}`);
  assert.equal(withoutLink(r, "email", editedLinked, url), edited);
  assert.ok(withLink(r, "sms", seedFor(r, "sms").text, url).endsWith(`You can answer here: ${url}`));
});

test("switching Email and Text swaps an untouched draft and keeps what the person wrote", () => {
  const r = request(), url = "https://acme.example/f/details?t=abc";
  assert.equal(switchText(r, "email", "sms", seedFor(r, "email").text), seedFor(r, "sms").text);
  assert.equal(switchText(r, "email", "sms", seedFor(r, "email", url).text, url), seedFor(r, "sms", url).text);
  assert.equal(switchText(r, "email", "sms", "my own words"), "my own words");
});

test("no copy carries an em dash or a section sign", () => {
  const all = [seedFor(request(), "email").text, seedFor(request(), "sms").text, ASK_SUBJECT, QUICK_FORM_NOTE].join(" ");
  assert.ok(!all.includes(String.fromCharCode(0x2014)) && !all.includes(String.fromCharCode(0xa7)));
});

// ---------------------------------------------------------------- who can use a quick form

test("a quick form needs a Team Space with an address a phone can open, and publishing allowed", () => {
  const reach = (a: string): boolean => !a.includes("localhost");
  const ok = { spaceKind: "team" as const, baseUrl: "https://acme.vyre.run", reach, deferred: () => false };
  assert.equal(quickFormAvailable(ok), true);
  assert.equal(quickFormAvailable({ ...ok, spaceKind: "personal" }), false, "a Personal Space has no public address");
  assert.equal(quickFormAvailable({ ...ok, baseUrl: "http://localhost:4000" }), false, "a Space on this Mac only");
  assert.equal(quickFormAvailable({ spaceKind: "team", reach, deferred: () => false }), false, "no address at all");
  assert.equal(quickFormAvailable({ ...ok, deferred: (c) => c === "forms.publish" }), false, "publishing is not allowed here");
});

test("askRequestFor turns a Team Space into an available form and a Personal Space into none", () => {
  const input = { type: "clients", recordId: "cl_0", title: "Elena Rivera", missing: FIELDS, contact: { contactId: "cl_0", name: "Elena Rivera", email: "elena@example.test" } };
  const team = askRequestFor(input, { sender: "Irfad", spaceKind: "team", baseUrl: "https://acme.vyre.run", deferred: () => false });
  assert.equal(team.form.available, true);
  assert.deepEqual([team.first, team.sender, team.email, team.phone, team.titles], ["Elena", "Irfad", { to: "elena@example.test" }, undefined, TITLES]);
  assert.deepEqual([team.form.type, team.form.recordId, team.form.fields], ["clients", "cl_0", FIELDS]);
  const mac = askRequestFor(input, { sender: "Irfad", spaceKind: "personal", baseUrl: "http://127.0.0.1:7777", deferred: () => false });
  assert.equal(mac.form.available, false);
  putAsk(team);
  assert.equal(getAsk(team.id), team);
  assert.equal(getAsk("nope"), undefined);
});

// ---------------------------------------------------------------- the one-use form

test("the quick form is a one-use form on the record's type that asks the missing fields and links the record", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "forms.create") return { form: { formId: "frm_1" } };
    if (cap === "forms.publish") return { url: "https://acme.vyre.run/f/details", embed: "" };
    if (cap === "forms.link_create") return { url: "https://acme.vyre.run/f/details?t=abc" };
    return { ok: true };
  };
  const url = await makeQuickForm(call, request().form, "ask_1");
  assert.equal(url, "https://acme.vyre.run/f/details?t=abc");
  assert.deepEqual(calls.map((c) => c.cap), ["forms.create", "forms.fields_set", "forms.publish", "forms.link_create"]);
  assert.deepEqual([calls[0]!.input["kind"], calls[0]!.input["recordType"]], ["one_use", "clients"]);
  assert.deepEqual(calls[1]!.input["fields"], FIELDS.map((f) => ({ field: f.field, mode: "ask" })));
  assert.deepEqual([calls[3]!.input["formId"], calls[3]!.input["recordId"], calls[3]!.input["singleUse"]], ["frm_1", "cl_0", true]);
  assert.ok(calls.every((c) => c.cap !== "mail.send" && c.cap !== "telephony.send_sms"), "making the form sends nothing");
});

// ---------------------------------------------------------------- who a record can ask

const row = (fields: Record<string, unknown>, id = "cl_9"): RecordRow => ({ id, version: 1, fields } as unknown as RecordRow);

test("a record with an email asks that email; a phone-only record asks the phone", () => {
  const withEmail = ownContact(CLIENT, row({ name: "Elena Rivera", email: "elena@example.test", phone: "" }));
  assert.deepEqual(withEmail, { contactId: "cl_9", name: "Elena Rivera", email: "elena@example.test" });
  const phoneOnly = ownContact(CLIENT, row({ name: "Marcus Pruitt", phone: "+1 415 555 0188" }));
  assert.deepEqual(phoneOnly, { contactId: "cl_9", name: "Marcus Pruitt", phone: "+1 415 555 0188" });
  assert.equal(ownContact(CLIENT, row({ name: "Nobody" })), null);
});

test("a record with no email or phone asks the contact it links to", async () => {
  const company: TypeDef = { ...PROJECT, fields: [...PROJECT.fields, { key: "contact", type: "relation", title: "Contact", options: { to: "clients" } } as TypeDef["fields"][number]] };
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "records.get") return { record: row({ name: "Elena Rivera", email: "elena@example.test" }, "cl_0") };
    return { types: [CLIENT] };
  };
  const found = await findContact(call, company, row({ name: "Harbor", contact: ["cl_0"] }, "pj_1"));
  assert.deepEqual(found, { contactId: "cl_0", name: "Elena Rivera", email: "elena@example.test" });
  const none = await findContact(async () => { throw new Error("denied"); }, company, row({ name: "Harbor", contact: ["cl_0"] }, "pj_1"));
  assert.equal(none, null, "a linked record that cannot be read is nobody to ask");
});

test("with nobody to ask, the empty Email field is the one to fill, else Phone, else none", () => {
  assert.equal(channelFieldToAdd(CLIENT, row({ name: "A" }))?.key, "email");
  assert.equal(channelFieldToAdd(CLIENT, row({ name: "A", email: "a@example.test" }))?.key, "phone");
  assert.equal(channelFieldToAdd(CLIENT, row({ name: "A", email: "a@example.test", phone: "1" })), null);
  assert.equal(channelFieldToAdd(PROJECT, row({ name: "P" })), null);
});

test("on the sample page the click finds Elena's own email and the page records the ask for the Inbox", async () => {
  const s = createSamplePage();
  const r = (s.replica.rows("records:clients") as unknown as RecordRow[]).find((x) => x.id === "cl_0")!;
  const contact = await findContact(s.data.call, CLIENT, r);
  assert.ok(contact && contact.email === "elena@example.test" && contact.contactId === "cl_0");
  s.data.nav.askFor({ type: "clients", recordId: "cl_0", title: "Elena Rivera", missing: [{ field: "phone", title: "Phone" }], contact: contact! });
  assert.deepEqual(s.opened.filter((o) => o.startsWith("ask:")), ["ask:clients:cl_0:cl_0:phone"]);
  assert.ok(!s.opened.some((o) => o.startsWith("chat:")), "no assistant chat opens");
});

// ---------------------------------------------------------------- the composer

test("screen: an email ask opens the composer on Email with the person, subject and body drafted", () => {
  const start = askStart(request());
  assert.deepEqual([start.chan, start.to, start.subject], ["email", ["elena@example.test"], ASK_SUBJECT]);
  const { out, s } = tab(request());
  assert.ok(has(out, 'data-testid="contact-tab"') && has(out, "Elena Rivera") && has(out, 'data-testid="chan-email"'));
  assert.ok(has(out, "Could you send me your phone, next step due and tax id?") && has(out, "Thanks,"), "the body names the fields");
  assert.deepEqual(s.sent, [], "nothing is sent until the person presses Send");
});

test("screen: a phone-only ask opens on Text with the one-line draft", () => {
  const { email: _e, ...phoneOnly } = request();
  const start = askStart(phoneOnly);
  assert.deepEqual([start.chan, start.to, start.subject], ["sms", undefined, undefined]);
  const { out, s } = tab(phoneOnly);
  assert.ok(has(out, "Hi Elena, could you send me your phone, next step due and tax id?"));
  assert.ok(!has(out, "Thanks,"));
  assert.deepEqual(s.sent, []);
});

test("screen: in a Team Space the quick form toggle is shown, on, and says nothing about a Team Space", () => {
  const { out } = tab(request());
  assert.ok(has(out, 'data-testid="quick-form-toggle"') && has(out, "Add a quick form") && has(out, 'aria-checked="true"'));
  assert.ok(!has(out, 'data-testid="quick-form-note"') && !has(out, QUICK_FORM_NOTE));
});

test("screen: where no quick form can be made there is no toggle, only one quiet line", () => {
  const { out } = tab(request({ form: { ...request().form, available: false } }));
  assert.ok(!has(out, 'data-testid="quick-form-toggle"') && !has(out, "Add a quick form"), "never a dead toggle");
  assert.ok(has(out, 'data-testid="quick-form-note"') && has(out, "Quick forms need a Team Space"));
});

test("a contact with no conversation yet opens an empty one to write in; a failed read of someone else's is never invented", () => {
  const req = request({ contactId: "ct_nobody", name: "New Person", first: "New", email: { to: "new@example.test" } });
  const c = conversationOf({ status: "loading", error: { message: "There is no conversation with that person yet." } }, req, 1);
  assert.deepEqual([c?.id, c?.contactId, c?.address, c?.displayName, c?.lastChannel], ["", "ct_nobody", "new@example.test", "New Person", "email"]);
  assert.equal(conversationOf({ status: "loading" }, req, 1), null, "still loading draws the frame");
  assert.equal(conversationOf({ status: "loading", error: { message: "x" } }, undefined, 1), null, "without an ask nothing is invented");
  const s = createContactTabSample();
  const shown = wrap(s, <ContactTab conversationId="" contactId="ct_elena" ask={request()} />);
  assert.ok(has(shown, "Conversation with Elena Rivera"), "a contact found by id alone opens their conversation");
});

test("with no mailbox or number connected the send-from menu offers to connect one", () => {
  const entries = fromMenuEntries([], null, [], () => undefined, { label: "Connect a mailbox", run: () => undefined });
  assert.deepEqual(entries.map((e) => ("label" in e ? e.label : "head" in e ? e.head : "")), ["Send from", "Connect a mailbox"]);
  const plain = fromMenuEntries([], null, [], () => undefined);
  assert.equal(plain.length, 1, "without the connect choice an empty list is just its heading");
});
