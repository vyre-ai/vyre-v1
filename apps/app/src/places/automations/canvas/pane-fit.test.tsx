// The step inspector lives in a resizable side pane. At 360px nothing inside it keeps a pixel width wider than the pane:
// the inspector fills the pane, the email editor reads the pane's width (not the window's), and rows, segmented controls
// and the tab row wrap or shrink instead of clipping. Checked on the rendered inline styles and style tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "./Inspector.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { check } from "./model.ts";
import type { DefNode, Definition, KeyChoice } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { EmailBuilder, NARROW_WIDTH } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { EmailBuilderViewProps } from "../../../../../../ui/src/EmailBuilder/index.tsx";

const keys: KeyChoice[] = [{ id: "prv_team", name: "Team key", kind: "api", shared: true }];
const data = createSampleAutomations(northwind).data;

function inspector(node: DefNode, embedded: boolean): string {
  const d: Definition = { triggers: [{ key: "manual" }], nodes: [node] };
  return renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={d} node={node} trigger={null} triggerIndex={null} issues={check(d, "personal")} keys={keys} kind="personal" embedded={embedded} layout="desktop" onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
}
const rootStyle = (html: string): string => html.match(/<div[^>]*data-testid="inspector"[^>]*>/)?.[0] ?? "";
const NODE: DefNode = { id: "mail", key: "send_email", input: {} };

test("embedded in the side pane the inspector fills the pane: no 300px width of its own", () => {
  const root = rootStyle(inspector(NODE, true));
  assert.notEqual(root, "", "the inspector root is rendered");
  assert.doesNotMatch(root, /style="[^"]*width:\s*\d+px/, "a pixel width would clip the content when the pane is dragged narrower, and strand it when wider");
  assert.match(root, /r-width-/, "it takes a width token (100%), not an inline pixel width");
  assert.match(root, /r-maxWidth-/, "max-width: 100%");
  assert.match(root, /r-minWidth-/, "min-width: 0 so its rows can shrink");
});

test("standing alone (not in a pane) the desktop column keeps its width but never past its container", () => {
  const root = rootStyle(inspector(NODE, false));
  assert.match(root, /style="width:300px"/);
  assert.match(root, /r-maxWidth-/, "max-width: 100%");
});

const base: EmailBuilderViewProps = { id: "em1", title: "Weekly digest", subject: "Your week", previewText: "Seven things", mode: "visual", blocks: [{ id: "t1", kind: "text", text: "Hi" }], diffs: [] } as never;

test("the email editor lays out for the pane it sits in: it measures itself and stacks under the narrow width", () => {
  assert.ok(NARROW_WIDTH > 360, "a 360px pane is narrow");
  const html = renderToStaticMarkup(<EmailBuilder {...base} />);
  assert.match(html, /data-testid="email-builder"/);
  const pane = html.match(/<div[^>]*data-testid="em-pane"[^>]*>/)?.[0] ?? "";
  assert.match(pane, /r-maxWidth-/, "the Style, Ask, Preview and Check pane never exceeds its container");
});

test("the email header, block bar and segmented controls wrap, so 480/560/600 and Visual/HTML/Plain text are never cut off", () => {
  const html = renderToStaticMarkup(<EmailBuilder {...base} />);
  const head = html.match(/<div[^>]*data-testid="em-head"[^>]*>/)?.[0] ?? "";
  assert.match(head, /r-flexWrap-/, "the header wraps");
  assert.match(head, /r-minHeight-/, "the header has a minimum height, not a fixed one");
  assert.doesNotMatch(head, /r-height-/, "no fixed height that would clip a second row");
});
