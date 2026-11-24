// rc.40: no regex in shipped code takes more than linear time on hostile input. Each case runs the code on about 100 KB of the worst
// shape the reviewer found (they took 2.6 to 16 s before) and must finish well inside 100 ms; the first lines of each group keep the
// ordinary outputs the code gave before.
import test from "node:test";
import { timeCpu, wallCeiling } from "./support/cpu-time.ts";
import assert from "node:assert/strict";
import {
  isScriptUrl,
  lc,
  neutralizeCssUrls,
  neutralizeUrlAttrs,
  replaceAnchors,
  stripEventAttrs,
  capText,
  isPipeRow,
  isPipeRule,
  replaceTokens,
  scanTag,
  stripTags,
  tagsNamed,
} from "../lib/html-text.ts";
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
  // One run, measured in CPU time (test/support/cpu-time.ts): a busy runner can stretch the wall clock of a 30 ms case to 400 ms, but it cannot
  // make linear code use more CPU, and quadratic code on this input uses seconds of it. The bound stays 100 ms; the wall ceiling is a hang guard.
  const { out, cpuMs, wallMs } = timeCpu(fn);
  assert.ok(
    cpuMs < BUDGET_MS,
    `${label} used ${Math.round(cpuMs)} ms of CPU on hostile input (budget ${BUDGET_MS} ms)`,
  );
  assert.ok(
    wallMs < wallCeiling(BUDGET_MS),
    `${label} took ${Math.round(wallMs)} ms of wall time (hang guard ${wallCeiling(BUDGET_MS)} ms)`,
  );
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
    `<svg/onload=x>`,
    `<a title=">" onclick=x>k</a>`,
    `<img/onerror=x>`,
    `<a ${"x ".repeat(5000)}title=">" onclick=alert(1)>k</a>`,
  ];
  for (const h of bad) assert.doesNotMatch(cleanHtml(h), /on(click|error|mouseover|load)\s*=/i, h);
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
  // an open quote runs to the end of the text in a browser: the tag is dropped, never kept with its open quote
  assert.equal(cleanHtml(`<a title="unclosed onclick=alert(1)>k</a>`), "");
  assert.ok(redact("k".repeat(300) + "_password=hunter2hunter2").hits.length >= 1);
  assert.ok(redact('{"my.password": "hunter2hunter2"}').hits.length >= 1);
});

test("expanding characters before a blocked tag cannot shift the scan past it (ASCII-only lowercase)", () => {
  assert.equal(lc("AbC\u0130"), "abc\u0130");
  for (const pad of ["\u0130", "\u1e9e", "\u212a", "\u0130\u212a\u1e9e"]) {
    const p = pad.repeat(40);
    for (const bad of [
      "<script>alert(1)</script>",
      "<form action=x></form>",
      "<iframe src=x></iframe>",
      "<object data=x></object>",
      "<embed src=x>",
      "<base href=x>",
      "<input name=a>",
      '<meta http-equiv="refresh" content="0;url=x">',
      '<link rel="import" href=x></link>',
    ]) {
      const out = cleanHtml(p + bad);
      assert.equal(out, p, bad);
    }
    assert.equal(
      htmlToText(p + '<a href="https://northwind.example">go</a>').endsWith("go (https://northwind.example)"),
      true,
    );
    assert.deepEqual(tagsNamed(p + "<meta a=1>", "meta"), ["<meta a=1>"]);
    assert.equal(
      replaceAnchors(
        p + '<a href="x">k</a>',
        () => true,
        (_t, label) => `[${label}]`,
      ),
      p + "[k]",
    );
    assert.equal(
      pageMeta(p + '<meta property="og:title" content="Hello"><title>T</title>', new URL("https://northwind.example/"))
        .title,
      "Hello",
    );
    assert.equal(stripEventAttrs(p + "<img onerror=x>"), p + "<img>");
  }
});

test("raw-text elements, comments and unterminated tags are read as a browser reads them (stripEventAttrs)", () => {
  const live = /onerror\s*=/i;
  for (const html of [
    '<style><a b="</style><img src=x onerror=alert(1)>',
    '<textarea><a b="</textarea><img src=x onerror=alert(1)>',
    '<title><a b="</title><img src=x onerror=alert(1)>',
    '<noscript><a b="</noscript><img src=x onerror=alert(1)>',
    '<xmp><a b="</xmp><img src=x onerror=alert(1)>',
    '<STYLE><a b="</STYLE ><img src=x onerror=alert(1)>',
    '<!-- <a title="--> <img src=x onerror=alert(1)> "-->',
    "<!-- x --!> <img src=x onerror=alert(1)>",
    "<!--> <img src=x onerror=alert(1)>",
    "<svg><style><img src=x onerror=alert(1)></style></svg>",
    '<style></style><a b="x><img src=x onerror=alert(1)>',
  ]) {
    assert.doesNotMatch(stripEventAttrs(html), live, html);
    assert.doesNotMatch(cleanHtml(html), live, html);
  }
  // text inside a raw-text element or a comment is kept as it was
  assert.equal(
    stripEventAttrs('<style>a[href="x"]{color:red}</style><p>t</p>'),
    '<style>a[href="x"]{color:red}</style><p>t</p>',
  );
  // a handler written inside a comment is removed too (the second reading does not know about comments); the comment's words stay
  assert.equal(stripEventAttrs("<!-- <b onclick=x> --><p>t</p>"), "<!-- <b> --><p>t</p>");
  // an unterminated tag is dropped with the rest, never kept with its open quote
  assert.equal(cleanHtml('<p>a</p><a title="open'), "<p>a</p>");
  assert.equal(cleanHtml("<p>a</p><img src='x onerror=y>more"), "<p>a</p>");
  assert.equal(stripEventAttrs("<p>a</p>"), "<p>a</p>");
  fast('<style><a b=" N', () => stripEventAttrs('<style><a b="'.repeat(N / 13)));
  fast("<!-- N", () => stripEventAttrs("<!--".repeat(N / 4)));
  for (const c of ["<!--!>", "<!--a--!>", "<!----!>", "<!-- -->", "<!--!><!--", "<!--a-->"]) {
    fast(`${c} x 500 KB`, () => cleanHtml(c.repeat(500_000 / c.length)));
    fast(`${c} x 1 MB`, () => stripEventAttrs(c.repeat(1_000_000 / c.length)));
  }
  fast("<textarea N", () => stripEventAttrs("<textarea>".repeat(N / 10)));
  fast("<title <a N", () => stripEventAttrs('<title><a b="</title>'.repeat(N / 22)));
});

test("only HTML whitespace separates a tag's parts (space, tab, LF, FF, CR)", () => {
  for (const ws of ["\u00a0", "\u000b", "\ufeff", "\u2028", "\u2029"]) {
    const html = `<a href=x${ws}y="><img src=x onerror=alert(1)>">`;
    assert.doesNotMatch(cleanHtml(html), /onerror\s*=/i, JSON.stringify(ws));
  }
  assert.equal(cleanHtml("<img\tsrc=x\nonerror=1\fonclick=2\ralt=a>"), "<img\tsrc=x\ralt=a>");
});

test("script URLs are neutralised however the scheme is spelled, quoted or not (cleanHtml)", () => {
  const spellings = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\r\nscr\tipt:alert(1)",
    "\u0001 javascript:alert(1)",
    "  javascript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;&#x61;vascript&colon;alert(1)",
    "java&Tab;script:alert(1)",
    "java&#9;script:alert(1)",
    "java&#x0A;script:alert(1)",
    "&#000000106;avascript:alert(1)",
    "&#00000106;avascript:alert(1)",
    "&#x0000006A;avascript:alert(1)",
    "jav&#0000000097;script:alert(1)",
    "javascript&#00000000058;alert(1)",
    "java&#0000000009;script:alert(1)",
    "&#x00000000000000000006a;avascript:alert(1)",
    "javascript&#58;alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
  ];
  for (const v of spellings) {
    assert.equal(isScriptUrl(v), true, JSON.stringify(v));
    const safe = v.replace(/"/g, "&quot;");
    // quoted both ways, unquoted (a value cannot hold a space, so only the spellings without one), and other URL attributes
    assert.equal(cleanHtml(`<a href="${safe}">x</a>`), '<a href="#">x</a>', v);
    assert.equal(cleanHtml(`<a href='${v.replace(/'/g, "&#39;")}'>x</a>`), "<a href='#'>x</a>", v);
    // unquoted: a space, tab or newline would end the value in a browser, so only the spellings without one
    if (!/[\s"'<>=`]/.test(v)) assert.equal(cleanHtml(`<a href=${v}>x</a>`), '<a href="#">x</a>', v);
    assert.equal(cleanHtml(`<iframe-less src="${safe}">`.replace("iframe-less", "img")), '<img src="#">', v);
    assert.equal(cleanHtml(`<form action="${safe}"></form>`), "", v);
  }
  assert.equal(cleanHtml("<a href=javascript:alert(1)>x</a>"), '<a href="#">x</a>');
  assert.equal(cleanHtml("<a href=java&Tab;script:alert(1)>x</a>"), '<a href="#">x</a>');
  assert.equal(
    cleanHtml('<svg><a xlink:href="java\tscript:alert(1)">x</a></svg>'),
    '<svg><a xlink:href="#">x</a></svg>',
  );
  // ordinary links and data images are left alone
  for (const ok of [
    "https://northwind.example/a?b=1&amp;c=2",
    "mailto:imran@northwind.example",
    "/relative",
    "#top",
    "tel:+15550100",
    "data:image/png;base64,iVBORw0=",
    "{{unsubscribe_url}}",
  ])
    assert.equal(cleanHtml(`<a href="${ok}">x</a>`), `<a href="${ok}">x</a>`, ok);
  assert.equal(neutralizeUrlAttrs('<p title="javascript:x">t</p>'), '<p title="javascript:x">t</p>');
  fast("href=javascript N", () => cleanHtml('<a href="javascript:x">'.repeat(N / 24)));
  fast("href=java&#9; N", () => cleanHtml("<a href=java&#9;script:x>".repeat(N / 25)));
  fast("1 MB of zeros in a reference", () => cleanHtml(`<a href="&#${"0".repeat(1_000_000)}106;avascript:x">`));
  fast("long value", () => cleanHtml('<a href="' + "java&Tab;".repeat(N / 9) + '">'));
});

test("script URLs in CSS are neutralised the way a browser reads them (cleanHtml, neutralizeCssUrls)", () => {
  for (const css of [
    "background:url(javascript:alert(1))",
    "background:url( 'javascript:alert(1)' )",
    'background:url("java\tscript:alert(1)")',
    "background:url(\\6a avascript:alert(1))",
    "background:url(&#106;avascript:alert(1))",
    "background:URL(vbscript:x)",
    "background:url(data:text/html,<b>)",
  ])
    assert.equal(cleanHtml(`<p style="${css.replace(/"/g, "&quot;")}">x</p>`).includes("alert"), false, css);
  assert.equal(neutralizeCssUrls("a{background:url(javascript:x)}b{c:d}"), "a{background:none}b{c:d}");
  assert.equal(neutralizeCssUrls("@import 'javascript:x';p{c:d}"), '@import "#";p{c:d}');
  assert.equal(neutralizeCssUrls('@import url("java\tscript:x");p{c:d}'), '@import "#";p{c:d}');
  assert.equal(neutralizeCssUrls("@import url(\\6a avascript:x);p{c:d}"), '@import "#";p{c:d}');
  assert.equal(neutralizeCssUrls('@IMPORT "JavaScript:x";'), '@import "#";');
  assert.equal(
    cleanHtml("<style>@import 'javascript:alert(1)';p{color:red}</style>"),
    '<style>@import "#";p{color:red}</style>',
  );
  // ordinary rules are left alone
  for (const ok of [
    "a{background:url(https://northwind.example/a.png)}",
    "@import 'https://northwind.example/a.css';",
    "a{background:url(data:image/png;base64,iVBORw0=)}",
    "p{color:red}",
  ])
    assert.equal(neutralizeCssUrls(ok), ok, ok);
  fast("url( N", () => neutralizeCssUrls("url(".repeat(N / 4)));
  fast("url(javascript: N", () => neutralizeCssUrls("url(javascript:x".repeat(N / 16)));
  fast("@import N", () => neutralizeCssUrls("@import 'javascript:x' ".repeat(N / 22)));
  fast("@import url( N", () => neutralizeCssUrls("@import url(".repeat(N / 12)));
});

test("a style rewrite cannot break out of its attribute (both quote kinds, entity quotes)", () => {
  for (const q of ["&apos;", "&#39;", "&#x27;", "&#0000039;"]) {
    const single = `<img src=x style='background:url(javascript:x);font-family:${q} onerror=alert(1) x=${q}'>`;
    const double = `<img src=x style="background:url(javascript:x);font-family:&quot; onerror=alert(1) x=&quot;">`;
    const bare = `<img src=x style=background:url(javascript:x);font-family:${q}>`;
    for (const html of [single, double, bare]) {
      const out = cleanHtml(html);
      // read as a browser reads it: the tag carries only src and style, and the handler text stays inside the style value
      assert.deepEqual(
        scanTag(out, 0).attrs.map((a) => a.name),
        ["src", "style"],
        html,
      );
      assert.doesNotMatch(out, /javascript/i, html);
      assert.equal(stripEventAttrs(out), out, html);
    }
  }
  assert.equal(cleanHtml(`<p style='background:url(javascript:x)'>t</p>`), `<p style='background:none'>t</p>`);
  assert.equal(cleanHtml(`<p style="font-family:'Segoe UI'">t</p>`), `<p style="font-family:'Segoe UI'">t</p>`);
});

test("r-review-41's original style breakout string stays closed", () => {
  for (const q of ["&#39;", "&apos;", "&#x27;"]) {
    const out = cleanHtml(
      `<div style='color:red;background:url(javascript:1);${q} onmouseover=alert(1) x=${q}'>hi</div>`,
    );
    assert.deepEqual(
      scanTag(out, 0).attrs.map((a) => a.name),
      ["style"],
      out,
    );
    assert.match(out, />hi<\/div>$/);
  }
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
