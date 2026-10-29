import test from "node:test";
import assert from "node:assert/strict";
import { checkFormHtml, checkFormJs, generateFormHtml, HTML_MAX } from "../form-source.ts";

const ok = (html: string) => { const r = checkFormHtml(html); assert.equal(r.ok, true, JSON.stringify(r)); return r as Extract<ReturnType<typeof checkFormHtml>, { ok: true }>; };
const bad = (html: string, why: RegExp) => { const r = checkFormHtml(html); assert.equal(r.ok, false, `${html} should be refused`); assert.match((r as { reason: string }).reason, why); };

test("author markup and placed fields split into pieces; the fields placed are listed", () => {
  const r = ok('<h1 class="big">Welcome</h1>\n<p>Tell us <strong>about</strong> you. <a href="https://example.com/privacy" target="_blank">Privacy</a></p>\n<vyre-field name="email"></vyre-field>\n<div class="note"><vyre-field name="full_name"/></div>\n<img src="https://example.com/a.png" alt="" width="40">');
  assert.deepEqual(r.fields, ["email", "full_name"]);
  assert.deepEqual(r.pieces.map((p) => p.type), ["html", "field", "html", "field", "html"]);
  assert.equal(r.pieces.filter((p) => p.type === "html").map((p) => (p as { html: string }).html).join("").includes("<vyre-field"), false, "markers are not left in the markup");
});

test("everything that could run script or reach outside the form is refused with where and why", () => {
  bad("<script>alert(1)</script>", /<script> is not allowed.*JavaScript source/);
  bad('<p onclick="x()">a</p>', /onclick/);
  bad('<a href="javascript:alert(1)">x</a>', /href must be/);
  bad('<a href="JaVaScRiPt:alert(1)">x</a>', /href must be/);
  bad('<a href="&#106;avascript:alert(1)">x</a>', /href must be/);
  bad('<a href="data:text/html,x">x</a>', /href must be/);
  bad('<img src="http://example.com/a.png">', /src must be an https/);
  bad('<img src="//example.com/a.png">', /src must be an https/);
  bad('<iframe src="https://x.test"></iframe>', /<iframe> is not allowed/);
  bad('<input name="x">', /<input> is not allowed.*<vyre-field>/);
  bad("<form></form>", /<form> is not allowed/);
  bad("<style>p{}</style>", /<style> is not allowed/);
  bad('<p style="color:red">x</p>', /<p style> is not allowed/);
  bad('<p id="vf-form">x</p>', /<p id> is not allowed/);
  bad("<!-- hi --><p>x</p>", /comments/);
  bad("<p>x</p><!DOCTYPE html>", /comments/);
  bad('<a href="https://x.test" target="top">x</a>', /_blank/);
  bad("<svg onload=alert(1)>", /not a tag the form allows|not allowed/);
  bad("<p<script>>x</p>", /not a tag/);
  bad("<P>x</P>", /not a tag/);
});

test("markup must be balanced and bounded", () => {
  bad("<p>x", /never closed/);
  bad("<p>x</div>", /does not match/);
  bad("</p>", /not an allowed closing tag|does not match/);
  bad("<div><p>x</div></p>", /does not match/);
  bad("<br></br>", /not an allowed closing tag/);
  bad("<p/>", /must be written/);
  bad("<div>".repeat(30) + "</div>".repeat(30), /nested too deeply/);
  bad("<p>x</p>".repeat(2100), /too many tags/);
  bad("a".repeat(HTML_MAX + 1), /too large/);
});

test("a field marker takes exactly a valid name, once", () => {
  bad('<vyre-field name="Email"></vyre-field>', /exactly one attribute/);
  bad('<vyre-field name="a" class="b"></vyre-field>', /exactly one attribute/);
  bad('<vyre-field></vyre-field>', /exactly one attribute/);
  bad('<vyre-field name="a"></vyre-field><vyre-field name="a"></vyre-field>', /placed twice/);
  bad('<vyre-field name="a"><p>x</p></vyre-field>', /no content/);
  bad('<vyre-field name="a">', /no content/);
  bad('</vyre-field>', /no matching opening/);
});

test("the JavaScript source is bounded and cannot close its own script tag", () => {
  assert.equal(checkFormJs("document.title = 'x';").ok, true);
  for (const js of ["a</script><script>b", "x </SCRIPT >", "<!-- hi", "a".repeat(70_000), "a\u0000b"]) assert.equal(checkFormJs(js).ok, false, js.slice(0, 20));
});

test("the generated starting template places every question in order and passes its own check", () => {
  const html = generateFormHtml([{ key: "email", title: "Email" }, { key: "full_name", title: "Name" }]);
  assert.equal(html, '<vyre-field name="email"></vyre-field>\n<vyre-field name="full_name"></vyre-field>\n');
  assert.deepEqual(ok(html).fields, ["email", "full_name"]);
  assert.equal(generateFormHtml([]), "");
});
