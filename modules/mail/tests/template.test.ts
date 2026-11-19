// mail.template.* (lane r42-email-in): built-ins, the Space's version, a document's own version, preview on a real record, blanks and fallbacks.
// Addresses and names are invented; nothing is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { forDocumentClear, forDocumentGet, forDocumentSet, get, list, preview, reset, resolve, save } from "../handlers/extra/template.ts";
import { fillTokens, tokensIn } from "../../../lib/merge-tokens.ts";
import { script } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const DOC = "fil_doc0001";
const REC = "rec_signer01";

function setup(fields: Record<string, unknown> = { signer_name: "Sam Rivers", company: "Acme" }): Harness {
  const h = harness();
  script(h, {
    "schema.types.list": () => ({ types: [{ key: "contact" }] }),
    "records.get": (i) => {
      if (i.recordId !== REC) throw Object.assign(new Error("none"), { code: "validation.not_found" });
      return { record: { id: REC, fields } };
    },
  });
  return h;
}

test("merge tokens: a value, a fallback, an empty fallback that leaves it out, and a blank that is named", () => {
  const f = fillTokens("Hi {{name|there}}, {{greeting|}}re: {{doc}} <{{who}}>", { doc: "A & B" });
  assert.equal(f.text, "Hi there, re: A & B <who>");
  assert.deepEqual([f.blanks, f.fallbacks], [["who"], ["name", "greeting"]]);
  assert.equal(fillTokens("<b>{{doc}}</b>", { doc: "A & <B>" }, { html: true }).text, "<b>A &amp; &lt;B&gt;</b>");
  assert.deepEqual(tokensIn("{{A_b|x}} {{a_b}} {{c}}"), [{ key: "a_b", fallback: "x" }, { key: "c" }]);
});

test("the four signature templates ship, and list says none is changed yet", async () => {
  const h = setup();
  const out = await list(h.ctx);
  assert.deepEqual(contractErrors("mail.template.list", "out", out), []);
  assert.deepEqual(out.templates.map((t) => t.key), ["signature.request", "signature.reminder", "signature.signed_copy", "signature.expired"]);
  assert.ok(out.templates.every((t) => t.source === "builtin" && !t.customised));
  const one = await get(h.ctx, { key: "signature.request" });
  assert.deepEqual(contractErrors("mail.template.get", "out", one), []);
  assert.deepEqual(one.template.fields.map((f) => f.key), ["sender_name", "document_title", "signer_name", "message", "sign_link", "expires_on"]);
});

test("a preview fills a signature request from the values esign passes and says what would be blank", async () => {
  const h = setup();
  const out = await preview(h.ctx, {
    key: "signature.request",
    vars: { signer_name: "Sam Rivers", document_title: "Service agreement", sender_name: "Pat Lee", sign_link: "https://sign.vyre.test/a?x=1&y=2", expires_on: "30 Nov" },
  });
  assert.deepEqual(contractErrors("mail.template.preview", "out", out), []);
  assert.equal(out.subject, "Pat Lee asked you to sign Service agreement");
  assert.match(out.text, /^Hi Sam Rivers,\n\nPat Lee asked you to sign Service agreement\.\n\n\n\nOpen it here:\nhttps:\/\/sign\.vyre\.test\/a\?x=1&y=2\n\nThe link works until 30 Nov\.$/);
  assert.deepEqual(out.blanks, []);
  const missingLink = await preview(h.ctx, { key: "signature.request", vars: { document_title: "Plan", sender_name: "Pat" } });
  assert.deepEqual(missingLink.blanks, ["sign_link"]);
  assert.deepEqual(missingLink.fallbacks.sort(), ["expires_on", "message", "signer_name"]);
});

test("a preview on a real record reads it as the caller, and vars win over the record", async () => {
  const h = setup();
  const out = await preview(h.ctx, { subject: "For {{company}}", text: "Hi {{signer_name}} at {{company}}", recordId: REC, vars: { company: "Globex" } });
  assert.equal(out.source, "draft");
  assert.equal(out.subject, "For Globex");
  assert.equal(out.text, "Hi Sam Rivers at Globex");
  await assert.rejects(preview(h.ctx, { subject: "x", text: "y", recordId: "rec_nobody" }), (e) => codeOf(e) === "validation.not_found");
});

test("the Space version replaces the built-in until it is reset; saving the same text twice changes nothing", async () => {
  const h = setup();
  const saved = await save(h.ctx, { key: "signature.request", subject: "Please sign {{document_title}}", text: "Hello {{signer_name|there}}\n{{sign_link}}" });
  assert.deepEqual(contractErrors("mail.template.save", "out", saved), []);
  assert.equal(saved.template.source, "space");
  assert.equal(saved.template.version, 1);
  const again = await save(h.ctx, { key: "signature.request", subject: "Please sign {{document_title}}", text: "Hello {{signer_name|there}}\n{{sign_link}}" });
  assert.equal(again.template.version, 1);
  const edited = await save(h.ctx, { key: "signature.request", subject: "Please sign {{document_title}} today", text: "Hello {{signer_name|there}}\n{{sign_link}}" });
  assert.equal(edited.template.version, 2);
  assert.equal((await list(h.ctx)).templates[0]!.customised, true);
  assert.deepEqual(await reset(h.ctx, { key: "signature.request" }), { reset: true });
  assert.deepEqual(await reset(h.ctx, { key: "signature.request" }), { reset: false });
  assert.equal((await get(h.ctx, { key: "signature.request" })).template.source, "builtin");
});

test("a document keeps its own version, which beats the Space's; clearing returns to the Space's", async () => {
  const h = setup();
  await save(h.ctx, { key: "signature.reminder", subject: "Space reminder {{document_title}}", text: "Space body" });
  assert.equal(resolve(h.ctx, "signature.reminder", DOC)?.source, "space");
  const set = await forDocumentSet(h.ctx, { documentId: DOC, key: "signature.reminder", subject: "Doc reminder {{document_title}}", text: "Doc body {{sign_link}}" });
  assert.deepEqual(contractErrors("mail.template.for_document.set", "out", set), []);
  assert.equal(set.template.source, "document");
  const got = await forDocumentGet(h.ctx, { documentId: DOC, key: "signature.reminder" });
  assert.deepEqual(contractErrors("mail.template.for_document.get", "out", got), []);
  assert.equal(got.override, true);
  assert.equal((await forDocumentGet(h.ctx, { documentId: "fil_other0001", key: "signature.reminder" })).override, false);
  assert.equal((await preview(h.ctx, { key: "signature.reminder", documentId: DOC, vars: { document_title: "Plan", sign_link: "https://sign.vyre.test/p" } })).subject, "Doc reminder Plan");
  assert.deepEqual(await forDocumentClear(h.ctx, { documentId: DOC, key: "signature.reminder" }), { cleared: true });
  assert.deepEqual(await forDocumentClear(h.ctx, { documentId: DOC, key: "signature.reminder" }), { cleared: false });
  assert.equal(resolve(h.ctx, "signature.reminder", DOC)?.source, "space");
});

test("bad input is refused in plain words: keys, empty or multi-line subjects, empty bodies, unknown keys, odd vars", async () => {
  const h = setup();
  const bad = (p: Promise<unknown>) => assert.rejects(p, (e) => codeOf(e) === "validation.bad_input");
  await bad(save(h.ctx, { key: "Signature Request", subject: "s", text: "t" }));
  await bad(save(h.ctx, { key: "a.b", subject: " ", text: "t" }));
  await bad(save(h.ctx, { key: "a.b", subject: "line one\nBcc: x@y.test", text: "t" }));
  await bad(save(h.ctx, { key: "a.b", subject: "s", text: "  " }));
  await bad(forDocumentSet(h.ctx, { documentId: "nope", key: "signature.request", subject: "s", text: "t" }));
  await bad(preview(h.ctx, { key: "signature.request", vars: { "bad key": "x" } }));
  await bad(preview(h.ctx, { key: "signature.request", vars: { document_title: { a: 1 } } }));
  await assert.rejects(get(h.ctx, { key: "no.such.key" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(forDocumentSet(h.ctx, { documentId: DOC, key: "no.such.key", subject: "s", text: "t" }), (e) => codeOf(e) === "validation.not_found");
});

test("a value with a line break never splits the subject", async () => {
  const h = setup();
  const out = await preview(h.ctx, { subject: "Re: {{document_title}}", text: "x", vars: { document_title: "Plan\r\nBcc: someone@vyre.test" } });
  assert.equal(out.subject, "Re: Plan Bcc: someone@vyre.test");
  assert.ok(!/[\r\n]/.test(out.subject));
});

test("hostile text cannot slow the reader: a megabyte of unfinished tokens is read in seconds, not minutes", async () => {
  const hostile = "{{a|".repeat(250_000);
  const t0 = Date.now();
  const f = fillTokens(hostile, {});
  assert.equal(f.text, hostile);
  assert.deepEqual(tokensIn(hostile), []);
  const nested = "{{".repeat(500_000) + "x";
  fillTokens(nested, {});
  const longKey = "{{" + "a".repeat(400_000) + "}}";
  assert.deepEqual(fillTokens(longKey, {}).blanks, []);
  assert.ok(Date.now() - t0 < 4000, "the scan is linear (a quadratic scan of this text takes minutes)");
  const h = setup();
  const p0 = Date.now();
  await preview(h.ctx, { subject: "x", text: hostile.slice(0, 99_000) });
  assert.ok(Date.now() - p0 < 2000);
});

test("{{constructor}} and other prototype names are blank like any unknown field, in text and in html", async () => {
  for (const name of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
    const f = fillTokens(`a {{${name}}} b`, {});
    assert.deepEqual(f.blanks, [name.toLowerCase()]);
    assert.ok(!f.text.includes("native code"));
    fillTokens(`<b>{{${name}}}</b>`, {}, { html: true });
  }
  const h = setup();
  const out = await preview(h.ctx, { subject: "{{constructor}}", text: "x", vars: { constructor: "Pat" } });
  assert.equal(out.subject, "Pat");
  const bare = await preview(h.ctx, { subject: "{{constructor}}", text: "x" });
  assert.deepEqual(bare.blanks, ["constructor"]);
});

test("a document the caller cannot open is not read through get or preview, and free-text preview needs comms.templates", async () => {
  const h = setup();
  await forDocumentSet(h.ctx, { documentId: DOC, key: "signature.reminder", subject: "Secret {{document_title}}", text: "Secret wording" });
  h.denied.add(DOC);
  await assert.rejects(get(h.ctx, { key: "signature.reminder", documentId: DOC }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(preview(h.ctx, { key: "signature.reminder", documentId: DOC }), (e) => codeOf(e) === "validation.not_found");
  h.denied.delete(DOC);
  assert.equal((await preview(h.ctx, { key: "signature.reminder", documentId: DOC, vars: { document_title: "P" } })).subject, "Secret P");
  h.denied.add("spc_mailtest"); // the Space's template permission
  await assert.rejects(preview(h.ctx, { subject: "x", text: "y" }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal((await preview(h.ctx, { key: "signature.reminder", vars: { document_title: "P" } })).source, "builtin");
  await assert.rejects(preview(h.ctx, { key: "signature.reminder", subject: "x" }), (e) => codeOf(e) === "validation.bad_input");
});
