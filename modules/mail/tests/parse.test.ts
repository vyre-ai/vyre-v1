// Mail bodies made readable (lib/mail-parse.ts): quotes in Gmail, Outlook and Apple formats, signatures, Gmail reactions, safe HTML, charsets and previews.
// @reads /modules/mail/fixtures/parse/gmail-reply.txt /modules/mail/fixtures/parse/outlook-reply.txt /modules/mail/fixtures/parse/outlook-original.txt
// @reads /modules/mail/fixtures/parse/apple-reply.txt /modules/mail/fixtures/parse/dash-signature.txt /modules/mail/fixtures/parse/gmail-html.html
// @reads /modules/mail/fixtures/parse/outlook-html.html /modules/mail/fixtures/parse/welcome-html.html /modules/mail/fixtures/parse/gmail-reaction.json
// @reads /modules/mail/fixtures/parse/qp-latin1.txt
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanMessage, cleanText, decodePart, htmlToText, previewOf, previewOfMessage, reactionEmoji, reactionOf, sanitizeHtml } from "../../../lib/mail-parse.ts";

const fx = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/parse/${name}`, import.meta.url)), "utf8");

test("Gmail: the 'On … wrote:' history folds away, even when Gmail wraps it over two lines", () => {
  const c = cleanText(fx("gmail-reply.txt"), "Maya Chen");
  assert.equal(c.body, "Hi Josh,\n\nAdding Irfad, who set up Claude in Chrome for our own Clio Grow intake. Irfad, Josh wants the same setup for his intake team, and a follow-up after each consult.");
  assert.match(c.quoted, /^On Tue, Oct 20, 2026 at 4:12 PM Josh Cohen/);
  assert.match(c.quoted, /re-types every web lead by hand/);
  assert.equal(c.signature, "Maya Chen\nClient Success | Northwind\n+1 415 555 0140");
});

test("Outlook: the From/Sent header block starts the history; the name block and the confidentiality notice are the signature", () => {
  const c = cleanText(fx("outlook-reply.txt"), "Josh Cohen");
  assert.match(c.body, /^Hi Irfad,\n\nQuick one before Wednesday\./);
  assert.match(c.body, /we will call on day three\. Could the same setup draft that email for Rachel to send\?$/);
  assert.match(c.signature, /^Josh Cohen\nManaging Partner/);
  assert.match(c.signature, /CONFIDENTIALITY NOTICE/);
  assert.match(c.quoted, /^From: Irfad Imtiaz/);
  assert.ok(!c.body.includes("From:"));
});

test("Outlook: '-----Original Message-----' starts the history", () => {
  const c = cleanText(fx("outlook-original.txt"), "Josh Cohen");
  assert.equal(c.body, "Thanks Andrey. I am in and the team is set up.\n\nIrfad, can you connect it to Clio Grow when we meet Wednesday?");
  assert.match(c.quoted, /^-----Original Message-----\nFrom: Andrey Volkov/);
});

test("Apple Mail: 'Sent from my iPhone' is the signature and the '> On …, at …, wrote:' block is the history; a one-word sign-off stays", () => {
  const c = cleanText(fx("apple-reply.txt"), "Josh Cohen");
  assert.equal(c.body, "One more: Rachel is out Wednesday afternoon. Can we do 11:00 instead?\n\nJosh");
  assert.equal(c.signature, "Sent from my iPhone");
  assert.match(c.quoted, /^> On Oct 24, 2026, at 9:04 AM, Josh Cohen/);
});

test("the '-- ' delimiter starts a signature", () => {
  const c = cleanText(fx("dash-signature.txt"), "Omar Haddad");
  assert.equal(c.body, "Invoice 1041 is attached again. It is also in the portal under Billing.\n\nThanks,\nOmar");
  assert.equal(c.signature, "--\nOmar Haddad | Billing, Northwind\nnorthwind.example");
});

test("a message with nothing new keeps its text, so nothing disappears", () => {
  assert.equal(cleanText("> just a quote\n> nothing else").body, "> just a quote\n> nothing else");
  assert.equal(cleanText("").body, "");
});

test("a forwarded message is the content and is not folded", () => {
  const c = cleanText("FYI, see below.\n\n---------- Forwarded message ---------\nFrom: Dana <dana@whitfield.example>\nDate: Mon, Oct 26, 2026\nSubject: Renewal\n\nThe renewal quote is attached.");
  assert.match(c.body, /The renewal quote is attached\.$/);
  assert.equal(c.quoted, "");
});

test("Gmail HTML: gmail_signature and gmail_quote come out of the body", () => {
  const h = sanitizeHtml(fx("gmail-html.html"));
  assert.match(h.text, /^Hi Josh,\n+Tuesday at 10:00 works\. I sent the invite\.\n+--$/);
  assert.equal(h.signature, "Irfad Imtiaz\nNorthwind | +1 415 555 0132");
  assert.match(h.quoted, /On Mon, Oct 26, 2026 at 9:02 AM Josh Cohen <josh@cohenshah.example> wrote:/);
  assert.match(h.quoted, /Can we meet Tuesday morning\?/);
  const m = cleanMessage({ html: fx("gmail-html.html") }, "Irfad Imtiaz");
  assert.equal(m.body, "Hi Josh,\n\nTuesday at 10:00 works. I sent the invite.");
});

test("Outlook HTML: the Signature block and everything from divRplyFwdMsg on are folded", () => {
  const h = sanitizeHtml(fx("outlook-html.html"));
  assert.equal(h.text, "Thanks, I will put in the card for the Clio seat today. Wednesday at 2 works for us.");
  assert.match(h.signature, /^Josh Cohen\nManaging Partner \| Cohen & Shah Law$/);
  assert.match(h.quoted, /From: Irfad Imtiaz <irfad@northwind\.example>/);
  assert.match(h.quoted, /Happy to\. The short version/);
  assert.ok(!h.html.includes("style"));
});

test("HTML is sanitised: no scripts, styles, frames, forms or handlers; links are safe and show their host; remote images wait; pixels go", () => {
  const h = sanitizeHtml(fx("welcome-html.html"));
  for (const bad of ["<script", "track()", "<style", "color:red", "<iframe", "<form", "<input", "onclick", "steal", "javascript", "<svg", "svgtext", "onload", "style="]) assert.ok(!h.html.toLowerCase().includes(bad.toLowerCase()), `kept ${bad}: ${h.html}`);
  assert.match(h.html, /<a href="https:\/\/app\.scout\.example\/w\/cohen-shah\?utm_source=welcome" target="_blank" rel="noopener noreferrer nofollow">Open your workspace<\/a> <span class="vy-link-host">\(app\.scout\.example\)<\/span>/);
  assert.match(h.html, /<a>this<\/a>/, "a javascript: link loses its href");
  assert.match(h.html, /app\.scout\.example\/help<\/a><\/p>/, "a link whose text already shows the host gets no second host");
  assert.equal(h.imagesHeld, 1);
  assert.equal(h.pixels, 1);
  assert.ok(!h.html.includes("cdn.scout.example"));
  assert.match(h.html, /<b>Cohen &amp; Shah Law<\/b>/);
  const shown = sanitizeHtml(fx("welcome-html.html"), { images: true });
  assert.match(shown.html, /<img src="https:\/\/cdn\.scout\.example\/mail\/logo\.png" alt="Scout">/);
  assert.ok(!shown.html.includes("o.gif"), "a tracking pixel never loads");
  assert.ok(!shown.html.includes("javascript:"));
});

test("HTML output is balanced even when the mail is not", () => {
  const h = sanitizeHtml("<div><p>One <b>two <i>three</p></div></b><table><tr><td>cell");
  const opens = (h.html.match(/<(?!\/)[a-z0-9]+/g) ?? []).length;
  const closes = (h.html.match(/<\/[a-z0-9]+>/g) ?? []).length;
  assert.equal(opens, closes);
  assert.equal(sanitizeHtml("a < b and c > d").html, "a &lt; b and c &gt; d");
});

test("HTML to text keeps every word, with line breaks for blocks", () => {
  assert.equal(htmlToText("<p>Hi&nbsp;Josh,</p><p>Line one<br>Line two</p><ul><li>a</li><li>b</li></ul>"), "Hi Josh,\n\nLine one\nLine two\n\n- a\n- b");
  assert.equal(htmlToText("<style>x{}</style><script>bad()</script>Caf&eacute; &#233; &#xE9;"), "Caf&eacute; é é");
});

test("Gmail reaction: known by its JSON part (as the x-vyre-reaction header) or by its text", () => {
  const msg = JSON.parse(fx("gmail-reaction.json")) as { payload: { parts: { mimeType: string; body: { data: string } }[] } };
  const part = msg.payload.parts.find((p) => p.mimeType === "text/vnd.google.email-reaction+json");
  assert.ok(part);
  assert.equal(reactionEmoji(Buffer.from(part.body.data, "base64url").toString("utf8")), "❤️");
  const text = Buffer.from(msg.payload.parts[0]?.body.data ?? "", "base64url").toString("utf8");
  assert.deepEqual(reactionOf({ text }), { emoji: "❤️", name: "Irfad Imtiaz" });
  assert.deepEqual(reactionOf({ text: "", headers: { "x-vyre-reaction": "👍" } }), { emoji: "👍" });
  assert.equal(reactionOf({ text: "Thanks, I reacted to the news via phone." }), null);
  assert.equal(reactionEmoji("not json"), null);
});

test("previews end at a word with an ellipsis and never break a word", () => {
  const long = "Right now nobody writes after the consult, so the lead goes quiet and we lose about a third of them. A short email the next morning, then we will call on day three.";
  const p = previewOf(long, 80);
  assert.ok(p.length <= 80, p);
  assert.ok(p.endsWith("…"));
  assert.ok(long.startsWith(p.slice(0, -1)), "the preview is the start of the text");
  assert.ok(/\s/.test(long[p.length - 1] ?? " ") || /[,.]/.test(long[p.length - 2] ?? ""), `cut mid-word: ${p}`);
  assert.equal(previewOf("Short.", 80), "Short.");
  assert.equal(previewOf(`${"x".repeat(300)}`, 50).length, 50, "one long word is cut at the limit, with the ellipsis");
  assert.equal(previewOfMessage({ text: fx("outlook-reply.txt") }, "Josh Cohen", 60), "Quick one before Wednesday. Our lead form also feeds a…");
  assert.equal(previewOfMessage({ html: "<p>Hello Josh,</p><p>Tuesday works.</p>" }), "Tuesday works.");
});

test("parts decode by charset and transfer encoding", () => {
  assert.equal(decodePart(fx("qp-latin1.txt"), { encoding: "quoted-printable", charset: "iso-8859-1" }), "Café con leña, a las 11:00 en la reunión de mañana.\n");
  assert.equal(decodePart(Buffer.from("Reunión – miércoles", "utf8").toString("base64"), { encoding: "base64", charset: "utf-8" }), "Reunión – miércoles");
  assert.equal(decodePart(Buffer.from([0x52, 0x65, 0x75, 0x6e, 0x69, 0xf3, 0x6e, 0x20, 0x96]).toString("base64url"), { base64url: true, charset: "windows-1252" }), "Reunión –");
  assert.equal(decodePart(Buffer.from("plain", "utf8").toString("base64url"), { base64url: true, charset: "x-unknown-charset" }), "plain");
});
