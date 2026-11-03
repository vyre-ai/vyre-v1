// Gmail bodies reach mail whole (owner, 3 Nov: emails arrived cut off): a long body Gmail holds as an attachment part is fetched, each part is read in its own
// charset, and a Gmail emoji reaction is marked for the reader. Replayed from anonymised recordings; no socket is opened.
// @reads /modules/mail/fixtures/parse/gmail-long-multipart.json /modules/mail/fixtures/parse/gmail-long-bodypart.json
// @reads /modules/mail/fixtures/parse/gmail-latin1.json /modules/mail/fixtures/parse/gmail-reaction.json /modules/google/fixtures/gmail/profile.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pullMailbox, sendMessage } from "../handlers/gmail.ts";
import { act, CONN, fixture, harness, seedDelegation } from "../fixtures/harness.ts";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAYA = "maya@vyre.test";
const parse = (name: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(`../../mail/fixtures/parse/${name}`, import.meta.url)), "utf8")) as Record<string, unknown>;

function ready(ids: string[]) {
  const h = harness();
  seedDelegation(h);
  h.on("GET", `${BASE}/profile`, { body: fixture("gmail/profile.json") });
  h.ctx.db.run(
    `INSERT INTO google_mailbox (email, "connectionId", "historyId", "lastPolledAt", "lastActivityAt", "watchExpiresAt", "pubsubTopic", "nextPollAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    MAYA, CONN, "2000", null, null, null, null, null,
  );
  h.on("GET", /\/history\?/, { body: { history: [{ id: "2001", messagesAdded: ids.map((id) => ({ message: { id, threadId: "t" } })) }], historyId: "2001" } });
  return h;
}

test("a long body Gmail holds as an attachment part is fetched, so the whole message lands; the real attachment is still an attachment", async () => {
  const long = parse("gmail-long-multipart.json");
  const h = ready(["18c3f00000000m1"]);
  h.on("GET", `${BASE}/messages/18c3f00000000m1?`, { body: long });
  h.on("GET", `${BASE}/messages/18c3f00000000m1/attachments/ANGjdJ_bodypart_1`, { body: parse("gmail-long-bodypart.json") });
  h.on("GET", `${BASE}/messages/18c3f00000000m1/attachments/ANGjdJ_pdf_1`, { body: { size: 4, data: Buffer.from("%PDF").toString("base64url") } });
  await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  const m = h.ingests[0]!;
  const text = String(m.text);
  assert.ok(text.length > 3000, `the body is whole: ${text.length} characters`);
  assert.match(text, /^Hi Irfad,\n\nQuick one before Wednesday\./);
  assert.match(text, /we will call on day three\./);
  assert.match(text, /CONFIDENTIALITY NOTICE/);
  assert.equal(m.html, "<p>See the text part.</p>");
  assert.deepEqual((m.attachments as { name: string }[]).map((a) => a.name), ["intake-form.pdf"]);
  assert.equal(m.threadKey, "18c2a1f04e9b");
  assert.deepEqual(m.headers, { "in-reply-to": "<c3.josh@cohenshah.example>", references: "<j0.josh@cohenshah.example> <c3.josh@cohenshah.example>" });
});

test("each part is read in its own charset: ISO-8859-1 text and windows-1252 HTML", async () => {
  const h = ready(["18c3f00000000l1"]);
  h.on("GET", `${BASE}/messages/18c3f00000000l1?`, { body: parse("gmail-latin1.json") });
  await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  const m = h.ingests[0]!;
  assert.equal(m.text, "Hola Irfad,\n\nGracias por la llamada. La reunión es el miércoles a las 11:00. El café está pagado.\n\nJosé\n");
  assert.equal(m.html, "<p>Gracias por la llamada. La reunión es el miércoles – a las 11:00.</p>");
  assert.deepEqual(m.from, { address: "jose@ortega.example", name: "José Ortega" });
});

test("a Gmail reaction is marked with its emoji for the reader", async () => {
  const h = ready(["18c3f00000000r1"]);
  h.on("GET", `${BASE}/messages/18c3f00000000r1?`, { body: parse("gmail-reaction.json") });
  await pullMailbox(h.ctx, { connectionId: CONN, mailbox: MAYA });
  const m = h.ingests[0]!;
  assert.equal((m.headers as Record<string, string>)["x-vyre-reaction"], "❤️");
  assert.equal((m.headers as Record<string, string>)["in-reply-to"], "<c3.josh@cohenshah.example>");
  assert.equal(m.direction, "out");
});

test("a reply carries In-Reply-To and References in the message and the thread id beside it; junk ids are dropped", async () => {
  const h = ready([]);
  h.on("POST", `${BASE}/messages/send`, { body: { id: "m10", threadId: "18c2a1f04e9b", labelIds: ["SENT"] } });
  await sendMessage(h.ctx, { ...act, to: ["josh@cohenshah.example"], subject: "Re: Clio Grow", text: "11:00 works.", threadId: "18c2a1f04e9b", inReplyTo: "<c4@cohenshah.example>", references: "<j0@cohenshah.example> bad\r\nBcc: x@y.test <c4@cohenshah.example>" });
  const req = h.hits(`${BASE}/messages/send`)[0]!.body as { raw: string; threadId: string };
  assert.equal(req.threadId, "18c2a1f04e9b");
  const mime = Buffer.from(req.raw, "base64url").toString("utf8");
  assert.match(mime, /\r\nIn-Reply-To: <c4@cohenshah\.example>\r\n/);
  assert.match(mime, /\r\nReferences: <j0@cohenshah\.example> <c4@cohenshah\.example>\r\n/);
  assert.ok(!/^Bcc:/m.test(mime));
});
