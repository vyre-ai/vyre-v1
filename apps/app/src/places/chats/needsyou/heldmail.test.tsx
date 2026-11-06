// A held send in Needs you: the draft is found in the task, read as the person will, with its record beside it; the buttons say Allow and Deny (one approval vocabulary); a task that is not a held send is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HeldMailCard } from "./HeldMail.tsx";
import { heldMail, labelOf, peekOf, plainOf } from "./heldmail.ts";

const held = (input: Record<string, unknown>) => ({ kind: "approve", blocks: [{ type: "doc_excerpt", v: 1, data: { act: "send", cap: "mail.send", input } }] }) as never;

test("the draft is read from the held mail.send: recipients, subject, text or the words of the html, the record it is about", () => {
  const m = heldMail(held({ to: [{ address: "dana@fox.test", name: "Dana Fox", contactId: "rec_dana" }], cc: [{ address: "me@x.test" }], subject: "Your engagement", text: "Dear Dana,\nWelcome.", attachments: ["fil_1", "fil_2"] }))!;
  assert.deepEqual(m, { to: ["Dana Fox <dana@fox.test>"], cc: ["me@x.test"], subject: "Your engagement", body: "Dear Dana,\nWelcome.", attachments: 2, recordId: "rec_dana" });
  assert.equal(heldMail(held({ to: [{ address: "a@b.test" }], subject: "s", html: "<p>Hi &amp; hello</p><p>Bye</p>", contactId: "rec_x" }))!.body, "Hi & hello\nBye");
  assert.equal(plainOf("<div>a</div>b"), "a\nb");
  assert.equal(heldMail({ kind: "approve", blocks: [{ type: "doc_excerpt", v: 1, data: { act: "send", cap: "sms.send", input: {} } }] } as never), null, "another cap is not a held mail");
  assert.equal(heldMail({ kind: "review", blocks: [] } as never), null);
});

test("the buttons of a held send say Allow and Deny, and every other task keeps its own words", () => {
  const m = heldMail(held({ to: [{ address: "a@b.test" }], subject: "s", text: "t" }));
  assert.equal(labelOf(m, { key: "approve", label: "Approve" }), "Allow");
  assert.equal(labelOf(m, { key: "send_back", label: "Send back" }), "Deny");
  assert.equal(labelOf(m, { key: "reject", label: "Send back" }), "Deny");
  assert.equal(labelOf(null, { key: "approve", label: "Approve" }), "Approve");
});

test("the record's peek is its name and up to four filled fields", () => {
  const p = peekOf({ type: "contact", fields: { name: "Dana Fox", email: "dana@fox.test", phone: "+1 415 555 0100", empty: "", budget: { amount: 5000, currency: "USD" }, status: "active", notes: "x", folder: "fld_1" } });
  assert.deepEqual(p, { title: "Dana Fox", type: "Contact", lines: [["Email", "dana@fox.test"], ["Phone", "+1 415 555 0100"], ["Budget", "5000 USD"], ["Status", "active"]] });
});

test("the card shows the draft and, once read, the record beside it, as a link", async () => {
  const restore = installDom();
  const opened: string[] = [];
  const mail = heldMail(held({ to: [{ address: "dana@fox.test", name: "Dana Fox", contactId: "rec_dana" }], subject: "Your engagement", text: "Dear Dana" }))!;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as { type: string };
    if (cap === "records.get" && i.type === "contact") throw new Error("not a contact");
    return { record: { type: "company", fields: { name: "Fox & Co", email: "hi@fox.test" } } };
  };
  const root = createRoot();
  await act(async () => { root.render(<HeldMailCard mail={mail} call={call} onOpenRecord={(id) => void opened.push(id)} />); });
  await flush();
  try {
    const node = root.container as never;
    assert.equal(textOf(find(node, "held-to")), "Dana Fox <dana@fox.test>");
    assert.equal(textOf(find(node, "held-subject")), "Your engagement");
    assert.equal(textOf(find(node, "held-body")), "Dear Dana");
    assert.match(textOf(find(node, "held-record")), /Fox & Co.*Company.*Email.*hi@fox\.test/s);
  } finally { await act(async () => { root.unmount(); }); restore(); }
});

import { blockView } from "./model.ts";
test("a held send that is not email shows who it goes to and the words, never the block's type name", () => {
  const v = blockView({ type: "doc_excerpt", v: 1, data: { act: "send", cap: "chat.message_person", input: { to: { name: "Aliza Cohen", handle: "aliza" }, subject: "Agency token", body: "Hi Aliza, can you send it?" } } } as never);
  assert.equal(v.type, "quote");
  const lines = v.type === "quote" ? v.lines : [];
  assert.ok(lines.includes("To: Aliza Cohen"));
  assert.ok(lines.includes("Subject: Agency token"));
  assert.ok(lines.includes("Hi Aliza, can you send it?"));
  const bare = blockView({ type: "doc_excerpt", v: 1, data: { act: "send", cap: "x.y", input: { channel: "general" } } } as never);
  assert.deepEqual(bare, { type: "pairs", pairs: [["To", "general"]] });
});
