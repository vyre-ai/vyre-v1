// The Markdown editor lists its TipTap extensions itself because the lockfile resolves them to 2.27.3 while @tiptap/core is pinned at 2.11.5 (ui/package.json). Until the versions are aligned in one lock change,
// this test is the guard: every extension the editor uses must load against the installed core, every name it imports from core must exist there, and each must add its node or mark to a working schema.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as core from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { markdownExtensions } from "../ui/src/RichEditor/extensions.ts";


const USED = ["blockquote", "bold", "bullet-list", "code", "code-block", "document", "dropcursor", "gapcursor", "hard-break", "heading", "history", "italic", "list-item", "ordered-list", "paragraph", "strike", "text"];

for (const name of USED) {
  test(`@tiptap/extension-${name} loads against the installed core and every name it takes from core is there`, async () => {
    const dir = path.join(process.cwd(), "node_modules", "@tiptap", `extension-${name}`);
    const mod = await import(`@tiptap/extension-${name}`);
    assert.ok(mod.default !== undefined || Object.keys(mod).length > 0, "it exports an extension");
    const dist = fs.readFileSync(path.join(dir, "dist", "index.js"), "utf8");
    const wanted = [...dist.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@tiptap\/core['"]/g)].flatMap((m) => (m[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0] ?? "").filter(Boolean));
    const missing = wanted.filter((n) => !(n in core));
    assert.deepEqual(missing, [], `names the extension takes from @tiptap/core that the installed core does not have`);
  });
}

test("the editor's extensions make a schema with the nodes and marks the Markdown round trip writes", () => {
  const schema = getSchema(markdownExtensions());
  for (const n of ["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak", "rawBlock"]) assert.ok(schema.nodes[n], `node ${n}`);
  for (const m of ["bold", "italic", "strike", "code", "link"]) assert.ok(schema.marks[m], `mark ${m}`);
  // a node of each kind is built, checked and written back
  const sample = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Head" }] },
      { type: "paragraph", content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://e.com" } }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }, { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] }] },
      { type: "blockquote", content: [{ type: "paragraph" }] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "a" }] },
      { type: "rawBlock", attrs: { kind: "table" }, content: [{ type: "text", text: "| a |" }] },
      { type: "horizontalRule" },
    ],
  };
  const node = schema.nodeFromJSON(sample);
  node.check();
  assert.deepEqual(schema.nodeFromJSON(node.toJSON()).toJSON(), node.toJSON());
});
