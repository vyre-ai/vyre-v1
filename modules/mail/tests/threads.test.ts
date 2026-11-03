// One email thread is one object (owner, 3 Nov): replies from different senders and through different mailboxes join it by In-Reply-To and References; a
// provider thread that joined keeps its later messages there; mail.thread.get reads it whole with bodies cleaned, reactions on their messages and your role;
// a body stored empty is read again from the provider when the thread opens. The example is anonymised from a live case.
// @reads /modules/mail/fixtures/parse/outlook-original.txt /modules/mail/fixtures/parse/gmail-reply.txt /modules/mail/fixtures/parse/welcome-html.html
// @reads /modules/mail/fixtures/parse/gmail-latin1.json /modules/mail/migrations/0005_mail_copy.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ingest } from "../handlers/ingest.ts";
import type { IngestIn } from "../handlers/ingest.ts";
import { threadGet } from "../handlers/extra/messages.ts";
import { codeOf, contractErrors, harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { HarnessOptions } from "../fixtures/harness.ts";

const fx = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/parse/${name}`, import.meta.url)), "utf8");
const IRFAD = "irfad@northwind.test", JOSH = "josh@cohenshah.test", ANDREY = "andrey@scout.test", MAYA = "maya@northwind.test";
const ME = { kind: "person" as const, id: "usr_irfad01" };

function setup(o: HarnessOptions = {}) {
  const h = harness({ principal: ME, ...o });
  seedMailbox(h, "mbx_irfad", IRFAD, { kind: "personal", provider: "google", ownerId: ME.id });
  seedMailbox(h, "mbx_hello", "hello@northwind.test", { kind: "shared", provider: "inbound_only" });
  h.ctx.db.run(`UPDATE mail_mailbox SET "connectionId" = ? WHERE id = ?`, "con_g1", "mbx_irfad");
  return h;
}

const mail = (o: Omit<Partial<IngestIn>, "from" | "text"> & { from: string; rfc: string; providerId: string; at: number; text?: string | undefined }): IngestIn => {
  const { from, rfc, at, ...rest } = o;
  const { text, ...others } = rest;
  const out: IngestIn = { source: "google", mailboxId: "mbx_irfad", rfcMessageId: rfc, from: { address: from }, to: [], subject: "Welcome to Scout, Josh", receivedAt: NOW + at, ...others };
  if (!("text" in o)) out.text = "Hi";
  else if (text !== undefined) out.text = text;
  return out;
};

test("Andrey starts the thread, Josh replies through another mailbox, and later Gmail messages of the same provider thread all land in one thread", async () => {
  const h = setup();
  // Andrey's welcome reached the shared inbox; Josh's reply reaches Irfad's Gmail with a Gmail thread key of its own
  const a = await ingest(h.ctx, mail({ source: "resend", mailboxId: "mbx_hello", from: ANDREY, rfc: "<w1@scout.test>", providerId: "rs_w1", at: 0, to: [{ address: JOSH }], cc: [{ address: IRFAD }] }));
  const j = await ingest(h.ctx, mail({ from: JOSH, rfc: "<w2@cohenshah.test>", providerId: "gm_w2", at: 60_000, threadKey: "gthread9", to: [{ address: ANDREY }], cc: [{ address: IRFAD }], headers: { "In-Reply-To": "<w1@scout.test>", References: "<w1@scout.test>" } }));
  // a later message of the same Gmail thread whose parent never synced still joins, through this mailbox's copy of the thread
  const k = await ingest(h.ctx, mail({ from: JOSH, rfc: "<w3@cohenshah.test>", providerId: "gm_w3", at: 120_000, threadKey: "gthread9", to: [{ address: IRFAD }], headers: { "In-Reply-To": "<never-synced@cohenshah.test>" } }));
  const threads = h.rows(`SELECT id, "threadId" FROM mail_message`).map((r) => r.threadId);
  assert.equal(new Set(threads).size, 1, `one thread, not ${threads.join(", ")}`);
  const t = await threadGet(h.ctx, { threadId: String(threads[0]) });
  assert.deepEqual(t.messages.map((m) => m.id), [a.messageId, j.messageId, k.messageId]);
  assert.deepEqual(t.messages.map((m) => m.from.address), [ANDREY, JOSH, JOSH]);
  assert.equal(t.role, "cc");
  assert.equal(t.subject, "Welcome to Scout, Josh");
  assert.deepEqual(t.participants.map((p) => p.address).sort(), [ANDREY, IRFAD, JOSH].sort());
  assert.deepEqual(contractErrors("mail.thread.get", "out", t), []);
  assert.deepEqual(h.rows(`SELECT "mailboxId", "threadKey" FROM mail_copy WHERE "messageId" = ?`, j.messageId), [{ mailboxId: "mbx_irfad", threadKey: "gthread9" }]);
});

test("the open thread has every word: bodies are never cut, quoted history and signatures are apart, and HTML is sanitised with images held", async () => {
  const h = setup();
  const long = `${"Right now nobody writes after the consult, so the lead goes quiet and we lose about a third of them. ".repeat(12)}A short email the next morning, then we will call on day three.`;
  await ingest(h.ctx, mail({ from: ANDREY, rfc: "<w1@scout.test>", providerId: "gm_1", at: 0, threadKey: "t1", html: fx("welcome-html.html"), text: undefined, to: [{ address: JOSH }], cc: [{ address: IRFAD }] }));
  await ingest(h.ctx, mail({ from: JOSH, rfc: "<w2@cohenshah.test>", providerId: "gm_2", at: 1000, threadKey: "t1", text: fx("outlook-original.txt"), to: [{ address: ANDREY }], cc: [{ address: IRFAD }], headers: { "in-reply-to": "<w1@scout.test>" } }));
  await ingest(h.ctx, mail({ from: JOSH, rfc: "<w3@cohenshah.test>", providerId: "gm_3", at: 2000, threadKey: "t1", text: `Hi Irfad,\n\n${long}\n\nJosh`, to: [{ address: IRFAD }], headers: { "in-reply-to": "<w2@cohenshah.test>" } }));
  const thread = String(h.rows(`SELECT "threadId" FROM mail_message`)[0]!.threadId);
  const t = await threadGet(h.ctx, { threadId: thread });
  const [welcome, reply, last] = t.messages;
  assert.ok(welcome && reply && last);
  assert.ok(!welcome.html?.includes("<script") && !welcome.html?.includes("cdn.scout.example") && !welcome.html?.includes("o.gif"));
  assert.equal(welcome.imagesHeld, 1);
  assert.match(welcome.body, /Welcome to Scout\. Your workspace for Cohen & Shah Law is ready\./);
  assert.equal(reply.body, "Thanks Andrey. I am in and the team is set up.\n\nIrfad, can you connect it to Clio Grow when we meet Wednesday?");
  assert.match(reply.quoted ?? "", /^-----Original Message-----/);
  assert.match(reply.signature ?? "", /CONFIDENTIALITY NOTICE/);
  assert.ok(last.body.includes(long), "the open message holds every word");
  assert.ok(last.body.endsWith("then we will call on day three.\n\nJosh"));
  const stored = h.rows(`SELECT snippet FROM mail_message WHERE "providerId" = ?`, "gm_3")[0]!.snippet as string;
  assert.ok(stored.length <= 160 && stored.endsWith("…"), stored);
  assert.ok(long.startsWith(stored.slice(0, -1)), "the preview is the start of what Josh wrote, past the greeting, cut at a word");
  const shown = await threadGet(h.ctx, { threadId: thread, images: true });
  assert.match(shown.messages[0]?.html ?? "", /cdn\.scout\.example\/mail\/logo\.png/);
});

test("a Gmail reaction is not a message: it sits on the message it answers, from whoever reacted", async () => {
  const h = setup();
  await ingest(h.ctx, mail({ from: JOSH, rfc: "<c3@cohenshah.test>", providerId: "gm_c3", at: 0, threadKey: "t2", subject: "Claude in Chrome for Clio Grow", text: "Thanks, I will put in the card for the Clio seat today.", to: [{ address: IRFAD }] }));
  await ingest(h.ctx, mail({ from: IRFAD, direction: "out", rfc: "<r1@northwind.test>", providerId: "gm_r1", at: 60_000, threadKey: "t2", subject: "Re: Claude in Chrome for Clio Grow", text: "❤️ Irfad Imtiaz reacted via Gmail <https://www.google.com/gmail/about/>", headers: { "in-reply-to": "<c3@cohenshah.test>", "x-vyre-reaction": "❤️" }, to: [{ address: JOSH }] }));
  await ingest(h.ctx, mail({ from: JOSH, rfc: "<c4@cohenshah.test>", providerId: "gm_c4", at: 120_000, threadKey: "t2", subject: "RE: Claude in Chrome for Clio Grow", text: "One more: can we do 11:00?", to: [{ address: IRFAD }], headers: { "in-reply-to": "<c3@cohenshah.test>" } }));
  const thread = String(h.rows(`SELECT "threadId" FROM mail_message`)[0]!.threadId);
  const t = await threadGet(h.ctx, { threadId: thread });
  assert.equal(t.messages.length, 2, "the reaction is not listed as a message");
  assert.deepEqual(t.messages[0]?.reactions, [{ emoji: "❤️", from: { address: IRFAD }, at: NOW + 60_000 }]);
  assert.deepEqual(t.messages[1]?.reactions, []);
  assert.equal(t.role, "to");
});

test("your role: you started it, or you were added later (the first message you have answers one you never got)", async () => {
  const h = setup();
  await ingest(h.ctx, mail({ from: MAYA, rfc: "<c1@northwind.test>", providerId: "gm_m1", at: 0, threadKey: "t3", subject: "Re: Claude in Chrome for Clio Grow", text: fx("gmail-reply.txt"), to: [{ address: JOSH }], cc: [{ address: IRFAD }], headers: { "in-reply-to": "<j0@cohenshah.test>", references: "<j0@cohenshah.test>" } }));
  const added = await threadGet(h.ctx, { threadId: String(h.rows(`SELECT "threadId" FROM mail_message`)[0]!.threadId) });
  assert.equal(added.role, "added_later");
  assert.equal(added.messages[0]?.signature, "Maya Chen\nClient Success | Northwind\n+1 415 555 0140");
  assert.match(added.messages[0]?.quoted ?? "", /^On Tue, Oct 20, 2026/);
  await ingest(h.ctx, mail({ from: IRFAD, direction: "out", rfc: "<s1@northwind.test>", providerId: "gm_s1", at: 10, threadKey: "t4", subject: "Renewal", text: "Hi Dana, the renewal quote is attached.", to: [{ address: "dana@whitfield.test" }] }));
  const started = await threadGet(h.ctx, { threadId: String(h.rows(`SELECT "threadId" FROM mail_message WHERE "providerId" = ?`, "gm_s1")[0]!.threadId) });
  assert.equal(started.role, "started");
});

test("a thread you may not read is not found; a bad id is refused", async () => {
  const h = setup({ denied: new Set(["mbx_irfad"]) });
  await ingest(h.ctx, mail({ from: JOSH, rfc: "<x1@cohenshah.test>", providerId: "gm_x1", at: 0, threadKey: "t5", to: [{ address: IRFAD }] }));
  await assert.rejects(threadGet(h.ctx, { threadId: "t5" }), (e) => codeOf(e) === "permission.not_found");
  await assert.rejects(threadGet(h.ctx, { threadId: "nope" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(threadGet(h.ctx, { threadId: "" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a body stored empty is read again from Gmail when the thread opens, in its own charset, and kept", async () => {
  const gm = JSON.parse(fx("gmail-latin1.json")) as Record<string, unknown>;
  const asked: Record<string, unknown>[] = [];
  const h = setup({ answers: { "google.gmail.get_message": (input) => { asked.push(input); return { message: gm }; } } });
  const got = await ingest(h.ctx, mail({ from: "jose@ortega.test", rfc: "<l1@ortega.test>", providerId: "gm_l1", at: 0, threadKey: "t6", subject: "Reunión del miércoles", text: undefined, to: [{ address: IRFAD }] }));
  const t = await threadGet(h.ctx, { threadId: "t6" });
  assert.deepEqual(asked, [{ connectionId: "con_g1", as: IRFAD, messageId: "gm_l1", format: "full" }]);
  assert.equal(t.messages[0]?.body, "Hola Irfad,\n\nGracias por la llamada. La reunión es el miércoles a las 11:00. El café está pagado.\n\nJosé");
  assert.match(String(h.rows(`SELECT text FROM mail_body WHERE "messageId" = ?`, got.messageId)[0]!.text), /reunión es el miércoles/);
  await threadGet(h.ctx, { threadId: "t6" });
  assert.equal(asked.length, 1, "read again once, then kept");
});
