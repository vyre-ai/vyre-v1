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
