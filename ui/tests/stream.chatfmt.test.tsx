// Rich chat formatting (lane l-chatfmt): underline and highlight marks, sections that open on a press and stay as left, choices that send a reply, task boxes a person can tick.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlocks, createIncrementalMarkdown, parseInline } from "../src/stream/index.ts";
import { forgetPressed, forgetSections } from "../src/stream/Blocks.tsx";
import type { Block, Inline } from "../src/stream/index.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const parse = (md: string): Block[] => { const p = createIncrementalMarkdown(); p.append(md); p.finish(); return [...p.view().blocks]; };
const draw = (md: string, props: { scope?: string; onChoose?: (t: string) => void } = {}): string => clean(renderToStaticMarkup(<MarkdownBlocks blocks={parse(md)} {...props} />));
const tags = (inl: Inline[]): string[] => inl.map((n) => (n.t === "html" ? n.tag : n.t));

test("++underline++, ==highlight== and <u> are marks; bold, italic and strike keep working beside them", () => {
  const inl = parseInline("A ++clear++ word, a ==key== one, <u>this</u>, **bold**, *italic*, ~~gone~~.");
  assert.deepEqual(tags(inl).filter((t) => t !== "text"), ["u", "mark", "u", "strong", "em", "del"]);
  const nested = parseInline("==a **bold** mark==");
  assert.equal(nested[0]?.t === "html" && nested[0].c.some((n) => n.t === "strong"), true);
});

test("C++, a == b and x==y stay as written; an unfinished mark is text", () => {
  for (const s of ["I like C++ and C++ more", "if a == b then", "x==y and z==w", "half ==done", "half ++done"]) {
    const inl = parseInline(s);
    assert.ok(inl.every((n) => n.t === "text"), s);
    assert.equal(inl.map((n) => (n.t === "text" ? n.v : "")).join(""), s);
  }
  assert.equal(parseInline("\\==not a mark== here").some((n) => n.t === "html"), false);
});

test("the marks draw as underline and highlight", () => {
  const html = draw("A ++clear++ and ==key== word.");
  assert.match(html, /r-textDecorationLine-\w+">clear</, "underlined");
  assert.match(html, /r-backgroundColor-\w+">key</, "highlighted");
});

test("> [!section] Title is a collapsible: closed shows the header only, [!section+] starts open, the body is blocks", () => {
  const md = "> [!section] Why it failed\n> The key had **expired**.\n> - rotate it\n> - retry\n\nAfter.\n";
  const b = parse(md);
  assert.deepEqual(b.map((x) => x.kind), ["details", "p"]);
  const d = b[0];
  assert.equal(d?.kind === "details" ? d.blocks.map((x) => x.kind).join(",") : "", "p,ul");
  const html = draw(md);
  assert.ok(html.includes("Why it failed") && !html.includes("expired"), "closed until pressed");
  assert.ok(draw("> [!section+] Open one\n> Body here.\n").includes("Body here."));
  assert.ok(parse("> [!NOTE] Still a note\n> text\n")[0]?.kind === "callout", "callouts are unchanged");
});

test("a section opened by a person is remembered for its message, and another message is untouched", () => {
  forgetSections();
  const md = "> [!section] More\n> Hidden body.\n";
  assert.ok(!draw(md, { scope: "m1" }).includes("Hidden body."));
  assert.ok(!draw(md).includes("Hidden body."));
});

test("```choices is a row of options; a press sends the words; with no way to send they are plain", () => {
  const md = "Which one?\n\n```choices\n- Ship it now\n- Wait for review\n3. Ask Dana\n```\n";
  const b = parse(md);
  assert.deepEqual(b.map((x) => x.kind), ["p", "choices"]);
  assert.deepEqual(b[1]?.kind === "choices" ? b[1].options : [], ["Ship it now", "Wait for review", "Ask Dana"]);
  forgetPressed();
  const live = draw(md, { scope: "m2", onChoose: () => undefined });
  assert.ok(live.includes("Ship it now") && live.includes("Ask Dana"));
  assert.ok(!/aria-disabled="true"[^>]*data-testid="choice-/.test(live), "pressable when it can send");
  const plain = draw(md);
  assert.ok(plain.includes("Wait for review") && plain.includes('aria-disabled="true"'), "a preview cannot send");
  assert.equal(parse("```choices\n\n```\n")[0]?.kind, "code", "an empty block is shown as it was written");
});

test("task boxes: pressable inside a message, plain in a preview", () => {
  const md = "- [x] done\n- [ ] open\n";
  const live = draw(md, { scope: "m3" });
  assert.match(live, /r-cursor-\w+[^>]*data-testid="check-b0-1"/, "a box in a message takes a press");
  assert.doesNotMatch(draw(md), /r-cursor-\w+[^>]*data-testid="check-b0-1"/, "a preview box does not");
});
