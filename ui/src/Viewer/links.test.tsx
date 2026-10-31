// File references in a note's words (rc.8): found, looked up by the caller, drawn as links that open a file in a tab; a missing target is dim and can be created.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Viewer } from "./index.tsx";
import { distinctRefs, linkState, refsIn, splitRefs } from "./links.ts";
import type { FileLinks } from "./links.ts";

test("wikilinks, relative markdown links and bare file names are found; web addresses, e-mail and anchors are not", () => {
  const text = "Inherits: VYRE.md and [[Brand voice]], see [plan](docs/plan.md) or [site](https://example.com/a.md), mail a@b.md, open agent.toml.";
  assert.deepEqual(refsIn(text).map((r) => [r.kind, r.ref, r.label]), [["bare", "VYRE.md", "VYRE.md"], ["wiki", "Brand voice", "Brand voice"], ["md", "docs/plan.md", "plan"], ["bare", "agent.toml", "agent.toml"]]);
  assert.deepEqual(splitRefs("a VYRE.md b").map((p) => (typeof p === "string" ? p : p.ref)), ["a ", "VYRE.md", " b"]);
  assert.deepEqual(distinctRefs("VYRE.md VYRE.md agent.toml").map((r) => r.ref), ["VYRE.md", "agent.toml"]);
  assert.deepEqual(refsIn("version 1.2.3 and no.exts here, a... b"), [], "a number or a word with a dot is not a file");
});

test("a found file is a link, a missing wikilink is broken, a missing bare name stays words", () => {
  const links: FileLinks = { targets: new Map([["VYRE.md", { id: "fil_v", name: "VYRE.md", path: "Knowledge/VYRE.md" }], ["Brand voice", null], ["gone.md", null]]), open: () => undefined };
  const [vyre, brand] = refsIn("VYRE.md [[Brand voice]] gone.md");
  assert.equal(linkState(vyre!, links), "link");
  assert.equal(linkState(brand!, links), "broken");
  assert.equal(linkState(refsIn("gone.md")[0]!, links), "plain");
  assert.equal(linkState(vyre!, undefined), "plain");
});

test("the viewer draws the links and the broken one, and nothing changes without links", () => {
  const blocks = [{ id: "a", tag: "p" as const, text: "Inherits: VYRE.md and [[Brand voice]] and [plan](docs/plan.md)" }];
  const links: FileLinks = { targets: new Map([["VYRE.md", { id: "fil_v", name: "VYRE.md", path: "Knowledge/VYRE.md" }], ["Brand voice", null], ["docs/plan.md", { id: "fil_p", name: "plan.md" }]]), open: () => undefined, create: () => undefined };
  const html = renderToStaticMarkup(<Viewer fileId="d" title="AGENT.md" kind="document" blocks={blocks} fileLinks={links} />);
  assert.match(html, /data-testid="filelink-fil_v"/);
  assert.match(html, /data-testid="filelink-fil_p"/);
  assert.match(html, /data-testid="filelink-missing-Brand voice"/);
  assert.match(html, /title="Knowledge\/VYRE.md"/);
  assert.match(html, /title="Create it"/);
  assert.ok(!html.includes("[[") && !html.includes("](docs"), "markers never show");
  const plain = renderToStaticMarkup(<Viewer fileId="d" title="AGENT.md" kind="document" blocks={blocks} />);
  assert.ok(!plain.includes("filelink-"));
});
