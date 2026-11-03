// The Markdown editor as a component: the bar's buttons and their shortcuts, the raw view's colour on the syntax, the switch between the two, and what read mode leaves out.
// The page itself is TipTap in a browser; here the markup and the pure parts are checked, and mdtree.ts's round trip is tested in test/md-roundtrip.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FORMAT_COMMANDS, MarkdownEditor, TEXT_STYLES, ViewSwitch, highlightLine, highlightMarkdown, shortcutText, tooltip } from "./index.tsx";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

test("the bar's buttons are the ones the owner asked for, each with its shortcut", () => {
  assert.deepEqual(FORMAT_COMMANDS.map((c) => c.label), ["Bold", "Italic", "Strikethrough", "Code", "Link", "Bulleted list", "Numbered list", "Checklist", "Quote", "Code block", "Divider"]);
  assert.deepEqual(TEXT_STYLES.map((s) => s.label), ["Paragraph", "Heading 1", "Heading 2", "Heading 3"]);
  assert.equal(shortcutText("Mod-B", true), "⌘B");
  assert.equal(shortcutText("Mod-Shift-X", true), "⌘⇧X");
  assert.equal(shortcutText("Mod-Alt-C", true), "⌘⌥C");
  assert.equal(shortcutText("Mod-Shift-X", false), "Ctrl+Shift+X");
  assert.equal(tooltip("Divider", ""), "Divider");
  assert.match(tooltip("Bold", "Mod-B"), /^Bold {2}.*B$/);
  for (const c of FORMAT_COMMANDS) assert.ok(c.icon.length > 0);
});

test("raw Markdown gets colour on the syntax, and the coloured text is exactly the text", () => {
  const md = ["# Title", "", "Some `code`, **strong**, [a link](https://e.com) and [[Page]].", "- item", "- [x] done", "1. one", "> quote", "```ts", "const a = 1;", "```", "Override: loosen this", "---", ""].join("\n");
  const rows = highlightMarkdown(md);
  assert.equal(rows.map((r) => r.map((s) => s.text).join("")).join("\n"), md, "no character lost or added");
  const cls = (i: number): string[] => rows[i]!.map((s) => s.cls);
  assert.deepEqual(cls(0), ["rk", "rh"]);
  assert.ok(cls(2).includes("rc") && cls(2).includes("rb") && cls(2).filter((c) => c === "rl").length === 2);
  assert.deepEqual(cls(3).slice(0, 2), ["rk", ""]);
  assert.equal(cls(4)[0], "rk");
  assert.deepEqual(cls(7), ["rf"]);
  assert.deepEqual(cls(8), ["rc"], "inside a fence");
  assert.deepEqual(cls(10), ["ro"], "an Override line stands out");
  assert.deepEqual(highlightLine("plain words", false).spans, [{ text: "plain words", cls: "" }]);
});

test("the editor draws its bar in styled edit and no bar in read; Markdown mode has the raw field", () => {
  const edit = clean(renderToStaticMarkup(<MarkdownEditor value={"# Hi\n"} label="AGENT.md" />));
  assert.match(edit, /data-testid="markdown-editor"/);
  assert.match(edit, /data-testid="markdown-editor-host"/, "the page mounts here in a browser");
  const read = clean(renderToStaticMarkup(<MarkdownEditor value={"# Hi\n"} label="AGENT.md" mode="read" />));
  assert.doesNotMatch(read, /md-view|md-tool-style/, "read mode has no switch and no bar");
  const raw = clean(renderToStaticMarkup(<MarkdownEditor value={"# Hi\n- a\n"} label="AGENT.md" view="raw" />));
  assert.match(raw, /data-testid="markdown-editor-raw"/);
  assert.match(raw, /<textarea[^>]*aria-label="AGENT.md"/);
  assert.match(raw, /class="rk"/, "the # and the bullet are coloured");
});

test("the Styled and Markdown switch names both views", () => {
  const html = clean(renderToStaticMarkup(<ViewSwitch view="styled" onView={() => undefined} />));
  assert.match(html, /Styled/);
  assert.match(html, /Markdown/);
});
