// rc.40: no regex in shipped code takes more than linear time on hostile input. Each case runs the code on about 100 KB of the worst
// shape the reviewer found (they took 2.6 to 16 s before) and must finish well inside 100 ms; the first lines of each group keep the
// ordinary outputs the code gave before.
import test from "node:test";
import assert from "node:assert/strict";
import { capText, isPipeRow, isPipeRule, replaceTokens, stripTags, tagsNamed } from "../lib/html-text.ts";
import { htmlToText as mailText, sanitizeHtml } from "../lib/mail-parse.ts";
import { parseAddresses } from "../modules/google/handlers/gmail.ts";
import { cleanHtml, fillTokens, htmlToText, safeUrl } from "../modules/email-builder-api/handlers/compile.ts";
import { askedIn } from "../lib/asked.ts";
import { redact } from "../agent/src/transcript/sanitize.ts";
import { pageMeta } from "../modules/automations/page-meta.ts";
import { docsView } from "../modules/automations/docs-text.ts";
import { links, toPlain } from "../lib/md.ts";
import { plainOf } from "../apps/app/src/places/chats/needsyou/heldmail.ts";
import { docsMarkdown } from "../apps/app/src/places/files/viewer/model.ts";

const N = 100_000;
const BUDGET_MS = 100;
function fast<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  assert.ok(ms < BUDGET_MS, `${label} took ${Math.round(ms)} ms on hostile input (budget ${BUDGET_MS} ms)`);
  return out;
}

test("mail HTML: an open tag with no end is read once (lib/mail-parse.ts tokenizer)", () => {
  assert.equal(mailText("<p>Hello <b>Imran</b></p><p>Bye</p>").trim(), "Hello Imran\n\nBye");
  assert.match(
    sanitizeHtml('<a href="https://northwind.example/x" onclick="x()">Go</a>').html,
    /href="https:\/\/northwind.example\/x"/,
  );
  fast("<a  x N", () => sanitizeHtml("<a ".repeat(N / 3)));
  fast("<a x= N", () => mailText('<a x="'.repeat(N / 6) + ">"));
  fast("<a b b N then quote", () => sanitizeHtml("<a x ".repeat(N / 5) + '"'));
  fast("<!-- N", () => mailText("<!--".repeat(N / 4)));
  fast("space run lines", () => mailText("a" + " ".repeat(N) + "b\n" + " ".repeat(N) + "\nc"));
});

test("address headers: a long space run cannot stall the parser (google gmail parseAddresses)", () => {
  assert.deepEqual(
    parseAddresses(
      'Imran Ibarra <imran@northwind.example>, "Lindahl, Andrea" <andrea@northwind.example>, sam@northwind.example',
    ),
    [
      { address: "imran@northwind.example", name: "Imran Ibarra" },
      { address: "andrea@northwind.example", name: "Lindahl, Andrea" },
      { address: "sam@northwind.example" },
    ],
  );
  assert.deepEqual(parseAddresses("<x@northwind.example>"), [{ address: "x@northwind.example" }]);
  fast("x spaces !", () => parseAddresses("x" + " ".repeat(N) + "!"));
  fast("x spaces ! 900", () => parseAddresses(("x" + " ".repeat(900) + "!, ").repeat(100)));
});

test("email builder: hostile HTML and merge tokens (compile.ts cleanHtml, htmlToText, safeUrl, fillTokens)", () => {
  assert.equal(cleanHtml('<p onclick="x()">Hi</p><script>alert(1)</script><!-- c -->'), "<p>Hi</p>");
  assert.equal(
    htmlToText('<p>See <a href="https://northwind.example">the site</a></p>'),
    "See the site (https://northwind.example)",
  );
  assert.equal(fillTokens("Hi {{ first_name | there }}", { first_name: "Imran" }), "Hi Imran");
  assert.equal(safeUrl("{{unsubscribe_url}}"), "{{unsubscribe_url}}");
  assert.equal(safeUrl("javascript:x"), "#");
  fast("<a spaces x", () => cleanHtml("<a" + " ".repeat(N) + "x"));
  fast("<a onx= N", () => cleanHtml('<a onx="'.repeat(N / 8)));
  fast("<!-- N", () => cleanHtml("<!--".repeat(N / 4)));
  fast("<script N", () => cleanHtml("<script ".repeat(N / 8)));
  fast("<input N", () => cleanHtml("<input ".repeat(N / 7)));
  fast("<meta N", () => cleanHtml("<meta ".repeat(N / 6)));
  fast("anchors N", () => htmlToText("<a href='x'>".repeat(N / 12)));
  fast("<style N", () => htmlToText("<style>".repeat(N / 7)));
  fast("{{x| N", () => safeUrl("{{x|".repeat(N / 4)));
  fast("{{x| N fill", () => fillTokens("{{x|".repeat(N / 4), { x: "y" }));
  fast("{{x| N }}", () => fillTokens("{{x|".repeat(N / 4) + "}}", { x: "y" }));
});

test("asked: an address pattern reads a long word once (lib/asked.ts)", () => {
  assert.deepEqual(
    askedIn("Please email the report to lee@acme.test").map((a) => `${a.act}:${a.target}`),
    ["send:lee@acme.test"],
  );
  fast("a N", () => askedIn("email " + "a".repeat(N)));
  fast("a. N", () => askedIn("send to " + "a.".repeat(N / 2)));
  fast("a@ N", () => askedIn("send to " + "a@".repeat(N / 2)));
});

test("transcript sanitizer: a password pattern reads a long name once (agent transcript/sanitize.ts)", () => {
  assert.match(redact("password: hunter2hunter2").text, /redacted|\*|\[/i);
  assert.ok(redact("db_password=correct-horse-battery").hits.length >= 1);
  fast("a_ N", () => redact("a_".repeat(N / 2)));
  fast("-_ N", () => redact(" a-_".repeat(N / 4) + "pass"));
});

test("fetched pages: meta, title and text (automations page-meta.ts, docs-text.ts)", () => {
  const base = new URL("https://northwind.example/");
  assert.equal(
    pageMeta('<head><meta property="og:title" content="Hello"><title>T</title></head>', base).title,
    "Hello",
  );
  assert.equal(pageMeta("<title>Only</title>", base).title, "Only");
  fast("meta attr run", () => pageMeta("<meta " + "a".repeat(60_000) + ">", base));
  fast("<meta N", () => pageMeta("<meta ".repeat(10_000), base));
  fast("<title N", () => pageMeta("<title".repeat(10_000), base));
  assert.match(
    docsView("<html><body><p>Hello <b>there</b></p><a href='/x'>Go</a></body></html>", base).text,
    /Hello there/,
  );
  fast("< N docs", () => docsView("<html>" + "<".repeat(N), base));
  fast("<a N docs", () => docsView("<html>" + "<a href='/x'>".repeat(N / 13), base));
  fast("<script N docs", () => docsView("<html>" + "<script>".repeat(N / 8), base));
});

test("one shared tag stripper (lib/html-text.ts), used by agent tools, held mail, contact tab and needs-you", () => {
  assert.equal(stripTags("a<b>c</b>d"), "acd");
  assert.equal(stripTags("a<b>c</b>d", " "), "a c d");
  assert.equal(stripTags("1 < 2 and 3 > 2"), "1  2");
  assert.equal(stripTags("x < y"), "x < y");
  assert.equal(plainOf("<p>Hi&nbsp;Imran</p><p>Bye</p>").trim(), "Hi Imran\nBye");
  fast("< N", () => stripTags("<".repeat(N)));
  fast("<a N", () => stripTags("<a ".repeat(N / 3)));
  fast("plainOf < N", () => plainOf("<".repeat(N)));
  assert.equal(capText("abc", 2), "ab");
  assert.deepEqual(tagsNamed("<meta a=1><metadata><META b=2>", "meta"), ["<meta a=1>", "<META b=2>"]);
});

test("markdown: links, images and fences (lib/md.ts)", () => {
  assert.deepEqual(links('[[Note|label]] and [site](https://northwind.example/a "t") ![i](x.png)'), {
    wiki: ["Note"],
    urls: ["https://northwind.example/a"],
  });
  assert.equal(
    toPlain("```js\nlet a = 1;\n```\n[go](https://northwind.example) ![alt](x.png)"),
    "let a = 1;\n\ngo alt",
  );
  fast("![ N", () => toPlain("![".repeat(N / 2)));
  fast("[]( N", () => links("[](".repeat(N / 3)));
  fast("[]( a N", () => links("[](" + "a".repeat(N)));
  fast("[[ N", () => toPlain("[[".repeat(N / 2)));
  fast("``` N", () => toPlain("```\n".repeat(N / 4)));
  fast("newlines", () => toPlain("\n".repeat(N)));
});

test("table rows in the file viewer (apps files/viewer/model.ts)", () => {
  assert.equal(docsMarkdown("| a | b |\n| --- | :---: |\n| 1 | 2 |"), "a · b\n1 · 2");
  assert.equal(isPipeRule("|---|:--:|"), false);
  assert.equal(isPipeRule("| --- | :---: |"), true);
  assert.equal(isPipeRow("| a | b |"), true);
  assert.equal(isPipeRow("a | b"), false);
  fast("| spaces x", () => docsMarkdown("|" + " ".repeat(N) + "x"));
  fast("| N", () => docsMarkdown("|".repeat(N) + "x"));
  fast("rule spaces", () => isPipeRule("|" + " ".repeat(N) + "x"));
});

test("merge tokens: one scanner (lib/html-text.ts replaceTokens)", () => {
  assert.equal(
    replaceTokens("a {{ x }} b {{y|z}}", (k, f) => `[${k}${f ? `:${f}` : ""}]`),
    "a [x] b [y:z]",
  );
  assert.equal(
    replaceTokens("{{ no close", () => "!"),
    "{{ no close",
  );
  fast("{{ N", () => replaceTokens("{{ ".repeat(N / 3), () => "!"));
  fast("{{x| N }}", () => replaceTokens("{{x|".repeat(N / 4) + "}}", () => "!"));
});
