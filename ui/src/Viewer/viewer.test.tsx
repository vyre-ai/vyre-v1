// ui/Viewer: markup pin anchors survive zoom; find in file highlights (spec 2.16, 3.5). The pure rules are tested directly; the view is rendered to markup per kind.
// @reads ../../../scripts/shots/mounts/P-L9_10.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Viewer, linksOf, stripInline, inlineRuns, ZOOM_MAX, ZOOM_MIN, boxFrom, clampZoom, findMatches, markRuns, pinAt, sheetFoot, sortRows, stepZoom, toUnit, VIEWER_KINDS, MARKUP_TOOLS } from "./index.tsx";
import type { DocBlock, MarkupBox, ViewerViewProps } from "./index.tsx";

const BOXES: readonly MarkupBox[] = [{ id: "b1", x: 0.08, y: 0.32, w: 0.44, h: 0.32, text: "Is this offer still live?" }, { id: "b2", x: 0.6, y: 0.2, w: 0.2, h: 0.2, text: "Crop here" }];
const BLOCKS: readonly DocBlock[] = [
  { id: "h", tag: "h1", text: "Fee schedule" },
  { id: "p1", tag: "p", text: "The referral fee is paid once. The fee is shown on the invoice." },
  { id: "l1", tag: "li", text: "No fee for family" },
];
const SHEET = { cols: ["Client", "Amount"], rows: [["Rivera", "$1,200"], ["Chen", "$300"], ["Ortiz", "$900"]] } as const;
const tag = (html: string, id: string): string => {
  const m = new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html);
  assert.ok(m !== null, `${id} is rendered`);
  return m[0];
};

test("kinds and tools are the frozen sets", () => {
  assert.deepEqual([...VIEWER_KINDS], ["image", "document", "csv", "plan", "other"]);
  assert.deepEqual([...MARKUP_TOOLS], ["draw", "comment", "highlight"]);
});

test("a markup pin keeps its anchor at every zoom: the unit anchor never changes, only the drawn position scales", () => {
  const a = { x: 0.25, y: 0.4, w: 0.1, h: 0.1 };
  const one = pinAt(a, 1);
  for (const z of [0.5, 1, 1.5, 2, 4]) {
    const p = pinAt(a, z);
    assert.ok(Math.abs(p.left / z - one.left) < 1e-9 && Math.abs(p.top / z - one.top) < 1e-9, `same spot at ${z}`);
  }
  const [x, y] = toUnit(250, 300, 1000, 750);
  assert.equal(x, 0.25);
  assert.equal(y, 0.4);
  const html = renderToStaticMarkup(<Viewer fileId="f" title="Offer.png" kind="image" boxes={BOXES} zoom={1} />);
  const z2 = renderToStaticMarkup(<Viewer fileId="f" title="Offer.png" kind="image" boxes={BOXES} zoom={2} />);
  assert.match(tag(html, "vw-pin-1"), /data-anchor="0.080,0.320"/);
  assert.match(tag(z2, "vw-pin-1"), /data-anchor="0.080,0.320"/, "the anchor is the same at 200%");
  assert.match(tag(z2, "viewer"), /data-zoom="2"/);
});

test("zoom steps in quarters, resets to 100 and stays inside its limits", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1.25, -1), 1);
  assert.equal(stepZoom(3, 0), 1);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(0.01), ZOOM_MIN);
});

test("a dragged box under 2 percent is not an area; otherwise it normalises the corners", () => {
  assert.equal(boxFrom([0.1, 0.1], [0.11, 0.5]), null);
  assert.deepEqual(boxFrom([0.5, 0.6], [0.2, 0.3]), { x: 0.2, y: 0.3, w: 0.3, h: 0.3 });
});

test("pins are numbered in order with their notes beside the image", () => {
  const html = renderToStaticMarkup(<Viewer fileId="f" title="Offer.png" kind="image" boxes={BOXES} />);
  assert.ok(html.includes('data-testid="vw-pinrow-1"') && html.includes("Is this offer still live?"));
  assert.ok(html.includes('data-testid="vw-pinrow-2"') && html.includes("Crop here"));
  assert.ok(html.includes('data-testid="vw-tool-draw"') && html.includes("Comment on an area") && html.includes('data-testid="vw-clear"'));
  assert.match(tag(renderToStaticMarkup(<Viewer fileId="f" title="x" kind="image" tool="comment" />), "viewer"), /data-tool="comment"/);
});

test("find in file lists every match in reading order and marks the current one", () => {
  const texts = BLOCKS.map((b) => b.text);
  const hits = findMatches(texts, "fee");
  assert.equal(hits.length, 4);
  assert.deepEqual(hits.map((h) => h.block), [0, 1, 1, 2]);
  assert.deepEqual(findMatches(texts, "  "), []);
  const runs = markRuns(texts[1] ?? "", hits, 1, 2, hits);
  assert.deepEqual(runs.filter((r) => r.hit === true).length, 2);
  assert.equal(runs.filter((r) => r.on === true).length, 1);
  assert.equal(runs.map((r) => r.text).join(""), texts[1]);
  const html = renderToStaticMarkup(<Viewer fileId="d" title="Fees.md" kind="document" blocks={BLOCKS} find="fee" />);
  assert.equal(html.match(/data-find="(?:match|current)"/g)?.length, 4, "every match is highlighted");
  assert.equal(html.match(/data-find="current"/g)?.length, 1);
  assert.match(html, /1 of 4/);
  assert.match(renderToStaticMarkup(<Viewer fileId="d" title="Fees.md" kind="document" blocks={BLOCKS} find="zzz" />), /No matches/);
});

test("a document edits in place when editing is on, and reads as text otherwise", () => {
  const read = renderToStaticMarkup(<Viewer fileId="d" title="Fees.md" kind="document" blocks={BLOCKS} />);
  assert.ok(!read.includes("<textarea"), "no inputs in read mode");
  const edit = renderToStaticMarkup(<Viewer fileId="d" title="Plan" kind="plan" editing blocks={BLOCKS} />);
  assert.equal(edit.match(/<textarea/g)?.length, 3, "every block is editable");
});

test("a sheet sorts numbers by value, shows the footer and sum for a numeric column; other files say there is no preview", () => {
  assert.deepEqual(sortRows(SHEET.rows, 1, 1).map((r) => r[0]), ["Chen", "Ortiz", "Rivera"]);
  assert.deepEqual(sortRows(SHEET.rows, 0, -1).map((r) => r[0]), ["Rivera", "Ortiz", "Chen"]);
  assert.equal(sheetFoot(SHEET, null), "3 rows · 2 columns");
  assert.equal(sheetFoot(SHEET, 1), "3 rows · 2 columns · Amount: sum 2,400, average 800.0");
  const html = renderToStaticMarkup(<Viewer fileId="c" title="fees.csv" kind="csv" sheet={SHEET} />);
  assert.ok(html.includes('data-testid="vw-sort-1"') && html.includes('data-testid="vw-cell-2-0"') && html.includes("3 rows · 2 columns"));
  assert.ok(renderToStaticMarkup(<Viewer fileId="o" title="x.bin" kind="other" />).includes("No preview"));
});

test("the header shows the shared Ask control when given", () => {
  const ask: ViewerViewProps["ask"] = { place: "files", context: { kind: "file", id: "f", title: "Offer.png", access: "edit" }, agents: [{ id: "a", name: "Assistant", assistant: true }], onAsk: () => undefined };
  const html = renderToStaticMarkup(<Viewer fileId="f" title="Offer.png" kind="image" ask={ask} />);
  assert.match(html, /Ask/);
  assert.ok(html.includes('data-testid="vw-find-btn"') && !html.includes('data-testid="vw-find-input"'), "the find box opens from its button");
  assert.ok(renderToStaticMarkup(<Viewer fileId="f" title="Offer.png" kind="image" find="x" />).includes('data-testid="vw-find-input"'), "a find query opens the box");
});

test("the header shows the file tile, its path line, Find, Details, History and More; csv and plan add View and Edit with the saved version", () => {
  const html = renderToStaticMarkup(<Viewer fileId="c" title="competitors.csv" kind="csv" kindLabel="CSV" subtitle="Agents / Research · Yesterday 4:40 pm" saved={3} sheet={SHEET} />);
  for (const id of ["vw-tile", "vw-sub", "vw-find-btn", "vw-info", "vw-history", "vw-more", "vw-mode", "vw-mode-view", "vw-mode-edit", "vw-saved"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.match(html, /v3/);
  assert.ok(!renderToStaticMarkup(<Viewer fileId="f" title="x.png" kind="image" />).includes('data-testid="vw-mode"'), "no View and Edit on an image");
  const edit = renderToStaticMarkup(<Viewer fileId="c" title="c.csv" kind="csv" sheet={SHEET} edit />);
  assert.ok(edit.includes('data-testid="vw-hint"'), "Edit mode shows how to edit a cell");
  assert.ok(!renderToStaticMarkup(<Viewer fileId="c" title="c.csv" kind="csv" sheet={SHEET} />).includes('data-testid="vw-hint"'), "View mode has no hint");
});

test("markup shows Ask <agent> once something is marked, red numbered boxes with their note beside the pin, and the sibling strip", () => {
  const marked = renderToStaticMarkup(<Viewer fileId="f" title="a.png" kind="image" boxes={BOXES} agentName="Research" siblings={[{ id: "a", title: "one" }, { id: "b", title: "two" }]} current="b" />);
  assert.ok(marked.includes('data-testid="vw-ask-markup"') && marked.includes("Ask Research"));
  assert.ok(marked.includes('data-testid="vw-bubble-1"') && marked.includes("Is this offer still live?"));
  assert.ok(marked.includes('data-testid="vw-sib-a"') && marked.includes('data-testid="vw-sib-b"'));
  assert.ok(!renderToStaticMarkup(<Viewer fileId="f" title="a.png" kind="image" agentName="Research" />).includes('data-testid="vw-ask-markup"'), "nothing marked, no Ask");
});

test("inline **bold** and [[link]] markers become runs and never count in find", () => {
  assert.equal(stripInline("The fee is **$250** and [[Pricing landscape]]"), "The fee is $250 and Pricing landscape");
  assert.deepEqual(inlineRuns("a **b** [[c]] d"), [{ text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", link: true }, { text: " d" }]);
  assert.equal(inlineRuns("x **y** z").map((r) => r.text).join(""), stripInline("x **y** z"));
  const blocks: DocBlock[] = [{ id: "a", tag: "p", text: "The **fee** is [[fee]] schedule" }];
  assert.equal(findMatches(blocks.map((b) => stripInline(b.text)), "fee").length, 3 - 1, "markers are not matched");
  const html = renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={blocks} />);
  assert.ok(!html.includes("**") && !html.includes("[["), "markers never show");
  assert.match(html, /data-link="true"/);
});

test("a front-matter block draws as a card, and the info button opens the Details panel with rows and linked sections", () => {
  const blocks: DocBlock[] = [{ id: "m", tag: "meta", text: "kind\tdecision\nsource\tchat" }, { id: "h", tag: "h1", text: "Consult fee" }];
  const details = { rows: [["Path", "Agents / Intake"], ["Kind", "Note"]] as const, sections: [{ title: "Links to", count: 2, items: [{ id: "a", title: "Pricing landscape" }, { id: "b", title: "Maya Chen" }] }] };
  const closed = renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={blocks} details={details} />);
  assert.ok(closed.includes('data-testid="vw-block-m"') && closed.includes("decision") && !closed.includes('data-testid="vw-details"'));
  const open = renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={blocks} details={details} detailsOpen />);
  for (const id of ["vw-details", "vw-detail-Path", "vw-detail-section-Links to", "row-d-a", "vw-details-close"]) assert.ok(open.includes(`data-testid="${id}"`), id);
  assert.match(open, /Links to\s+2/);
});

test("a picture shows when src is given and strokes draw over it; the first cell can be pre-selected and the footer then sums its column", () => {
  const img = renderToStaticMarkup(<Viewer fileId="f" title="a.png" kind="image" src="data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" boxes={BOXES} />);
  assert.ok(img.includes('data-testid="vw-picture"') && img.includes('data-testid="vw-handle-1"'));
  const sheet = renderToStaticMarkup(<Viewer fileId="c" title="c.csv" kind="csv" sheet={SHEET} initialCell={{ r: 0, c: 1 }} />);
  assert.match(tag(sheet, "vw-cell-0-1"), /aria-selected="true"|selected/);
  assert.match(sheet, /Amount: sum 2,400, average 800\.0/);
});

test("a document has View and Edit, and Edit makes its blocks editable; code files have neither; strokes draw as an svg over the picture", () => {
  const doc: DocBlock[] = [{ id: "a", tag: "p", text: "Hello" }];
  assert.ok(renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={doc} />).includes('data-testid="vw-mode"'));
  assert.ok(!renderToStaticMarkup(<Viewer fileId="d" title="f.py" kind="document" blocks={[{ id: "c", tag: "code", text: "x = 1" }]} />).includes('data-testid="vw-mode"'));
  assert.ok(!renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={doc} />).includes("<textarea"), "View mode has no inputs");
  assert.ok(renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" edit blocks={doc} />).includes("<textarea"), "Edit mode makes the blocks editable");
  const strokes = [{ points: [[0.1, 0.1], [0.2, 0.2]] as const }];
  const img = renderToStaticMarkup(<Viewer fileId="f" title="a.png" kind="image" strokes={strokes} />);
  assert.ok(img.includes('data-testid="vw-strokes"') && img.includes("<polyline") && img.includes('points="0.1,0.1 0.2,0.2"'));
});

test("Links to and Linked from come from the graph's link edges, once each, only for nodes the graph holds", () => {
  const graph = {
    nodes: [{ nodeId: "me", title: "Consult fee" }, { nodeId: "a", title: "A", link: "Agents / A" }, { nodeId: "b", title: "B" }, { nodeId: "c", title: "C" }],
    edges: [
      { from: "me", to: "a", kind: "link" as const }, { from: "me", to: "a", kind: "link" as const }, { from: "b", to: "me", kind: "link" as const },
      { from: "c", to: "me", kind: "relation" as const }, { from: "ghost", to: "me", kind: "link" as const }, { from: "me", to: "me", kind: "link" as const },
    ],
  };
  const r = linksOf(graph, "me");
  assert.deepEqual(r.to, [{ id: "a", title: "A", note: "Agents / A" }]);
  assert.deepEqual(r.from, [{ id: "b", title: "B" }]);
  assert.deepEqual(linksOf(graph, "nope"), { to: [], from: [] });
  const blocks: DocBlock[] = [{ id: "h", tag: "h1", text: "Consult fee" }];
  const html = renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={blocks} graph={graph} nodeId="me" detailsOpen />);
  assert.ok(html.includes('data-testid="vw-linkedfrom"') && html.includes("Linked from · 1") && html.includes('data-testid="row-lf-b"'));
  for (const id of ["vw-detail-section-Links to", "vw-detail-section-Linked from"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.ok(!renderToStaticMarkup(<Viewer fileId="d" title="n.md" kind="document" blocks={blocks} />).includes("vw-linkedfrom"), "no graph, no section");
});
