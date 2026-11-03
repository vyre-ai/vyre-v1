// One renderer everywhere: a note read, a file in the viewer, a runbook's prose and a reply that is done all draw Markdown with the chat's block components, so a table, a checklist, a callout, code and a chart read the
// same in each. The viewer goes back to its own blocks only for what works on them (find, redaction marks, comments).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlocks, MarkdownText, createIncrementalMarkdown } from "../src/stream/index.ts";
import { MarkdownEditor } from "../src/RichEditor/index.tsx";
import { Viewer } from "../src/Viewer/index.tsx";
import { Prose } from "../../apps/app/src/places/files/runbook/Prose.tsx";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const MD = "# Plan\n\n| Step | Owner |\n|---|---|\n| Draft | Dex |\n\n- [x] Pick the host\n- [ ] Move the data\n\n> [!WARNING]\n> Careful.\n\n```ts\nconst a = 1;\n```\n\n```chart\n{\"type\":\"bar\",\"labels\":[\"a\",\"b\"],\"series\":[{\"data\":[1,2]}]}\n```\n";
const PARTS = ['data-testid="thead-b1"', 'data-testid="sort-b1-0"', 'aria-label="Done"', 'aria-label="Not done"', 'data-callout="warning"', 'data-testid="copy-b4"', 'data-testid="chart-error-b5"'];

const asReply = (): string => { const p = createIncrementalMarkdown(); p.append(MD); p.finish(); return clean(renderToStaticMarkup(<MarkdownBlocks blocks={p.view().blocks} />)); };
const viewer = (extra: Record<string, unknown> = {}): string => clean(renderToStaticMarkup(<Viewer fileId="f" title="plan.md" kind="document" blocks={[{ id: "b0", tag: "h1", text: "Plan" }]} markdown={MD} {...extra} />));

test("a reply, a note read, a runbook's prose and a file in the viewer all draw the same blocks", () => {
  const reply = asReply();
  const surfaces: Array<[string, string]> = [
    ["MarkdownText", clean(renderToStaticMarkup(<MarkdownText text={MD} />))],
    ["a note read", clean(renderToStaticMarkup(<MarkdownEditor value={MD} mode="read" label="Note" />))],
    ["Prose", clean(renderToStaticMarkup(<Prose text={MD} />))],
    ["the viewer", viewer()],
  ];
  for (const part of PARTS.filter((p) => !p.includes("chart-error"))) assert.ok(reply.includes(part), `the reply has ${part}`);
  for (const [name, html] of surfaces) for (const part of PARTS.filter((p) => !p.includes("chart-error"))) assert.ok(html.includes(part), `${name} has ${part}`);
  assert.ok(viewer().includes('data-testid="vw-markdown"'));
});

test("the viewer keeps its own blocks while a comment is pinned or the page is edited, where its features work on them", () => {
  const withComment = viewer({ comments: [{ id: "c1", quote: "Plan", text: "Check", by: "Sara", at: "now" }] });
  assert.ok(!withComment.includes('data-testid="vw-markdown"'), "comments pin to the viewer's own blocks");
  const editing = viewer({ edit: true });
  assert.ok(!editing.includes('data-testid="vw-markdown"'));
});

test("front matter of a SKILL.md shows as the YAML it is, and a file name in a note still opens its file", () => {
  const html = clean(renderToStaticMarkup(<MarkdownText text={"---\nname: write-brief\ndescription: Write the brief\n---\n\n# Write brief\n"} />));
  assert.ok(html.includes("name: write-brief") && html.includes("yaml"), "the header is a yaml block");
  const named = clean(renderToStaticMarkup(<MarkdownText text="See notes.md" renderText={(t) => t.replace("notes.md", "[FILE]")} />));
  assert.ok(named.includes("[FILE]"), "renderText draws the plain words its own way");
});
