// rc.40: no regex in shipped code takes more than linear time on hostile input. Each case runs the code on about 100 KB of the worst
// shape the reviewer found (they took 2.6 to 16 s before) and must finish well inside 100 ms; the first lines of each group keep the
// ordinary outputs the code gave before.
import test from "node:test";
import assert from "node:assert/strict";
import { capText, isPipeRow, isPipeRule, replaceTokens, stripTags, tagsNamed } from "../lib/html-text.ts";
import { htmlToText as mailText, sanitizeHtml } from "../lib/mail-parse.ts";
import { parseAddresses } from "../modules/google/handlers/gmail.ts";
import { cleanHtml, fillTokens, htmlToText, safeUrl } from "../modules/email-builder-api/handlers/compile.ts";
import { summaryOf } from "../modules/agents/handlers/install.ts";
import { askedIn } from "../lib/asked.ts";
import { redact } from "../agent/src/transcript/sanitize.ts";
import { pageMeta } from "../modules/automations/page-meta.ts";
import { docsView } from "../modules/automations/docs-text.ts";
import { links, toPlain } from "../lib/md.ts";
import { plainOf } from "../apps/app/src/places/chats/needsyou/heldmail.ts";
import { docsMarkdown } from "../apps/app/src/places/files/viewer/model.ts";

// Fixed hostile samples and the outputs the code gave on rc.39 (the safe output is unchanged), as [input, cleanHtml, htmlToText, sanitizeHtml, mail htmlToText].
// One deliberate change: a <link rel=import> block is now removed (rc.39 left it in).
const SAMPLES: string[][] = [
  ['<p onclick="x()">a</p>', "<p>a</p>", "a", "<p>a</p>", "a"],
  [
    "<a href='javascript:alert(1)' onmouseover=alert(2)>x</a>",
    "<a href='#'>x</a>",
    "x (javascript:alert(1))",
    "<a>x</a>",
    "x",
  ],
  ["<img src=x onerror=alert(1)>", "<img src=x>", "", "", ""],
  ['<IMG SRC=x OnError = "alert(1)" alt=1>', "<IMG SRC=x alt=1>", "", "", ""],
  ["<svg onload=alert(1)><script>alert(2)</script></svg>", "<svg></svg>", "", "", ""],
  ['<iframe src="https://e.example"></iframe><p>t</p>', "<p>t</p>", "t", "<p>t</p>", "t"],
  ["<form action=x><input name=a><button formaction=y>b</button></form>", "", "b", "", ""],
  ["<!-- c --><p>x</p><!-- unclosed", "<p>x</p><!-- unclosed", "x\n<!-- unclosed", "<p>x</p>", "x"],
  ['<meta http-equiv="refresh" content="0;url=x"><p>m</p>', "<p>m</p>", "m", "<p>m</p>", "m"],
  ['<a href="data:text/html,<b>x</b>">d</a>', '<a href="#">d</a>', "d (data:text/html,x)", "<a>d</a>", "d"],
  [
    '<div style="background:url(javascript:alert(1))">u</div>',
    '<div style="background:none)">u</div>',
    "u",
    "<div>u</div>",
    "u",
  ],
  [
    '<style>@import "x";</style><p style="width:expression(alert(1))">e</p>',
    '<style>@import "x";</style><p style="width:blocked(alert(1))">e</p>',
    "e",
    "<p>e</p>",
    "e",
  ],
  ['<link rel="import" href="x"></link><p>l</p>', "<p>l</p>", "l", "<p>l</p>", "l"],
  ['<base href="https://e.example/"><p>b</p>', "<p>b</p>", "b", "<p>b</p>", "b"],
  ["<a onclick='a>b' href=x>q</a>", "<a href=x>q</a>", "b' href=x>q", "<a>q</a>", "q"],
  ["<p>1 < 2 and 3 > 2</p>", "<p>1 < 2 and 3 > 2</p>", "1 2", "<p>1 &lt; 2 and 3 &gt; 2</p>", "1 < 2 and 3 > 2"],
  [
    "<b>bold</b> <i>it</i><br>line<br/>two",
    "<b>bold</b> <i>it</i><br>line<br/>two",
    "bold it\nline\ntwo",
    "<b>bold</b> <i>it</i><br>line<br>two",
    "bold it\nline\ntwo",
  ],
  [
    '<a href="https://northwind.example/x">Site</a> and <a href="#">hash</a> <a href=\'mailto:a@b.example\'>mail</a> <a name=z>none</a>',
    '<a href="https://northwind.example/x">Site</a> and <a href="#">hash</a> <a href=\'mailto:a@b.example\'>mail</a> <a name=z>none</a>',
    "Site (https://northwind.example/x) and hash mail (mailto:a@b.example) none",
    '<a href="https://northwind.example/x" target="_blank" rel="noopener noreferrer nofollow">Site</a> <span class="vy-link-host">(northwind.example)</span> and <a>hash</a> <a href="mailto:a@b.example" target="_blank" rel="noopener noreferrer nofollow">mail</a> <span class="vy-link-host">(a@b.example)</span> <a>none</a>',
    "Site and hash mail none",
  ],
  ["<script>x</script <p>after", "x</script <p>after", "xafter", "after", "after"],
  ["<scr<!-- -->ipt>alert(1)</script>", "", "ipt>alert(1)", "&lt;script&gt;alert(1)", "<script>alert(1)"],
  ["<img o<!---->nerror=alert(1)>", "<img>", "nerror=alert(1)>", "nerror=alert(1)&gt;", "nerror=alert(1)>"],
  [
    '<p>a</p><p>unclosed <a href="x">link',
    '<p>a</p><p>unclosed <a href="x">link',
    "a\nunclosed link",
    "<p>a</p><p>unclosed <a>link</a></p>",
    "a\n\nunclosed link",
  ],
];

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

test("sanitizer keeps its meaning at the new limits (cleanHtml, mail tags, install summary, password prefix)", () => {
  const long = "x".repeat(9000);
  for (const q of ['"', "'"])
    assert.doesNotMatch(cleanHtml(`<img src=x style=${q}${long}${q} onerror=alert(1)>`), /onerror/i);
  assert.doesNotMatch(cleanHtml(`<img style="${long}" onclick="a" onerror="b">`), /on(click|error)/i);
  assert.doesNotMatch(cleanHtml("<scr<!-- -->ipt>alert(1)</script>"), /alert/);
  assert.doesNotMatch(cleanHtml("<ifr<!---->ame src=x></iframe>"), /<iframe/i);
  assert.doesNotMatch(cleanHtml("<img o<!---->nerror=alert(1)>"), /onerror/i);
  const img = `<p>hi</p><img src="data:image/png;base64,${"A".repeat(100_000)}"><p>bye</p>`;
  const s = sanitizeHtml(img, { images: true }).html;
  assert.doesNotMatch(s, /^[^<]*AAAA/);
  assert.match(mailText(img), /hi[\s\S]*bye/);
  assert.ok(!mailText(img).includes("AAAA"));
  assert.ok(cleanHtml("<p>" + "a".repeat(600_000)).length <= 500_000);
  assert.equal(cleanHtml("<p>a</p>".repeat(100_000)).endsWith(">"), true);
  assert.ok(redact("x".repeat(70) + ".password=hunter2hunter2").hits.length >= 1);
  assert.equal(safeUrl("{{u|https://northwind.example/" + "a".repeat(800) + "}}").startsWith("{{u|"), true);
  const readme =
    "[![ci](https://x.example/b.svg)](https://x.example/ci) [![v](https://x.example/v.svg)](https://x.example/v)\n\nA small agent that files the weekly report for a team.";
  assert.equal(
    summaryOf({ "README.md": readme }, "fallback"),
    "A small agent that files the weekly report for a team.",
  );
  fast("<link N closed", () => cleanHtml("<link ".repeat(20_000) + "</link>"));
  fast("<link N", () => cleanHtml("<link ".repeat(80_000)));
});

test("the safe output of the HTML guards is unchanged on fixed hostile samples", () => {
  for (const [input, clean, text, safe, mail] of SAMPLES) {
    assert.equal(cleanHtml(input!), clean, `cleanHtml ${input}`);
    assert.equal(htmlToText(input!), text, `htmlToText ${input}`);
    assert.equal(sanitizeHtml(input!).html, safe, `sanitizeHtml ${input}`);
    assert.equal(mailText(input!), mail, `mail htmlToText ${input}`);
  }
  fast("<a quote N then >", () => htmlToText('<a "'.repeat(N / 4) + ">"));
  fast("<a href=' N then >", () => htmlToText("<a href='".repeat(N / 9) + ">"));
});

test("a > inside a quoted value does not hide an event handler (stripEventAttrs, rc.39 left these in)", () => {
  const bad = [
    `<a title='>' onclick=alert(1)>k</a>`,
    `<img title=">" onerror="alert(1)" src=x>`,
    `<a title="a>b" data-x='c>d' onmouseover=alert(1)>k</a>`,
    `<img src=x title='>' onerror='alert(">")'>`,
    `<img/onerror=alert(1) src=x>`,
    `<a ${"x ".repeat(5000)}title=">" onclick=alert(1)>k</a>`,
  ];
  for (const h of bad) assert.doesNotMatch(cleanHtml(h), /on(click|error|mouseover)\s*=/i, h);
  assert.equal(cleanHtml(`<a title='>' onclick=alert(1) href=x>k</a>`), `<a title='>' href=x>k</a>`);
  assert.equal(cleanHtml(`<p title="o'k" class=a>t</p>`), `<p title="o'k" class=a>t</p>`);
  assert.equal(cleanHtml(`<input title='>' name=a>x`), "x");
  assert.equal(cleanHtml(`<a title="a>b">k</a> on=1 onclick=2`), `<a title="a>b">k</a> on=1 onclick=2`);
  assert.equal(cleanHtml(`<script>var a = "<b onclick=x>";</script>t`), "t");
  fast("<a title=' N", () => cleanHtml(`<a title='`.repeat(N / 10)));
  fast('<a x=" N then >', () => cleanHtml('<a x="'.repeat(N / 6) + ">"));
  fast("<a x='> N", () => cleanHtml(`<a x='>`.repeat(N / 7)));
  fast("<a onx=' N", () => cleanHtml(`<a onx='>' `.repeat(N / 11)));
  fast("many attrs", () => cleanHtml("<a " + 'a="1" '.repeat(N / 6) + ">"));
  fast("<a  N tags", () => htmlToText(`<a href="x" title='>'>`.repeat(N / 22)));
});

test("cutBlocks and quotes: nested same-name tags, a refused open before a real one, an unclosed quote", () => {
  assert.equal(cleanHtml("<form><form>x</form>y</form>z"), "y</form>z");
  assert.equal(cleanHtml('<link href=a><link rel="import" href=b></link>t'), "<link href=a>t");
  assert.equal(cleanHtml('<link rel="import" href=b>x</link><script>alert(1)</script>'), "");
  // an open quote runs to the end of the text in a browser, so the handler after it is text, not an attribute
  assert.equal(cleanHtml(`<a title="unclosed onclick=alert(1)>k</a>`), `<a title="unclosed onclick=alert(1)>k</a>`);
  assert.ok(redact("k".repeat(300) + "_password=hunter2hunter2").hits.length >= 1);
  assert.ok(redact('{"my.password": "hunter2hunter2"}').hits.length >= 1);
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
