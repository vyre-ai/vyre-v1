// A block design compiles to table HTML and a plain-text part; checks flag a missing unsubscribe; the Ask diff round-trips (spec 2.19, 3.6).
// @reads /modules/email-builder-api/migrations/0001_email_builder.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import {
  applyChanges, cleanHtml, cleanInline, compileHtml, compileText, diffDocs, fillTokens, htmlToText, runChecks, safeUrl, stable, valuesOf, validateDoc,
} from "../handlers/compile.ts";
import type { Block, EmailDoc } from "../handlers/compile.ts";
import { harness } from "../fixtures/world.ts";

const text = (html: string, extra: Record<string, unknown> = {}): Block => ({ type: "text", props: { html, ...extra } });
const doc = (blocks: Block[], extra: Partial<EmailDoc> = {}): EmailDoc => ({ emailId: "eml_1", name: "Spring note", mode: "blocks", blocks, ...extra });
const unsub: Block = { type: "merge", props: { key: "unsubscribe_url" } };
const level = (d: EmailDoc, id: string): string | undefined => runChecks(d, compileHtml(d), compileText(d)).find((c) => c.id === id)?.level;

test("compile: a block design is a 600 px card of table rows with inline styles, a viewport, a dark sheet and a title", () => {
  const html = compileHtml(doc([text("Hello <b>Dana</b> &amp; co"), { type: "divider", props: {} }], { subject: "Hi {{first_name|there}}" }));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<title>Hi \{\{first_name\|there\}\}<\/title>/, "tokens stay in a send copy");
  assert.match(html, /<table role="presentation" width="600"[^>]*max-width:100%/);
  assert.equal((html.match(/<tr><td data-b="/g) ?? []).length, 2, "one row per block");
  assert.match(html, /data-b="text"[^>]*>.*Hello <b>Dana<\/b> &amp; co/s);
  assert.match(html, /border-top:1px solid #E4E4E7/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /@media \(max-width:620px\)/);
});

test("compile: text is made safe: other tags show as text, links keep only a safe address, entities are not doubled", () => {
  const html = compileHtml(doc([text('<script>alert(1)</script><a href="javascript:alert(1)">x</a> <a href="https://example.com/a?b=1&c=2">y</a> 5 < 6 & 7 &lt; 8 <img src=x onerror=boom>')]));
  assert.equal(html.includes("<script"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href="#">x<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2">y<\/a>/);
  assert.match(html, /5 &lt; 6 &amp; 7 &lt; 8/);
  assert.equal(/<img[^>]*onerror/.test(html), false);
  assert.equal(cleanInline("<b>ok</b>"), "<b>ok</b>");
  assert.equal(cleanInline("a<br/>b"), "a<br>b");
  assert.equal(safeUrl("https://x.example/p"), "https://x.example/p");
  assert.equal(safeUrl("mailto:a@b.example"), "mailto:a@b.example");
  assert.equal(safeUrl("{{unsubscribe_url}}"), "{{unsubscribe_url}}");
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>", "//evil.example", "https://a b", "", null]) assert.equal(safeUrl(bad), "#", String(bad));
});

test("compile: buttons, images, dividers and columns", () => {
  const html = compileHtml(doc([
    { type: "button", props: { label: "Book <now>", href: "https://x.example/book", bg: "#112233", color: "#ffffff", radius: 4 } },
    { type: "button", props: { label: "Bad", href: "javascript:x" } },
    { type: "image", props: { src: "https://cdn.example/a.png", alt: "Logo", width: 50, href: "https://x.example" } },
    { type: "image", props: { src: "javascript:alert(1)", alt: "gone" } },
    { type: "divider", props: { thickness: 3, color: "#ff0000" } },
    { type: "columns", props: { ratio: "2:1", cols: [[text("Left")], [text("Right")]] } },
  ]));
  assert.match(html, /background:#112233;border-radius:4px/);
  assert.match(html, />Book &lt;now&gt;<\/a>/);
  assert.match(html, /<a href="#" style="display:inline-block/, "a script address on a button is dropped");
  assert.match(html, /<a href="https:\/\/x\.example"><img src="https:\/\/cdn\.example\/a\.png" alt="Logo" width="268"/);
  assert.equal(html.includes("gone"), false, "an image with an unsafe source is left out");
  assert.equal((html.match(/data-b="image"/g) ?? []).length, 1);
  assert.match(html, /border-top:3px solid #ff0000/);
  assert.match(html, /class="stack"/);
  assert.match(html, /width="67%"[^>]*>.*Left.*width="33%"[^>]*>.*Right/s);
});

test("compile: merge fields stay in a send copy and fill in a preview, with fallbacks, and values are escaped", () => {
  const d = doc([{ type: "merge", props: { key: "first_name", fallback: "there" } }, text("Hi {{ company }} and {{owner_name|the team}}"), unsub], { subject: "For {{first_name}}" });
  const send = compileHtml(d);
  assert.match(send, /\{\{first_name\|there\}\}/);
  assert.match(send, /<a href="\{\{unsubscribe_url\}\}"[^>]*>Unsubscribe<\/a>/);
  const dana = compileHtml(d, { values: { first_name: "Dana <b>", company: "Rivera & Co" } });
  assert.match(dana, /Dana &lt;b&gt;/);
  assert.match(dana, /Rivera &amp; Co/);
  assert.match(dana, /the team/, "a missing value uses the fallback");
  assert.match(dana, /<title>For Dana &lt;b&gt;<\/title>/);
  const none = compileHtml(d, { values: {} });
  assert.match(none, /there/);
  assert.match(none, /Hi company and the team/, "no value and no fallback reads as the field's name");
  assert.equal(fillTokens("{{a}}", null), "{{a}}");
  assert.deepEqual(valuesOf({ First_Name: "Dana", n: 3, ok: true, nested: { x: 1 }, nothing: null }), { first_name: "Dana", n: "3", ok: "true" });
});

test("compile: the mobile and dark previews add their sheets; HTML and plain designs compile too", () => {
  const d = doc([text("x")]);
  const count = (html: string, needle: string) => html.split(needle).length - 1;
  const desktop = compileHtml(d), mobile = compileHtml(d, { variant: "mobile" }), dark = compileHtml(d, { variant: "dark" });
  assert.equal(count(desktop, ".col{display:block!important"), 1, "only in the small-screen media query");
  assert.equal(count(mobile, ".col{display:block!important"), 2, "and forced for the mobile preview");
  assert.equal(count(desktop, "background:#0F0F11!important"), 1);
  assert.equal(count(dark, "background:#0F0F11!important"), 2);

  const raw = compileHtml({ emailId: "e", name: "n", mode: "html", html: '<p onclick="x()">Hi</p><script>bad()</script><a href="javascript:bad()">go</a><style>p{color:red}</style>' });
  assert.match(raw, /<p>Hi<\/p>/);
  assert.equal(/script|onclick|javascript:/i.test(raw.replace(/<style>[\s\S]*?<\/style>/, "")), false);
  assert.match(raw, /<a href="#">go<\/a>/);
  assert.match(raw, /p\{color:red\}/, "author styles are kept");
  const whole = compileHtml({ emailId: "e", name: "n", mode: "html", html: "<!doctype html><html><body>Mine {{first_name|you}}</body></html>" }, { values: {} });
  assert.equal(whole, "<!doctype html><html><body>Mine you</body></html>", "a full document is the author's");
  const plain = compileHtml({ emailId: "e", name: "n", mode: "plain", plain: "One\nline two\n\nSecond <b>paragraph</b>" });
  assert.match(plain, /One<br>line two/);
  assert.match(plain, /Second &lt;b&gt;paragraph&lt;\/b&gt;/);
  assert.equal(cleanHtml("<!-- c --><b>x</b>"), "<b>x</b>");
});

test("compile: the plain-text part is made from the blocks, with links, buttons, an alt line and the unsubscribe line", () => {
  const d = doc([
    text('Hello <b>Dana</b>,<br>see <a href="https://x.example/p">the plan</a> &amp; more'),
    { type: "button", props: { label: "Open", href: "https://x.example/open" } },
    { type: "divider", props: {} },
    { type: "image", props: { src: "https://cdn.example/a.png", alt: "Logo" } },
    { type: "columns", props: { cols: [[text("Left col")], [text("Right col")]] } },
    { type: "merge", props: { key: "first_name", fallback: "there" } },
    { type: "html", props: { code: "<style>p{}</style><p>Raw <i>html</i></p>" } },
    unsub,
  ]);
  assert.equal(compileText(d), [
    "Hello Dana,\nsee the plan (https://x.example/p) & more",
    "Open: https://x.example/open",
    "-----",
    "[Logo]",
    "Left col",
    "Right col",
    "{{first_name|there}}",
    "Raw html",
    "Unsubscribe: {{unsubscribe_url}}",
  ].join("\n\n") + "\n");
  assert.match(compileText(d, { values: { first_name: "Dana" } }), /\nDana\n/);
  assert.equal(compileText({ emailId: "e", name: "n", mode: "plain", plain: "  as written  " }), "as written\n");
  assert.equal(compileText({ emailId: "e", name: "n", mode: "html", html: "<h1>Title</h1><p>Body &amp; soul</p>" }), "Title\nBody & soul\n");
  assert.equal(compileText({ emailId: "e", name: "n", mode: "html", html: "<p>x</p>", plain: "mine" }), "mine\n", "a hand-written part wins");
  assert.equal(compileText(doc([text("x")], { plain: "hand written" })), "hand written\n");
  assert.equal(htmlToText("a&nbsp;b &#65;&#x41; &lt;"), "a b A&#x41; <");
});

test("checks: a design without an unsubscribe link is flagged, and the footer link clears it", () => {
  const bare = doc([text("Hello")], { subject: "Hello" });
  assert.equal(level(bare, "unsub"), "bad");
  assert.equal(level(bare, "plain"), "warn", "the plain part has no unsubscribe either");
  const checks = runChecks(bare, compileHtml(bare), compileText(bare));
  assert.match(checks.find((c) => c.id === "unsub")?.text ?? "", /^Missing\./);
  const withFooter = doc([text("Hello"), unsub], { subject: "Hello" });
  assert.equal(level(withFooter, "unsub"), "ok");
  assert.equal(level(withFooter, "plain"), "ok");
  assert.deepEqual(runChecks(withFooter, compileHtml(withFooter), compileText(withFooter)).filter((c) => c.level !== "ok"), []);
  // an unsubscribe word with no link does not count
  assert.equal(level(doc([text("To unsubscribe, reply STOP")]), "unsub"), "bad");
});

test("checks: links, alt text, spam words, size, subject", () => {
  assert.equal(level(doc([text('<a href="">x</a>')]), "links"), "bad");
  assert.equal(level(doc([text('<a href="http://insecure.example">x</a>')]), "links"), "warn");
  assert.equal(level(doc([text('<a href="https://ok.example">x</a>')]), "links"), "ok");
  assert.equal(level(doc([{ type: "image", props: { src: "https://c.example/a.png", alt: "" } }]), "alt"), "warn");
  assert.equal(level(doc([{ type: "image", props: { src: "https://c.example/a.png", alt: "Logo" } }]), "alt"), "ok");
  const spam = runChecks(doc([text("Act now for FREE MONEY")]), "Act now for FREE MONEY", "");
  assert.match(spam.find((c) => c.id === "spam")?.text ?? "", /"free money".*"act now"/);
  assert.equal(level({ emailId: "e", name: "n", mode: "html", html: "x".repeat(110_000) }, "weight"), "warn");
  assert.equal(level(doc([text("x")], { subject: "" }), "subject"), "warn");
  assert.equal(level(doc([text("x")], { subject: "s".repeat(80) }), "subject"), "warn");
  assert.equal(level(doc([text("x")], { subject: "Short" }), "subject"), "ok");
  assert.equal(runChecks(doc([]), "", "").find((c) => c.id === "plain")?.level, "bad", "no plain-text part at all");
});

test("validate: a design is held to the limits the host stores", () => {
  const { ctx } = harness();
  const code = (input: unknown): string => { try { validateDoc(ctx, input); } catch (e) { if (e instanceof VyreErr) return e.error.code; throw e; } return "none"; };
  const base = { emailId: "eml_1", name: "n", mode: "blocks", blocks: [] };
  assert.equal(code(base), "none");
  assert.equal(code({ ...base, mode: "rtf" }), "validation.bad_input");
  assert.equal(code({ ...base, name: " " }), "validation.bad_input");
  assert.equal(code({ ...base, blocks: "x" }), "validation.bad_input");
  assert.equal(code({ ...base, blocks: [{ type: "video", props: {} }] }), "validation.bad_input");
  assert.equal(code({ ...base, blocks: [{ type: "text" }] }), "validation.bad_input");
  assert.equal(code({ ...base, subject: "a\nb" }), "validation.bad_input");
  assert.equal(code({ ...base, html: "x".repeat(1024 * 1024 + 1) }), "validation.too_large");
  assert.equal(code({ ...base, plain: "x".repeat(256 * 1024 + 1) }), "validation.too_large");
  assert.equal(code({ ...base, blocks: Array.from({ length: 501 }, () => text("x")) }), "validation.too_large");
  const nest = (depth: number): Block => (depth === 0 ? text("leaf") : { type: "columns", props: { cols: [[nest(depth - 1)]] } });
  assert.equal(code({ ...base, blocks: [nest(3)] }), "none");
  assert.equal(code({ ...base, blocks: [nest(4)] }), "validation.bad_input", "columns nest three deep at most");
  assert.equal(code({ ...base, blocks: [{ type: "columns", props: { cols: [] } }] }), "validation.bad_input");
  assert.equal(code({ ...base, blocks: [{ type: "columns", props: { cols: [[], [], [], [], []] } }] }), "validation.bad_input");
});

test("diff: every change is its own pointer with before and after, and accepted changes apply", () => {
  const before = doc([text("Hello"), { type: "button", props: { label: "Open", href: "https://x.example" } }], { subject: undefined as unknown as string });
  delete before.subject;
  const after = doc([text("Hello there"), { type: "button", props: { label: "Open now", href: "https://x.example" } }, { type: "divider", props: {} }], { subject: "Hi" });
  const changes = diffDocs(before, after);
  assert.deepEqual(changes.map((c) => c.path), ["/subject", "/blocks/0/props/html", "/blocks/1/props/label", "/blocks/2"]);
  assert.deepEqual(changes[0], { path: "/subject", before: null, after: "Hi" });
  assert.deepEqual(changes[2], { path: "/blocks/1/props/label", before: "Open", after: "Open now" });
  assert.deepEqual(changes[3], { path: "/blocks/2", before: null, after: { type: "divider", props: {} } });
  assert.equal(stable(applyChanges(before, changes)), stable(after), "all accepted gives the proposal");
  const some = applyChanges(before, [changes[1] as never, changes[2] as never]);
  assert.equal((some.blocks?.[0]?.props.html), "Hello there");
  assert.equal(some.blocks?.[1]?.props.label, "Open now");
  assert.equal(some.subject, undefined, "a change not accepted is not made");
  assert.equal(some.blocks?.length, 2);
  assert.deepEqual(diffDocs(after, after), []);
  // removal and a changed type
  const shorter = doc([text("Hello")]);
  assert.deepEqual(diffDocs(before, shorter).map((c) => c.path), ["/blocks/1"]);
  assert.equal(applyChanges(before, diffDocs(before, shorter)).blocks?.length, 1);
  const swapped = doc([{ type: "divider", props: {} }, before.blocks?.[1] as Block]);
  assert.deepEqual(diffDocs(before, swapped).map((c) => c.path), ["/blocks/0"]);
  assert.equal(stable(applyChanges(before, diffDocs(before, swapped))), stable(swapped));
  // the key order a client writes does not make a change
  assert.deepEqual(diffDocs(doc([{ type: "button", props: { a: 1, b: 2 } }]), doc([{ type: "button", props: { b: 2, a: 1 } }])), []);
  assert.equal(stable({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
});
