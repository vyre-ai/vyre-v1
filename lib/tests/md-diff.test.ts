import test from "node:test";
import assert from "node:assert/strict";
import { frontmatter, headings, links, toPlain, excerpt, escapeMd, slug } from "../md.ts";
import { diffLines, diffWords, diffStats, sideOf } from "../diff.ts";

test("frontmatter: flat keys split from the body; anything else stays in the body", () => {
  assert.deepEqual(frontmatter("---\ntitle: \"Plan\"\nowner: dana\n---\n# Hi\n"), { data: { title: "Plan", owner: "dana" }, body: "# Hi\n" });
  assert.deepEqual(frontmatter("# no block"), { data: {}, body: "# no block" });
  const nested = "---\na:\n  - b\n---\nbody";
  assert.deepEqual(frontmatter(nested), { data: {}, body: nested });
});

test("headings: levels and 1-based lines, fenced code skipped", () => {
  const md = "# One\ntext\n```\n# not a heading\n```\n## Two ##\n####### seven";
  assert.deepEqual(headings(md), [{ level: 1, text: "One", line: 1 }, { level: 2, text: "Two", line: 6 }]);
});

test("links: wiki links with labels and plain urls, images excluded", () => {
  const l = links("See [[Intake plan|plan]] and [[Docs]] or [site](https://x.test/a) ![img](p.png)");
  assert.deepEqual(l.wiki, ["Intake plan", "Docs"]);
  assert.deepEqual(l.urls, ["https://x.test/a"]);
});

test("toPlain and excerpt", () => {
  assert.equal(toPlain("# Title\n\n**bold** and _it_ with `code` and [a link](u) and [[Wiki|shown]]\n- [ ] item"), "Title\n\nbold and it with code and a link and shown\nitem");
  assert.equal(excerpt("short"), "short");
  const long = excerpt("word ".repeat(100), 40);
  assert.ok(long.length <= 40 && long.endsWith("…"), long);
});

test("escapeMd and slug", () => {
  assert.equal(escapeMd("a*b_c"), "a\\*b\\_c");
  assert.equal(slug("  Café Menu: 2026!  "), "cafe-menu-2026");
});

test("diffLines: eq/add/del and both sides rebuild exactly", () => {
  const a = "one\ntwo\nthree\nfour", b = "one\n2\nthree\nfour\nfive";
  const ops = diffLines(a, b);
  assert.equal(sideOf(ops, "a"), a);
  assert.equal(sideOf(ops, "b"), b);
  assert.deepEqual(diffStats(ops), { added: 2, removed: 1, unchanged: 3 });
  assert.deepEqual(diffLines("same", "same"), [{ op: "eq", text: "same" }]);
  assert.deepEqual(diffLines("", "x"), [{ op: "add", text: "x" }]);
});

test("diffWords keeps whitespace so each side restores", () => {
  const ops = diffWords("the quick  fox", "the slow  fox jumps");
  assert.equal(sideOf(ops, "a", ""), "the quick  fox");
  assert.equal(sideOf(ops, "b", ""), "the slow  fox jumps");
});

test("diffLines on large unrelated inputs falls back to one replaced block and still restores both sides", () => {
  const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join("\n"), b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join("\n");
  const ops = diffLines(a, b);
  assert.equal(sideOf(ops, "a"), a);
  assert.equal(sideOf(ops, "b"), b);
});
