// Every format a model reply may use, one test each: GFM (strikethrough, autolinks, footnotes, task lists), math, callouts, collapsibles, images, safe HTML, code with colour and controls, diagrams with a
// fallback to the source, charts (five kinds, a table view, Copy CSV), and the whole "every format" message in both skins. Streaming must not flicker: a block that is final stays the same object.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlocks, chartGeometry, chartTable, createIncrementalMarkdown, hasDiagramLoader, highlight, parseChartSpec, parseInline, renderDiagram, renderMath, setDiagramLoader, setMathLoader } from "../src/stream/index.ts";
import type { Block } from "../src/stream/index.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const parse = (md: string): Block[] => { const p = createIncrementalMarkdown(); p.append(md); p.finish(); return [...p.view().blocks]; };
const draw = (md: string, streaming = false): string => { const p = createIncrementalMarkdown(); p.append(md); if (!streaming) p.finish(); return clean(renderToStaticMarkup(<MarkdownBlocks blocks={p.view().blocks} streaming={streaming} />)); };

test("strikethrough, autolinks and footnotes", () => {
  const inl = parseInline("A ~~gone~~ word, <https://a.example/x>, bare https://b.example/y, and a note[^1].");
  assert.ok(inl.some((n) => n.t === "del"), "strikethrough");
  const links = inl.filter((n) => n.t === "link").map((n) => (n.t === "link" ? n.href : ""));
  assert.deepEqual(links, ["https://a.example/x", "https://b.example/y"], "angle and bare autolinks, no trailing punctuation");
  assert.ok(inl.some((n) => n.t === "fnref" && n.id === "1"), "a footnote reference");
  const blocks = parse("Text[^1].\n\n[^1]: The source of the number.\n");
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "fn"]);
  const html = draw("Text[^1].\n\n[^1]: The source of the number.\n");
  assert.ok(html.includes("The source of the number.") && html.includes('data-testid="fnref-1"'));
});

test("a markdown link keeps its own text, an unfinished one stays text", () => {
  assert.equal(parseInline("[docs](https://example.com/docs)")[0]?.t, "link");
  assert.ok(!parseInline("[docs](https://exa").some((n) => n.t === "link"));
});

test("math: inline between single dollars, display between double; a price is not math", () => {
  const inl = parseInline("The area is $\\pi r^2$ and costs $5 or $6.");
  assert.deepEqual(inl.filter((n) => n.t === "math").map((n) => (n.t === "math" ? n.v : "")), ["\\pi r^2"]);
  const blocks = parse("$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n\nand one line:\n\n$$a^2 + b^2 = c^2$$\n");
  assert.deepEqual(blocks.map((b) => b.kind), ["math", "p", "math"]);
  const html = draw("$$a^2 + b^2 = c^2$$");
  assert.ok(html.includes("a^2 + b^2 = c^2") && html.includes("Formula:"), "the formula as written until a math renderer is in");
});

test("math is drawn by the loader once registered, and a loader that fails leaves the formula with a note", async () => {
  setMathLoader(async () => async (tex, display) => `<span class="katex">${display ? "D" : "I"}:${tex}</span>`);
  assert.equal(await renderMath("x^2", false), '<span class="katex">I:x^2</span>');
  assert.equal(await renderMath("x^2", true), '<span class="katex">D:x^2</span>');
  setMathLoader(async () => async () => { throw new Error("bad tex"); });
  await assert.rejects(renderMath("\\bad{", false), /bad tex/);
  setMathLoader(null);
  await assert.rejects(renderMath("x", false), /not switched on/);
});

test("callouts: note, tip, important, warning and caution, with their words", () => {
  const blocks = parse("> [!NOTE]\n> Files over 2 GB are refused.\n\n> [!TIP] Try this\n> Use `/preview`.\n\n> [!WARNING]\n> Changing the limit does not move files.\n\n> a plain quote\n");
  assert.deepEqual(blocks.map((b) => b.kind), ["callout", "callout", "callout", "quote"]);
  const c = blocks[1];
  assert.equal(c?.kind === "callout" ? c.title : "", "Try this");
  const html = draw("> [!WARNING]\n> Careful.\n");
  assert.ok(html.includes("Warning") && html.includes("Careful.") && html.includes('data-callout="warning"'));
});

test("<details> is a collapsible with its own blocks, and it holds together across blank lines while it streams", () => {
  const md = "<details>\n<summary>How the numbers were measured</summary>\n\nSol uploaded 40 files.\n\n- from 1 MB\n- to 2 GB\n\n</details>\n\nAfter.\n";
  const blocks = parse(md);
  assert.deepEqual(blocks.map((b) => b.kind), ["details", "p"]);
  const d = blocks[0];
  assert.equal(d?.kind === "details" ? d.blocks.map((b) => b.kind).join(",") : "", "p,ul");
  const p = createIncrementalMarkdown();
  p.append("<details>\n<summary>More</summary>\n\nInside");
  assert.equal(p.view().blocks.length, 1, "one open block while it is unfinished");
  const html = draw(md);
  assert.ok(html.includes("How the numbers were measured") && !html.includes("Sol uploaded 40 files."), "closed until opened");
  assert.ok(draw("<details open>\n<summary>S</summary>\n\nBody text.\n\n</details>\n").includes("Body text."), "open when it says open");
});

test("an image alone on a line is an image that enlarges; unsafe sources are text", () => {
  const b = parse("![The portal](https://example.com/p.png)\n");
  assert.equal(b[0]?.kind, "img");
  assert.ok(draw("![The portal](https://example.com/p.png)\n").includes('data-testid="img-b0"'));
  assert.equal(parse("![x](javascript:alert(1))\n")[0]?.kind, "p", "a script address is never an image");
  assert.equal(parse("![x](data:image/png;base64,AAAA)\n")[0]?.kind, "img");
});

test("safe HTML: br, kbd, sub, sup, mark draw; script and style vanish; other tags lose the tag and keep the words", () => {
  const inl = parseInline("a<br>b <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup> <mark>hot</mark>");
  assert.deepEqual(inl.filter((n) => n.t === "html").map((n) => (n.t === "html" ? n.tag : "")), ["kbd", "sub", "sup", "mark"]);
  assert.ok(inl.some((n) => n.t === "br"));
  const dirty = parseInline('Hello <script>alert(1)</script>world <img src=x onerror=alert(1)> <b onclick="x()">bold</b> <style>body{display:none}</style>end');
  const text = dirty.map((n) => (n.t === "text" ? n.v : "")).join("");
  assert.ok(!text.includes("alert") && !text.includes("onerror") && !text.includes("onclick") && !text.includes("display"), "no script, no handler, no style");
  assert.ok(text.includes("Hello ") && text.includes("world") && text.includes("bold") && text.includes("end"));
});

test("code: colour that never changes a character, the language label, Copy and Wrap", () => {
  const code = "// note\nconst a = 'x' + 12;\nfunction go(n: number) { return a; }";
  const toks = highlight("ts", code);
  assert.equal(toks.map((t) => t.v).join(""), code, "the tokens are exactly the code");
  const kinds = new Set(toks.map((t) => t.k));
  for (const k of ["cm", "kw", "str", "num", "fn"] as const) assert.ok(kinds.has(k), k);
  assert.deepEqual(highlight("unknownlang", "x = 1"), [{ k: "plain", v: "x = 1" }]);
  for (const lang of ["py", "sh", "sql", "json", "go", "rs", "yaml", "css", "html"]) assert.equal(highlight(lang, "a b 'c' 1\n").map((t) => t.v).join(""), "a b 'c' 1\n", lang);
  const html = draw("```ts\nconst a = 1;\n```\n");
  assert.ok(html.includes('data-testid="lang-b0"') && html.includes(">ts<") && html.includes('data-testid="copy-b0"') && html.includes('data-testid="wrap-b0"'));
  const open = draw("```ts\nconst a = 1;", true);
  assert.ok(!open.includes('data-testid="copy-b0"'), "no controls while it is still being written");
});

test("a diagram falls back to its source with a line saying why when no renderer is in, and draws through the loader when one is", async () => {
  const md = "```mermaid\nflowchart LR\n  A[Upload] --> B{Size?}\n```\n";
  assert.equal(parse(md)[0]?.kind, "mermaid");
  assert.equal(hasDiagramLoader(), false);
  const fallback = draw(md);
  assert.ok(fallback.includes("flowchart LR") && fallback.includes('data-testid="diagram-source-text-b0"'), "the source, readable");
  await assert.rejects(renderDiagram("flowchart LR", { ink: "#000", sunk: "#eee", line: "#ccc", accent: "#55f", win: "#fff", dark: false }), /not switched on/);
  let seen = "";
  setDiagramLoader(async () => async (src, theme) => { seen = `${src}|${theme.dark ? "dark" : "light"}`; return '<svg viewBox="0 0 200 100"></svg>'; });
  assert.equal(await renderDiagram("graph TD", { ink: "#fff", sunk: "#222", line: "#444", accent: "#99f", win: "#111", dark: true }), '<svg viewBox="0 0 200 100"></svg>');
  assert.equal(seen, "graph TD|dark", "the skin's colours reach the renderer");
  setDiagramLoader(async () => async () => { throw new Error("Parse error on line 2"); });
  await assert.rejects(renderDiagram("graph TD\n  A -->", { ink: "#000", sunk: "#eee", line: "#ccc", accent: "#55f", win: "#fff", dark: false }), /Parse error on line 2/);
  setDiagramLoader(null);
});

test("charts: five kinds from a JSON spec; a bad spec is an error line above the source", () => {
  const specs = {
    bar: { type: "bar", labels: ["Jan", "Feb"], series: [{ name: "Uploads", data: [42, 55] }, { name: "Previews", data: [31, 38] }] },
    line: { type: "line", labels: ["a", "b", "c"], series: [{ name: "S", data: [1, 3, 2] }] },
    area: { type: "area", labels: ["a", "b", "c"], series: [{ name: "S", data: [1, 3, 2] }] },
    pie: { type: "pie", labels: ["x", "y", "z"], series: [{ name: "Share", data: [50, 30, 20] }] },
    scatter: { type: "scatter", series: [{ name: "P", data: [[1, 2], [2, 4], [3, 3]] }] },
  };
  for (const [type, spec] of Object.entries(specs)) {
    const r = parseChartSpec(JSON.stringify(spec));
    assert.ok(r.ok, type);
    if (!r.ok) continue;
    const g = chartGeometry(r.spec);
    assert.equal(g.type, type);
    if (type === "bar") { assert.equal(g.rects.length, 4); assert.ok(g.rects.every((q) => q.h >= 0 && q.y >= g.plot.y - 0.01)); const tall = g.rects.find((q) => q.v === 55)!; const short = g.rects.find((q) => q.v === 31)!; assert.ok(tall.h > short.h, "taller value, taller bar"); }
    if (type === "line" || type === "area") { assert.equal(g.lines[0]!.pts.length, 3); assert.ok(g.lines[0]!.pts[1]![1] < g.lines[0]!.pts[0]![1], "a higher value is higher on the page"); }
    if (type === "pie") { assert.equal(g.slices.length, 3); assert.ok(Math.abs(g.slices.reduce((a, b) => a + b.frac, 0) - 1) < 1e-9); }
    if (type === "scatter") assert.equal(g.points.length, 3);
    const html = draw("```chart\n" + JSON.stringify(spec) + "\n```\n");
    assert.ok(html.includes('data-testid="block-b0"') && html.includes("chart"), type);
  }
  const t = chartTable(specs.bar as never);
  assert.deepEqual(t.head, ["", "Uploads", "Previews"]);
  assert.deepEqual(t.rows, [["Jan", "42", "31"], ["Feb", "55", "38"]]);
  for (const bad of ["not json", "[]", '{"type":"donut","series":[{"data":[1]}]}', '{"type":"bar"}', '{"type":"bar","series":[{"data":["x"]}]}']) {
    const html = draw("```chart\n" + bad + "\n```\n");
    assert.ok(html.includes('data-testid="chart-error-b0"'), `an error line for ${bad}`);
    assert.ok(html.includes(bad.replace(/"/g, '"')) || html.includes("not json"), "and the source under it");
  }
});

test("streaming: a block that was final keeps its object, a growing table or code block does not flicker into other kinds", () => {
  const full = "Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```chart\n{\"type\":\"bar\",\"series\":[{\"data\":[1,2]}]}\n```\n\n> [!NOTE]\n> Done.\n";
  const p = createIncrementalMarkdown();
  const seen: string[] = [];
  let firstP: Block | undefined;
  for (const ch of full) {
    p.append(ch);
    const blocks = p.view().blocks;
    if (blocks.length > 0 && firstP === undefined && p.view().closedCount > 0) firstP = blocks[0];
    if (firstP) assert.equal(blocks[0], firstP, "the paragraph that closed is the same object from then on");
    seen.push(blocks.map((b) => b.kind).join(","));
  }
  p.finish();
  assert.deepEqual(p.view().blocks.map((b) => b.kind), ["p", "table", "chart", "callout"]);
  // a chart is code until its fence closes, then it is a chart: it never shows an error for half a JSON
  assert.ok(!seen.some((k) => k.includes("chart")) || seen.findIndex((k) => k.includes("chart")) > seen.findIndex((k) => k.includes("table")));
  const midChart = createIncrementalMarkdown();
  midChart.append('```chart\n{"type":"bar","ser');
  assert.equal(midChart.view().blocks[0]?.kind, "code");
});

const EVERY = [
  "# Plan", "", "Intro with **bold**, ~~old~~, `code`, a [link](https://example.com) and https://example.org/auto.[^1]", "",
  "| Option | Monthly | Uptime |", "|---|---:|---:|", "| Railway | $48 | 99.9% |", "| Fly.io | $39 | 99.95% |", "",
  "- [x] Pick the host", "- [ ] Move the data", "",
  "```mermaid", "flowchart LR", "  A[Upload] --> B{Under 2 GB?}", "```", "",
  "Inline $E = mc^2$ and display:", "", "$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$", "",
  "```ts", "const limit = 2_000_000_000;", "```", "",
  "```chart", '{"type":"bar","labels":["Jan","Feb"],"series":[{"name":"Uploads","data":[42,55]}]}', "```", "",
  "> [!NOTE]", "> Files over 2 GB are refused.", "",
  "<details>", "<summary>Method</summary>", "", "Measured three times.", "", "</details>", "",
  "![Portal](https://example.com/portal.png)", "", "[^1]: Provider status pages.", "",
].join("\n");

test("the golden message: every format at once draws every block, in both skins' markup", () => {
  const kinds = parse(EVERY).map((b) => b.kind);
  assert.deepEqual(kinds, ["h", "p", "table", "ul", "mermaid", "p", "math", "code", "chart", "callout", "details", "img", "fn"]);
  const html = draw(EVERY);
  for (const needle of ["Plan", "Railway", "Fly.io", 'aria-label="Done"', 'aria-label="Not done"', "flowchart LR", "E = mc^2", "sum_{i=1}", "limit", "2_000_000_000", 'data-testid="chart-b8"', "Files over 2 GB are refused.", "Method", 'data-testid="img-b11"', "Provider status pages."]) assert.ok(html.includes(needle), needle);
  // colours are skin tokens, so one markup serves paper and graphite: no hard-coded light or dark colour in the message
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(html.replace(/data:image[^"]*/g, "")), "no fixed colours");
});
