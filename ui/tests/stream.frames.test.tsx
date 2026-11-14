// Every block with controls wears one frame (G27): a quiet bar with what it is and its buttons, always shown, content below.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlocks, createIncrementalMarkdown } from "../src/stream/index.ts";
import { diagramLabel } from "../src/stream/Blocks.tsx";

const draw = (md: string): string => {
  const p = createIncrementalMarkdown();
  p.append(md);
  p.finish();
  return renderToStaticMarkup(<MarkdownBlocks blocks={p.view().blocks} />).replaceAll("<!-- -->", "");
};

console.log(draw("| A | B |\n|---|---|\n| 1 | 2 |\n").slice(0, 1500));
test("a table says what it is in its bar, with Copy as CSV beside it", () => {
  const html = draw("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n");
  assert.ok(html.includes("Table · 2 rows"));
  assert.ok(html.indexOf("Copy as CSV") < html.indexOf("thead-"), "the bar is above the rows, not a foot under them");
});

test("a chart's bar says Chart and its type, with Chart and Table always shown", () => {
  const html = draw(
    '```chart\n{"type":"bar","title":"Uploads","labels":["Jan","Feb"],"series":[{"name":"A","data":[4,5]},{"name":"B","data":[2,3]}]}\n```\n',
  );
  assert.ok(html.includes("Chart · bar"), "the bar names it");
  assert.ok(html.includes(">Chart<") && html.includes(">Table<"), "the switch");
});

test("a diagram is named for what it draws", () => {
  assert.equal(diagramLabel("flowchart LR\nA-->B"), "Flowchart");
  assert.equal(diagramLabel("sequenceDiagram\nA->>B: hi"), "Sequence diagram");
  assert.equal(diagramLabel("pie\n"), "Diagram");
});

test("the diagram frame is fully sandboxed and loads nothing from outside (review, 14 Nov)", async () => {
  const { diagramFrameProps, DIAGRAM_CSP } = await import("../src/stream/Blocks.tsx");
  const evil = '<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/><script>alert(1)</script></svg>';
  const p = diagramFrameProps(evil, false);
  assert.strictEqual(p["sandbox"], "", "an empty sandbox: no scripts, no same-origin, no forms");
  const doc = String(p["srcDoc"]);
  assert.ok(doc.includes(`http-equiv="Content-Security-Policy" content="${DIAGRAM_CSP}"`));
  assert.ok(DIAGRAM_CSP.startsWith("default-src 'none'") && !/https?:|script-src/.test(DIAGRAM_CSP));
  assert.ok(
    doc.indexOf("Content-Security-Policy") < doc.indexOf("evil.example"),
    "the policy is in force before the SVG parses",
  );
});
