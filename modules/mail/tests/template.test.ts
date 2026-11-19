// mail.template.* (lane r42-email-in): built-ins, the Space's version, a document's own version, preview on a real record, blanks and fallbacks.
// Addresses and names are invented; nothing is sent.
import test from "node:test";
import assert from "node:assert/strict";
import {
  forDocumentClear,
  forDocumentGet,
  forDocumentSet,
  get,
  list,
  preview,
  reset,
  resolve,
  save,
} from "../handlers/extra/template.ts";
import { fillTokens, tokensIn, unsafeUrl } from "../../../lib/merge-tokens.ts";
import { script } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const DOC = "fil_doc0001";
const REC = "rec_signer01";

/** The contact type's fields as the schema holds them: only those marked options.mergeable may go into an email. A test changes this list to add a field later. */
const TYPE_FIELDS: { key: string; options?: { mergeable: boolean } }[] = [];
function resetType(): void {
  TYPE_FIELDS.length = 0;
  TYPE_FIELDS.push(
    { key: "signer_name", options: { mergeable: true } },
    { key: "company", options: { mergeable: true } },
    { key: "ssn" },
    { key: "card_number" },
  );
}
function setup(fields: Record<string, unknown> = { signer_name: "Sam Rivers", company: "Acme" }): Harness {
  resetType();
  const h = harness();
  script(h, {
    "schema.types.list": () => ({ types: [{ key: "contact" }] }),
    "schema.types.get": () => ({ type: { key: "contact", fields: TYPE_FIELDS } }),
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
  assert.deepEqual(
    out.templates.map((t) => t.key),
    ["signature.request", "signature.reminder", "signature.signed_copy", "signature.expired"],
  );
  assert.ok(out.templates.every((t) => t.source === "builtin" && !t.customised));
  const one = await get(h.ctx, { key: "signature.request" });
  assert.deepEqual(contractErrors("mail.template.get", "out", one), []);
  assert.deepEqual(
    one.template.fields.map((f) => f.key),
    ["sender_name", "document_title", "signer_name", "message", "sign_link", "expires_on"],
  );
});

test("a preview fills a signature request from the values esign passes and says what would be blank", async () => {
  const h = setup();
  const out = await preview(h.ctx, {
    key: "signature.request",
    vars: {
      signer_name: "Sam Rivers",
      document_title: "Service agreement",
      sender_name: "Pat Lee",
      sign_link: "https://sign.vyre.test/a?x=1&y=2",
      expires_on: "30 Nov",
    },
  });
  assert.deepEqual(contractErrors("mail.template.preview", "out", out), []);
  assert.equal(out.subject, "Pat Lee asked you to sign Service agreement");
  assert.match(
    out.text,
    /^Hi Sam Rivers,\n\nPat Lee asked you to sign Service agreement\.\n\n\n\nOpen it here:\nhttps:\/\/sign\.vyre\.test\/a\?x=1&y=2\n\nThe link works until 30 Nov\.$/,
  );
  assert.deepEqual(out.blanks, []);
  const missingLink = await preview(h.ctx, {
    key: "signature.request",
    vars: { document_title: "Plan", sender_name: "Pat" },
  });
  assert.deepEqual(missingLink.blanks, ["sign_link"]);
  assert.deepEqual(missingLink.fallbacks.sort(), ["expires_on", "message", "signer_name"]);
});

test("a preview on a real record reads it as the caller, and vars win over the record", async () => {
  const h = setup();
  const out = await preview(h.ctx, {
    subject: "For {{company}}",
    text: "Hi {{signer_name}} at {{company}}",
    recordId: REC,
    vars: { company: "Globex" },
  });
  assert.equal(out.source, "draft");
  assert.equal(out.subject, "For Globex");
  assert.equal(out.text, "Hi Sam Rivers at Globex");
  await assert.rejects(
    preview(h.ctx, { subject: "x", text: "y", recordId: "rec_nobody" }),
    (e) => codeOf(e) === "validation.not_found",
  );
});

test("the Space version replaces the built-in until it is reset; saving the same text twice changes nothing", async () => {
  const h = setup();
  const saved = await save(h.ctx, {
    key: "signature.request",
    subject: "Please sign {{document_title}}",
    text: "Hello {{signer_name|there}}\n{{sign_link}}",
  });
  assert.deepEqual(contractErrors("mail.template.save", "out", saved), []);
  assert.equal(saved.template.source, "space");
  assert.equal(saved.template.version, 1);
  const again = await save(h.ctx, {
    key: "signature.request",
    subject: "Please sign {{document_title}}",
    text: "Hello {{signer_name|there}}\n{{sign_link}}",
  });
  assert.equal(again.template.version, 1);
  const edited = await save(h.ctx, {
    key: "signature.request",
    subject: "Please sign {{document_title}} today",
    text: "Hello {{signer_name|there}}\n{{sign_link}}",
  });
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
  const set = await forDocumentSet(h.ctx, {
    documentId: DOC,
    key: "signature.reminder",
    subject: "Doc reminder {{document_title}}",
    text: "Doc body {{sign_link}}",
  });
  assert.deepEqual(contractErrors("mail.template.for_document.set", "out", set), []);
  assert.equal(set.template.source, "document");
  const got = await forDocumentGet(h.ctx, { documentId: DOC, key: "signature.reminder" });
  assert.deepEqual(contractErrors("mail.template.for_document.get", "out", got), []);
  assert.equal(got.override, true);
  assert.equal(
    (await forDocumentGet(h.ctx, { documentId: "fil_other0001", key: "signature.reminder" })).override,
    false,
  );
  assert.equal(
    (
      await preview(h.ctx, {
        key: "signature.reminder",
        documentId: DOC,
        vars: { document_title: "Plan", sign_link: "https://sign.vyre.test/p" },
      })
    ).subject,
    "Doc reminder Plan",
  );
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
  await assert.rejects(
    forDocumentSet(h.ctx, { documentId: DOC, key: "no.such.key", subject: "s", text: "t" }),
    (e) => codeOf(e) === "validation.not_found",
  );
});

test("a value with a line break never splits the subject", async () => {
  const h = setup();
  const out = await preview(h.ctx, {
    subject: "Re: {{document_title}}",
    text: "x",
    vars: { document_title: "Plan\r\nBcc: someone@vyre.test" },
  });
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
  // with no value passed it is not a field the draft may name at all
  await assert.rejects(
    preview(h.ctx, { subject: "{{constructor}}", text: "x" }),
    (e) => codeOf(e) === "validation.bad_input",
  );
});

test("a document the caller cannot open is not read through get or preview, and free-text preview needs comms.templates", async () => {
  const h = setup();
  await forDocumentSet(h.ctx, {
    documentId: DOC,
    key: "signature.reminder",
    subject: "Secret {{document_title}}",
    text: "Secret wording",
  });
  h.denied.add(DOC);
  await assert.rejects(
    get(h.ctx, { key: "signature.reminder", documentId: DOC }),
    (e) => codeOf(e) === "validation.not_found",
  );
  await assert.rejects(
    preview(h.ctx, { key: "signature.reminder", documentId: DOC }),
    (e) => codeOf(e) === "validation.not_found",
  );
  h.denied.delete(DOC);
  assert.equal(
    (await preview(h.ctx, { key: "signature.reminder", documentId: DOC, vars: { document_title: "P" } })).subject,
    "Secret P",
  );
  h.denied.add("spc_mailtest"); // the Space's template permission
  await assert.rejects(preview(h.ctx, { subject: "x", text: "y" }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal((await preview(h.ctx, { key: "signature.reminder", vars: { document_title: "P" } })).source, "builtin");
  await assert.rejects(
    preview(h.ctx, { key: "signature.reminder", subject: "x" }),
    (e) => codeOf(e) === "validation.bad_input",
  );
});

test("a link value in a tag is http, https, mailto or tel; anything else becomes # and is never an href", () => {
  for (const bad of [
    "javascript:alert(1)",
    " JaVa\nScRiPt:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:x",
    "file:///etc/passwd",
  ]) {
    assert.equal(unsafeUrl(bad), true, bad);
    assert.equal(
      fillTokens('<a href="{{sign_link}}">go</a>', { sign_link: bad }, { html: true }).text,
      '<a href="#">go</a>',
    );
    if (!/\s/.test(bad))
      assert.equal(fillTokens("<img src={{sign_link}}>", { sign_link: bad }, { html: true }).text, "<img src=#>");
  }
  for (const ok of [
    "https://sign.vyre.test/a?x=1&y=2",
    "http://a.test",
    "mailto:pat@acme.test",
    "tel:+15550100",
    "/relative/path",
  ]) {
    assert.equal(unsafeUrl(ok), false, ok);
  }
  assert.equal(
    fillTokens('<a href="{{l}}">go</a>', { l: "https://sign.vyre.test/a?x=1&y=2" }, { html: true }).text,
    '<a href="https://sign.vyre.test/a?x=1&amp;y=2">go</a>',
  );
  // in the text between tags the same value is only text: shown, escaped, not a link
  assert.equal(
    fillTokens("<p>{{l}}</p>", { l: "javascript:alert(1)" }, { html: true }).text,
    "<p>javascript:alert(1)</p>",
  );
  // plain text mode is left alone
  assert.equal(fillTokens("{{l}}", { l: "javascript:alert(1)" }).text, "javascript:alert(1)");
});

test("saving a key twice, with a reset between, leaves one live template", async () => {
  const h = setup();
  await save(h.ctx, { key: "signature.request", subject: "A", text: "a" });
  await reset(h.ctx, { key: "signature.request" });
  await save(h.ctx, { key: "signature.request", subject: "B", text: "b" });
  await save(h.ctx, { key: "signature.request", subject: "C", text: "c" });
  assert.equal(
    h.rows(`SELECT id FROM mail_template WHERE key = ? AND deleted_at IS NULL`, "signature.request").length,
    1,
  );
});

test("a link is judged on the value as rendered: a > inside a quoted attribute, a scheme split over two fields, entities, and unquoted values", () => {
  const f = (tpl: string, v: Record<string, string>) => fillTokens(tpl, v, { html: true }).text;
  assert.equal(f('<a title="a>b" href="{{u}}">x</a>', { u: "javascript:alert(1)" }), '<a title="a>b" href="#">x</a>');
  assert.equal(f("<a title='a>b' href='{{u}}'>x</a>", { u: "javascript:alert(1)" }), "<a title='a>b' href='#'>x</a>");
  assert.equal(f('<a href="{{a}}{{b}}">x</a>', { a: "javascript", b: ":alert(1)" }), '<a href="#">x</a>');
  assert.equal(f('<a href="java{{x}}">x</a>', { x: "script:alert(1)" }), '<a href="#">x</a>');
  // a value is escaped, so its "&" stays a letter and is not read as an entity; entities in the template's own text are read as the browser reads them
  assert.equal(
    f('<a href="{{u}}">x</a>', { u: "jav&#x61;script:alert(1)" }),
    '<a href="jav&amp;#x61;script:alert(1)">x</a>',
  );
  assert.equal(f('<a href="jav&#x61;script:alert(1)">x</a>', {}), '<a href="#">x</a>');
  assert.equal(f('<a href="&#106;avascript&colon;alert(1)">x</a>', {}), '<a href="#">x</a>');
  assert.equal(f("<a href={{u}}>x</a>", { u: "javascript:alert(1)" }), "<a href=#>x</a>");
  assert.equal(f('<a HREF="{{u}}">x</a>', { u: " \tjava\nscript:alert(1)" }), '<a HREF="#">x</a>');
  assert.equal(f('<a href="{{u}}">x</a>', { u: ":alert(1)" }), '<a href="#">x</a>');
  assert.equal(f('<img src="{{u}}">', { u: "cid:logo@vyre" }), '<img src="cid:logo@vyre">'); // an image inside the email
  assert.equal(f('<a href="{{u}}">x</a>', { u: "cid:logo@vyre" }), '<a href="#">x</a>');
  assert.equal(
    f('<a href="{{u}}">x</a>', { u: "https://sign.vyre.test/a?x=1&y=2" }),
    '<a href="https://sign.vyre.test/a?x=1&amp;y=2">x</a>',
  );
  assert.equal(f("<p>1 < 2 and {{u}}</p>", { u: "javascript:x" }), "<p>1 < 2 and javascript:x</p>");
});

test("a template may use only the fields it is made for or its record type marks mergeable; a new private field is refused with no change to any list", async () => {
  const h = setup({ signer_name: "Sam", ssn: "123-45-6789", card_number: "4111" });
  const bad = (p: Promise<unknown>) => assert.rejects(p, (e) => codeOf(e) === "validation.bad_input");
  await bad(save(h.ctx, { key: "a.b", subject: "x", text: "{{signer_name}}" })); // no record type: nothing is mergeable yet
  await save(h.ctx, { key: "a.b", subject: "x {{signer_name}}", text: "{{company|none}}", recordType: "contact" });
  await bad(save(h.ctx, { key: "a.b", subject: "x", text: "Your {{ssn}}", recordType: "contact" })); // the type does not mark it
  await bad(save(h.ctx, { key: "signature.request", subject: "x", text: "{{company}}" })); // a built-in takes its own fields, not the type's unless a type is named
  // a field added to the type later: refused until the type marks it, with no change here
  TYPE_FIELDS.push({ key: "secret_note" });
  await bad(save(h.ctx, { key: "a.b", subject: "x", text: "{{secret_note}}", recordType: "contact" }));
  // its value is never read into an email either, whatever the template says
  const out = await preview(h.ctx, { subject: "x", text: "{{signer_name}}", recordId: REC });
  assert.equal(out.text, "Sam");
  assert.ok(!JSON.stringify(out).includes("123-45") && !JSON.stringify(out).includes("4111"));
  // the type marks it mergeable: now it is allowed, by the type alone
  TYPE_FIELDS[TYPE_FIELDS.length - 1]!.options = { mergeable: true };
  await save(h.ctx, { key: "a.b", subject: "x", text: "{{secret_note}}", recordType: "contact" });
  // the system fields are always allowed
  await save(h.ctx, { key: "a.c", subject: "x", text: "Stop mail: {{unsubscribe_url}}" });
});

test("document wording needs edit on the file and comms.templates; reading needs view", async () => {
  const h = setup();
  const set = () => forDocumentSet(h.ctx, { documentId: DOC, key: "signature.reminder", subject: "S", text: "T" });
  await set();
  h.denied.add(DOC);
  await assert.rejects(set(), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(
    forDocumentClear(h.ctx, { documentId: DOC, key: "signature.reminder" }),
    (e) => codeOf(e) === "validation.not_found",
  );
  await assert.rejects(
    forDocumentGet(h.ctx, { documentId: DOC, key: "signature.reminder" }),
    (e) => codeOf(e) === "validation.not_found",
  );
  h.denied.delete(DOC);
  h.denied.add("spc_mailtest"); // no comms.templates
  await assert.rejects(set(), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(
    forDocumentClear(h.ctx, { documentId: DOC, key: "signature.reminder" }),
    (e) => codeOf(e) === "permission.no_grant",
  );
  assert.equal((await forDocumentGet(h.ctx, { documentId: DOC, key: "signature.reminder" })).override, true);
});

import { delivery, templates } from "../handlers/extra/tools.ts";
test("mail.templates and mail.delivery_state: the two tools route to the same behaviour, and changing a template asks for the right to", async () => {
  const h = setup();
  const list = (await templates(h.ctx, { action: "list" })).result as { templates: { key: string }[] };
  assert.equal(list.templates.length, 4);
  assert.deepEqual(contractErrors("mail.templates", "out", await templates(h.ctx, { action: "list" })), []);
  const set = (
    await templates(h.ctx, {
      action: "set",
      key: "signature.reminder",
      subject: "S {{document_title}}",
      text: "T {{sign_link}}",
    })
  ).result as { template: { source: string } };
  assert.equal(set.template.source, "space");
  assert.equal(
    ((await templates(h.ctx, { action: "get", key: "signature.reminder" })).result as { template: { subject: string } })
      .template.subject,
    "S {{document_title}}",
  );
  const view = (
    await templates(h.ctx, {
      action: "preview",
      key: "signature.reminder",
      vars: { document_title: "Plan", sign_link: "https://sign.vyre.test/p" },
    })
  ).result as { subject: string };
  assert.equal(view.subject, "S Plan");
  // a document's own wording through the same door
  await templates(h.ctx, {
    action: "set",
    key: "signature.reminder",
    documentId: DOC,
    subject: "Doc",
    text: "Doc text",
  });
  assert.equal(
    (
      (await templates(h.ctx, { action: "get", key: "signature.reminder", documentId: DOC })).result as {
        override: boolean;
      }
    ).override,
    true,
  );
  assert.equal(
    (
      (await templates(h.ctx, { action: "reset", key: "signature.reminder", documentId: DOC })).result as {
        cleared: boolean;
      }
    ).cleared,
    true,
  );
  assert.equal(
    ((await templates(h.ctx, { action: "reset", key: "signature.reminder" })).result as { reset: boolean }).reset,
    true,
  );
  // refusals: no key, no words, an unknown action, and no right to change
  await assert.rejects(templates(h.ctx, { action: "get" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(templates(h.ctx, { action: "set", key: "a.b" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(templates(h.ctx, { action: "nope" as never }), (e) => codeOf(e) === "validation.bad_input");
  h.denied.add("spc_mailtest");
  await assert.rejects(
    templates(h.ctx, { action: "set", key: "a.b", subject: "s", text: "t" }),
    (e) => codeOf(e) === "permission.no_grant",
  );
  await assert.rejects(
    templates(h.ctx, { action: "reset", key: "signature.reminder" }),
    (e) => codeOf(e) === "permission.no_grant",
  );
  assert.equal(((await templates(h.ctx, { action: "list" })).result as { templates: unknown[] }).templates.length, 4); // reading stays open
  // delivery: a message id gives its trail, none gives inbox health
  assert.deepEqual(contractErrors("mail.delivery_state", "out", await delivery(h.ctx, {})), []);
  assert.ok(Array.isArray(((await delivery(h.ctx, {})).result as { inboxes: unknown[] }).inboxes));
  await assert.rejects(delivery(h.ctx, { messageId: "eml_none" }), (e) => codeOf(e) === "validation.not_found");
});
