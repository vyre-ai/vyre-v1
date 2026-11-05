// The Markdown editor's round trip: what a file says is what the editor holds, and what it saves is the same plain .md that agents read. AGENT.md, SKILL.md and a long README
// come back byte for byte; text with markup characters is escaped only where it must be; the document fits the editor's real schema; paste loses the indent it was copied with.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getSchema } from "@tiptap/core";
import { AGENT_MD_DEFAULT, ASSISTANT_AGENT_MD, GUIDE_MD } from "../modules/agents/projections.ts";
import { dedentPaste, docToMarkdown, docText, inlineToNodes, looksLikeMarkdown, markdownToDoc, nodesToInline } from "../ui/src/RichEditor/mdtree.ts";
import { markdownExtensions } from "../ui/src/RichEditor/extensions.ts";

const schema = getSchema(markdownExtensions());
const fixture = (n: string): string => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

const FILES: Array<[string, string]> = [
  ["AGENT.md of a new agent", AGENT_MD_DEFAULT("Intake", "Use me when a new client form arrives.")],
  ["AGENT.md of the assistant", ASSISTANT_AGENT_MD("Irfad’s Assistant")],
  ["AGENT.md of a bare role", AGENT_MD_DEFAULT("Scout", "Researcher")],
  ["VYRE.md guide", GUIDE_MD],
  ["SKILL.md", fixture("skill-sample.md")],
  ["a long README", fixture("readme-long.md")],
];

for (const [label, text] of FILES) {
  test(`${label}: the document is valid in the editor's schema and the file comes back byte for byte`, () => {
    const d = markdownToDoc(text);
    schema.nodeFromJSON(d).check();
    assert.equal(docToMarkdown(d), text);
  });
  test(`${label}: saving twice changes nothing`, () => {
    const once = docToMarkdown(markdownToDoc(text));
    assert.equal(docToMarkdown(markdownToDoc(once)), once);
  });
}

test("the README's blocks are the blocks a person sees", () => {
  const d = markdownToDoc(fixture("readme-long.md"));
  const kinds = (d.content ?? []).map((n) => n.type);
  for (const k of ["heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "rawBlock"]) assert.ok(kinds.includes(k), `a ${k}`);
  const raws = (d.content ?? []).filter((n) => n.type === "rawBlock").map((n) => n.attrs?.["kind"]);
  assert.deepEqual(raws, ["table", "html", "html", "ref", "indented"], "a table, HTML, link references and indented code are kept as written");
  const tasks = (d.content ?? []).find((n) => n.type === "taskList");
  assert.deepEqual((tasks?.content ?? []).map((i) => i.attrs?.["checked"]), [true, false, false]);
  const first = (d.content ?? [])[0];
  assert.equal(first?.type, "heading");
});

test("SKILL.md front matter is one raw block at the top, and the body is blocks", () => {
  const d = markdownToDoc(fixture("skill-sample.md"));
  assert.equal(d.content?.[0]?.type, "rawBlock");
  assert.equal(d.content?.[0]?.attrs?.["kind"], "front");
  assert.match(docToMarkdown({ type: "doc", content: [d.content![0]!] }), /^---\nname: write-brief/);
  assert.equal(d.content?.[1]?.type, "heading");
});

test("inline marks round trip and keep their spaces outside", () => {
  for (const s of ["plain", "a **bold** word", "an *italic* word", "~~gone~~", "`code` here", "[a link](https://example.com/x)", "**bold *and italic* mix**", "[**bold link**](https://e.com)", "two  spaces stay"]) {
    assert.equal(nodesToInline(inlineToNodes(s)), s, s);
  }
  const edited = [{ type: "text", text: "bold ", marks: [{ type: "bold" }] }, { type: "text", text: "tail" }];
  assert.equal(nodesToInline(edited), "**bold** tail", "a space inside a mark is written outside it");
});

test("text is escaped only where it would read as markup", () => {
  const plain = ["skills/book_consult/SKILL.md", "a_b_c", "snake_case_name", "2 * 3 * 4", "C:\\Users\\Maya", "path\\to", "100% done", "a < b and c > d", "tags #one #two", "email me@example.com", "https://example.com/a_b_c"];
  for (const s of plain) assert.equal(nodesToInline([{ type: "text", text: s }]), s, `${s} is written as typed`);
  assert.equal(nodesToInline([{ type: "text", text: "*not italic*" }]), "\\*not italic\\*");
  assert.equal(nodesToInline([{ type: "text", text: "# not a heading" }]), "\\# not a heading");
  assert.equal(nodesToInline([{ type: "text", text: "1. not a list" }]), "\\1. not a list");
  assert.equal(nodesToInline(inlineToNodes("\\*not italic\\*")), "\\*not italic\\*");
  // what is escaped reads back as what was typed
  assert.equal(docText(markdownToDoc("\\*not italic\\*\n")).trim(), "*not italic*");
});

test("a list keeps its marker and spacing, a numbered list its numbers, a checklist its ticks", () => {
  for (const s of ["* a\n* b\n", "+ a\n+ b\n", "- a\n\n- b\n", "1) a\n2) b\n", "3. a\n4. b\n", "- [x] done\n- [ ] open\n", "- a\n  - nested\n    - deeper\n- b\n", "1. one\n   - inner\n2. two\n"]) {
    assert.equal(docToMarkdown(markdownToDoc(s)), s, JSON.stringify(s));
  }
});

test("blank lines between blocks are kept as written", () => {
  for (const s of ["## Goal\nText right under the heading.\n", "Para\n\n\n\nafter a long gap\n".replace(/\n\n\n\n/, "\n\n"), "# T\n\ntext\n- a\n- b\n", "line one\nline two\nline three\n"]) {
    assert.equal(docToMarkdown(markdownToDoc(s)), s, JSON.stringify(s));
  }
});

test("an empty file is an empty document and writes nothing", () => {
  assert.equal(docToMarkdown(markdownToDoc("")), "");
  assert.equal(docToMarkdown(markdownToDoc("\n\n")), "");
});

test("paste: the common leading indent goes, a tab is two spaces, text that was not indented is left alone", () => {
  assert.deepEqual(dedentPaste("    ## Title\n    - one\n    - two"), { text: "## Title\n- one\n- two", removed: 4 });
  assert.deepEqual(dedentPaste("  a\n    b\n  c"), { text: "a\n  b\nc", removed: 2 });
  assert.deepEqual(dedentPaste("\t- a\n\t- b"), { text: "- a\n- b", removed: 2 });
  assert.deepEqual(dedentPaste("- a\n  - b"), { text: "- a\n  - b", removed: 0 });
  assert.deepEqual(dedentPaste("  one\n\n  two\n"), { text: "one\n\ntwo\n", removed: 2 });
});

test("paste: markdown text becomes its structure, a plain phrase stays text", () => {
  assert.equal(looksLikeMarkdown("just some words"), false);
  assert.equal(looksLikeMarkdown("## A heading"), true);
  assert.equal(looksLikeMarkdown("- one\n- two"), true);
  assert.equal(looksLikeMarkdown("two\nlines"), true);
  const d = markdownToDoc(dedentPaste("    ## Escalation\n    - Call Maya\n    - [ ] Log it\n").text);
  assert.deepEqual((d.content ?? []).map((n) => n.type), ["heading", "bulletList", "taskList"]);
  schema.nodeFromJSON(d).check();
});

// ---- block ids and live blocks (the project Overview page): <!--b:id--> before a block, :::live {json} for a live block
import { liveBlockNode } from "../ui/src/RichEditor/mdtree.ts";

const OVERVIEW = [
  "<!--b:blk_a1-->",
  "# Q4 launch",
  "",
  "<!--b:blk_b2-->",
  "Some **text** with a [link](https://e.com).",
  "",
  "<!--b:blk_c3-->",
  ':::live {"type":"records","spec":{"type":"invoice","title":"Invoices"},"view":"table"}',
  "",
  "<!--b:blk_d4-->",
  "- one",
  "- two",
  "",
].join("\n");

test("a page with block-id comments and live blocks comes back unchanged, and each id sits on its block", () => {
  assert.equal(docToMarkdown(markdownToDoc(OVERVIEW)), OVERVIEW);
  const d = markdownToDoc(OVERVIEW);
  assert.deepEqual(d.content!.map((n) => [n.type, n.attrs?.["blockId"]]), [["heading", "blk_a1"], ["paragraph", "blk_b2"], ["liveBlock", "blk_c3"], ["bulletList", "blk_d4"]]);
  const live = d.content![2]!;
  assert.deepEqual([live.attrs?.["type"], live.attrs?.["view"], live.attrs?.["spec"]], ["records", "table", { type: "invoice", title: "Invoices" }]);
});

test("a block with no id gets none, a tight comment keeps how it sat, and a comment with no block after it is kept", () => {
  const md = "Plain paragraph.\n\n<!--b:blk_z9-->\nSecond.\n<!--b:blk_y8-->\nThird, tight to the one above.\n\n<!--b:blk_end-->\n";
  assert.equal(docToMarkdown(markdownToDoc(md)), md);
  assert.equal(markdownToDoc(md).content![0]!.attrs?.["blockId"], undefined);
});

test("an unknown live block keeps its JSON, key order and extra keys included; a changed spec is written with the extras kept", () => {
  const line = ':::live {"view":"cards","type":"hologram","spec":{"n":3},"note":"kept","extra":[1,2]}';
  const d = markdownToDoc(`<!--b:blk_u1-->\n${line}\n`);
  assert.equal(docToMarkdown(d), `<!--b:blk_u1-->\n${line}\n`);
  const live = d.content![0]!;
  assert.equal(live.attrs?.["type"], "hologram");
  live.attrs = { ...live.attrs, view: "list" };
  const out = docToMarkdown(d);
  assert.match(out, /"type":"hologram"/);
  assert.match(out, /"view":"list"/);
  assert.match(out, /"note":"kept"/);
  assert.match(out, /"extra":\[1,2\]/);
});

test("a live line whose JSON cannot be read is kept as written, and a node inserted from the slash menu is one live line", () => {
  const bad = ":::live {not json}";
  assert.equal(docToMarkdown(markdownToDoc(bad)), `${bad}\n`);
  const d = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }, liveBlockNode("tasks", { status: "open" }, "list")] };
  assert.equal(docToMarkdown(d), 'Hi\n\n:::live {"type":"tasks","spec":{"status":"open"},"view":"list"}\n');
});

test("markdown inside a quote or list that looks like a marker is not an id", () => {
  const md = "> <!--b:blk_q-->\n> quoted\n";
  assert.equal(markdownToDoc(md).content![0]!.attrs?.["blockId"], undefined);
  assert.equal(docToMarkdown(markdownToDoc(md)), md);
});

test("the Overview page is valid in the editor's schema, and a live block survives the editor's own node (toJSON) with its ids", () => {
  const d = markdownToDoc(OVERVIEW);
  const node = schema.nodeFromJSON(d);
  node.check();
  assert.equal(docToMarkdown(node.toJSON()), OVERVIEW, "markdown, then the editor's document, then markdown: unchanged");
  const types: string[] = [];
  node.forEach((n) => types.push(n.type.name));
  assert.deepEqual(types, ["heading", "paragraph", "liveBlock", "bulletList"]);
  assert.equal(node.child(2).isAtom, true);
});
