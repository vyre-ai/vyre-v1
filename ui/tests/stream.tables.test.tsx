// Chat replies render Markdown tables and the rest of the Markdown a model writes: tables (scrolling sideways inside the message, never the page), headings, lists, checklists, code blocks with copy, inline code, links, quotes and dividers.
// A reply that is still being written stays smooth: a table is text until its header row and separator row are complete, a half-written last row waits for its closing pipe, and what was final does not change.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlocks, createIncrementalMarkdown, parseChunk } from "../src/stream/index.ts";
import { cells, isSeparator } from "../src/stream/markdown.ts";
import { markdownToDoc } from "../src/RichEditor/mdtree.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const draw = (md: string): string => { const p = createIncrementalMarkdown(); p.append(md); p.finish(); return clean(renderToStaticMarkup(<MarkdownBlocks blocks={p.view().blocks} />)); };
const TABLE = "| Step | Owner | Due |\n|---|:---:|---:|\n| Draft the brief | Dex | Fri |\n| Send to Sara | Mira | Mon |\n";

test("a table is a table: the header, the aligned columns and every row, not raw pipes", () => {
  const [b] = parseChunk(TABLE, 0);
  assert.equal(b?.kind, "table");
  if (b?.kind !== "table") return;
  assert.equal(b.head.length, 3);
  assert.deepEqual(b.align, ["left", "center", "right"]);
  assert.equal(b.rows.length, 2);
  const html = draw(TABLE);
  assert.ok(html.includes("Draft the brief") && html.includes("Send to Sara") && html.includes("Owner"));
  assert.ok(!html.includes("|---|") && !html.includes("| Step |"), "no raw table lines");
  assert.ok(html.includes('data-testid="thead-b0"') && html.includes('data-testid="row-b0-1"'));
  assert.match(html, /text-align:\s*center|r-textAlign-1i0vl1u|textAlign/i, "alignment is applied");
});

test("a wide table scrolls sideways inside its own box", () => {
  const wide = `| ${Array.from({ length: 9 }, (_, i) => `Column ${i + 1}`).join(" | ")} |\n|${"---|".repeat(9)}\n| ${Array.from({ length: 9 }, (_, i) => `value ${i + 1}`).join(" | ")} |\n`;
  const html = draw(wide);
  assert.ok(html.includes('data-testid="table-scroll-b0"'), "its own scroll view");
  assert.match(html.slice(html.indexOf('data-testid="table-scroll-b0"') - 400, html.indexOf('data-testid="table-scroll-b0"') + 200), /overflow-x:\s*auto|r-overflowX-/i, "horizontal scroll, so the page does not widen");
});

test("cells: pipes inside code or escaped stay in the cell, missing cells are empty, inline marks work in a cell", () => {
  assert.deepEqual(cells("| a | `x|y` | c\\|d |"), ["a", "`x|y`", "c|d"]);
  const [b] = parseChunk("| A | B |\n|---|---|\n| only one |\n| **bold** | [link](https://e.com) |\n", 0);
  assert.equal(b?.kind, "table");
  if (b?.kind !== "table") return;
  assert.equal(b.rows[0]?.length, 2, "a short row is padded");
  assert.equal(b.rows[1]?.[0]?.[0]?.t, "strong");
  assert.equal(b.rows[1]?.[1]?.[0]?.t, "link");
});

test("a separator row is only one when it is complete", () => {
  assert.equal(isSeparator("|---|---|", 2), true);
  assert.equal(isSeparator("| :-- | --: |", 2), true);
  assert.equal(isSeparator("|---|--", 2), false, "still being written");
  assert.equal(isSeparator("|---|", 2), false, "wrong number of columns");
  assert.equal(isSeparator("| a | b |", 2), false);
});

test("streaming: a table is text until its header and separator rows are complete, then it is a table and stays one", () => {
  const p = createIncrementalMarkdown();
  const kinds: string[] = [];
  let sawTable = false;
  for (const ch of TABLE) {
    p.append(ch);
    const k = p.view().blocks.map((b) => b.kind).join(",");
    kinds.push(k);
    if (k.includes("table")) sawTable = true;
    else assert.ok(!sawTable, `the table does not turn back into text (at ${JSON.stringify(k)})`);
  }
  const firstTable = kinds.findIndex((k) => k.includes("table"));
  const sepAt = TABLE.indexOf("|---|:---:|---") + "|---|:---:|---".length - 1;
  assert.ok(firstTable >= sepAt, "no table before every column of the separator row is written");
  assert.ok(kinds.slice(0, firstTable).every((k) => k === "p" || k === ""), "until then it reads as text");
  p.finish();
  const done = p.view().blocks[0];
  assert.equal(done?.kind, "table");
  if (done?.kind === "table") assert.equal(done.rows.length, 2);
});

test("streaming: a half-written last row waits for its closing pipe, and finished blocks are the same objects as before", () => {
  const p = createIncrementalMarkdown();
  p.append("Intro paragraph.\n\n| A | B |\n|---|---|\n| one | two |\n| thr");
  const mid = p.view();
  const t = mid.blocks.find((b) => b.kind === "table");
  assert.equal(t?.kind === "table" ? t.rows.length : -1, 1, "the unfinished row is not shown yet");
  p.append("ee | four |\n");
  const next = p.view();
  const t2 = next.blocks.find((b) => b.kind === "table");
  assert.equal(t2?.kind === "table" ? t2.rows.length : -1, 2, "now it is a row");
  assert.equal(next.blocks[0], mid.blocks[0], "the paragraph that was final is the same object");
  p.append("\nAfter the table.\n");
  p.finish();
  assert.deepEqual(p.view().blocks.map((b) => b.kind), ["p", "table", "p"]);
});

test("a table agrees with the editor's Markdown reader about what a table is", () => {
  for (const [md, isTable] of [[TABLE, true], ["| not | a table |\nsome text\n", false], ["a | b\n---|---\n1 | 2\n", true], ["| A |\n|---|\n| 1 |\n", true]] as const) {
    const chat = parseChunk(md, 0).some((b) => b.kind === "table");
    const editor = (markdownToDoc(md).content ?? []).some((n) => n.type === "rawBlock" && n.attrs?.["kind"] === "table");
    assert.equal(chat, isTable, `chat: ${JSON.stringify(md)}`);
    assert.equal(editor, isTable, `editor: ${JSON.stringify(md)}`);
  }
});

test("headings, lists, checklists, quotes, dividers and inline code each draw", () => {
  const md = "# One\n\n## Two\n\n### Three\n\n- first\n- second\n\n1. step\n2. step\n\n- [x] done\n- [ ] open\n\n> quoted\n\n---\n\nSome `inline` code and a [link](https://example.com/a) and **strong** and *em*.\n";
  const html = draw(md);
  for (const w of ["One", "Two", "Three", "first", "second", "step", "done", "open", "quoted", "inline", "link", "strong", "em"]) assert.ok(html.includes(w), w);
  assert.ok(html.includes('role="heading"'), "headings");
  assert.ok(html.includes('aria-label="Done"') && html.includes('aria-label="Not done"') && html.includes("\u2713"), "a checklist draws boxes, ticked and open");
  assert.ok(!html.includes("[x]") && !html.includes("[ ]"), "no raw checkbox text");
  assert.ok(html.includes('href="https://example.com/a"') || html.includes('role="link"'), "a link");
  const blocks = createIncrementalMarkdown();
  blocks.append(md); blocks.finish();
  assert.deepEqual(blocks.view().blocks.map((b) => b.kind), ["h", "h", "h", "ul", "ol", "ul", "quote", "hr", "p"]);
  const list = blocks.view().blocks[5];
  assert.deepEqual(list?.kind === "ul" ? list.checks : null, [true, false]);
});

test("a finished code block has a Copy control, an open one does not", () => {
  const closed = draw("```ts\nconst a = 1;\n```\n");
  assert.ok(closed.includes('data-testid="copy-b0"') && closed.includes("Copy"), "copy on a finished block");
  const p = createIncrementalMarkdown();
  p.append("```ts\nconst a = 1;\n");
  const open = clean(renderToStaticMarkup(<MarkdownBlocks blocks={p.view().blocks} streaming />));
  assert.ok(!open.includes('data-testid="copy-b0"'), "none while it is still being written");
});
