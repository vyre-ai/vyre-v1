// The editor of a Vyre document (lane r42-docs-editor): field chips that come back to the stored text unchanged, tracked changes (a person's edit becomes a suggestion; accept and reject),
// the text an agent streams in while a person types, and a large document. The page itself is TipTap in a browser; here the schema, the text round trip and the editor state are checked with no DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { Plugin, EditorState, TextSelection } from "@tiptap/pm/state";
import { docToMarkdown, markdownToDoc, nodesToInline, inlineToNodes } from "../ui/src/RichEditor/mdtree.ts";
import { markdownExtensions } from "../ui/src/RichEditor/extensions.ts";
import { chipLook, fieldLabel, missingTags, matchFields, tagsIn } from "../ui/src/RichEditor/doc/fields.ts";
import {
  countCritic,
  criticAuthors,
  listCritic,
  resolveCritic,
  resolveOneCritic,
  writeCritic,
} from "../ui/src/RichEditor/doc/critic.ts";
import { listChanges, resolveChanges, trackTransaction } from "../ui/src/RichEditor/doc/track.ts";
import { mergeRemote } from "../ui/src/RichEditor/doc/merge.ts";

const D = { doc: true } as const;
const schema = getSchema(markdownExtensions({ doc: {} }));
const T = "2026-11-19T10:00:00Z";
const who = { author: "Imran", now: () => T };
const meta = (a = "Imran"): string => `{>>${a}|${T}<<}`;

const roundtrip = (md: string): string => docToMarkdown(markdownToDoc(md, D), D);
const stateOf = (md: string, track = true): EditorState =>
  EditorState.create({
    schema,
    doc: schema.nodeFromJSON(markdownToDoc(md, D)),
    plugins: track
      ? [new Plugin({ appendTransaction: (trs, b, a) => trackTransaction(trs[0] as never, b, a, who) })]
      : [],
  });
const mdOf = (s: EditorState): string => docToMarkdown(s.doc.toJSON(), D);
const caret = (s: EditorState, pos: number): EditorState =>
  s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));

/* ---------- field chips ---------- */

const CHIP_TEXTS: Array<[string, string]> = [
  ["a name in a sentence", "This agreement is with {client.name} of {client.address.city}.\n"],
  ["spaces inside the braces are kept", "Dear { client.name },\n"],
  ["a signing row", "{sign:client} || {date:client}\n"],
  ["in a heading", "# Service agreement for {client.name}\n"],
  ["in bold and a list", "- **{client.name}** pays {fee}\n- second\n"],
  ["two in a row", "{a}{b} and {c.d}\n"],
  ["in a table", "| Name | Fee |\n| --- | --- |\n| {client.name} | {fee} |\n"],
  ["section tags stay text", "{#items}\n- {name}\n{/items}\n"],
  ["a page break stays text", "one\n\n{page:break}\n\ntwo\n"],
];
for (const [label, text] of CHIP_TEXTS) {
  test(`chips: ${label} come back to the stored text unchanged and fit the schema`, () => {
    const d = markdownToDoc(text, D);
    schema.nodeFromJSON(d).check();
    assert.equal(docToMarkdown(d, D), text);
    assert.equal(roundtrip(roundtrip(text)), text);
  });
}

test("chips: a value tag is a chip node, a section tag is text, and a plain Markdown file sees no chips at all", () => {
  const nodes = inlineToNodes("Hi {client.name} {#x}", D);
  assert.deepEqual(
    nodes.map((n) => n.type),
    ["text", "fieldChip", "text"],
  );
  assert.equal(nodes[1]?.attrs?.["raw"], "client.name");
  assert.equal(nodes[2]?.text, " {#x}");
  assert.ok(inlineToNodes("Hi {client.name}").every((n) => n.type === "text"));
  assert.equal(docToMarkdown(markdownToDoc("Hi {client.name}\n")), "Hi {client.name}\n");
});

test("chips: a signing mark is a chip; a literal tag typed as text is escaped so it stays text", () => {
  assert.equal(inlineToNodes("{sign:client}", D)[0]?.type, "fieldChip");
  const literal = nodesToInline([{ type: "text", text: "{client.name}" }], D);
  assert.equal(literal, "\\{client.name}");
  assert.deepEqual(
    inlineToNodes(literal, D).map((n) => n.type),
    ["text"],
  );
});

test("chips: what a chip shows follows the record (name, value, amber when it has none, signing mark)", () => {
  assert.equal(fieldLabel("client.name"), "Client name");
  assert.equal(fieldLabel("a.b.fee_amount"), "B fee amount");
  assert.equal(fieldLabel("sign:client"), "Client signs");
  assert.equal(fieldLabel("date:client"), "Client signing date");
  assert.equal(chipLook("client.name").state, "name");
  const rec = (k: string): string | null | undefined => ({ "client.name": "Imran Ibarra", fee: "" })[k] ?? null;
  assert.deepEqual(chipLook("client.name", rec), {
    state: "value",
    text: "Imran Ibarra",
    title: "Client name: Imran Ibarra",
  });
  assert.equal(chipLook("fee", rec).state, "missing");
  assert.equal(chipLook("other", rec).state, "missing");
  assert.equal(chipLook("sign:client", rec).state, "sign");
  assert.deepEqual(missingTags("{client.name} {fee} {fee} {sign:client}", rec), ["fee"]);
  assert.deepEqual(tagsIn("{a} {b.c} {#x} {a}"), ["a", "b.c"]);
});

test("chips: the picker lists the fields of the record type and narrows by what is typed", () => {
  const fields = [
    { tag: "client.name", label: "Client name" },
    { tag: "client.email", label: "Client email" },
    { tag: "fee", label: "Fee" },
  ];
  assert.equal(matchFields(fields, "").length, 3);
  assert.deepEqual(
    matchFields(fields, "cli").map((f) => f.tag),
    ["client.name", "client.email"],
  );
  assert.deepEqual(
    matchFields(fields, "FEE").map((f) => f.tag),
    ["fee"],
  );
});

/* ---------- tracked changes: the stored text ---------- */

const SG_TEXTS: Array<[string, string]> = [
  ["an addition", `Hello {++big ++}${meta()}world\n`],
  ["a removal", `Hello {--big --}${meta()}world\n`],
  ["a replacement", `Hello {~~world~>planet~~}${meta()}\n`],
  ["without who and when", "Hello {++big ++}world\n"],
  ["bold inside", `Hello {++**big**++}${meta()} world\n`],
  ["a chip inside", `Pay {++{fee}++}${meta()} now\n`],
  ["spaces at the edges of a replacement", `a {~~old ~>new ~~}${meta()}b\n`],
  ["an agent", `Hello {++there++}${meta("Agent")} {--you--}${meta("Agent")}\n`],
];
for (const [label, text] of SG_TEXTS) {
  test(`suggestions: ${label} come back unchanged and fit the schema`, () => {
    const d = markdownToDoc(text, D);
    schema.nodeFromJSON(d).check();
    assert.equal(docToMarkdown(d, D), text);
  });
}

test("suggestions: CriticMarkup is only text on a page that is not a document", () => {
  const nodes = inlineToNodes("Hello {++big ++}world");
  assert.ok(nodes.every((n) => (n.marks ?? []).length === 0));
});

test("suggestions: the text-level reader lists, counts and settles them the way a person's Accept all does", () => {
  const md = `One {++two++}${meta()} {--three--}${meta("Agent")} {~~four~>five~~}${meta()}\n\n\`\`\`\n{++kept++}\n\`\`\`\n`;
  assert.equal(countCritic(md), 3);
  assert.deepEqual(criticAuthors(md), ["Imran", "Agent"]);
  assert.deepEqual(
    listCritic(md).map((c) => c.kind),
    ["add", "del", "sub"],
  );
  assert.equal(resolveCritic(md, true), "One two  five\n\n```\n{++kept++}\n```\n");
  assert.equal(resolveCritic(md, false), "One  three four\n\n```\n{++kept++}\n```\n");
  assert.equal(resolveOneCritic(md, 0, true).startsWith("One two {--three--}"), true);
  assert.equal(writeCritic({ kind: "sub", old: "a", added: "b", author: "A|B", at: T }), `{~~a~>b~~}{>>A B|${T}<<}`);
});

/* ---------- tracked changes: the editor ---------- */

test("suggesting: typing is added as a suggestion with who and when, and typed text joins the run before it", () => {
  let s = caret(stateOf("Hello world\n"), 7);
  s = s.apply(s.tr.insertText("big", 7));
  assert.equal(mdOf(s), `Hello {++big++}${meta()}world\n`);
  s = s.apply(s.tr.insertText("!", 10));
  assert.equal(mdOf(s), `Hello {++big!++}${meta()}world\n`);
});

test("suggesting: deleting leaves the text, struck, and Backspace keeps the caret before it", () => {
  let s = caret(stateOf("Hello world\n"), 12);
  s = s.apply(s.tr.delete(11, 12));
  assert.equal(mdOf(s), `Hello worl{--d--}${meta()}\n`);
  assert.equal(s.selection.head, 11);
  let f = caret(stateOf("Hello world\n"), 7);
  f = f.apply(f.tr.delete(7, 8));
  assert.equal(mdOf(f), `Hello {--w--}${meta()}orld\n`);
  assert.equal(f.selection.head, 8);
});

test("suggesting: typing over a selection is one replacement; deleting your own suggestion really deletes it", () => {
  let s = stateOf("Hello world\n");
  s = s.apply(s.tr.insertText("planet", 7, 12));
  assert.equal(mdOf(s), `Hello {~~world~>planet~~}${meta()}\n`);
  assert.equal(listChanges(s.doc).length, 1);
  assert.equal(listChanges(s.doc)[0]?.kind, "sub");
  let t = stateOf("Hello world\n");
  t = t.apply(t.tr.insertText("big ", 7));
  t = t.apply(t.tr.delete(7, 11));
  assert.equal(mdOf(t), "Hello world\n");
});

test("suggesting: text that is already struck stays struck", () => {
  let s = stateOf("Hello world\n");
  s = s.apply(s.tr.delete(7, 8));
  const again = s.apply(s.tr.delete(7, 8));
  assert.equal(mdOf(again), mdOf(s));
});

test("suggesting is off: an edit is just an edit", () => {
  let s = stateOf("Hello world\n", false);
  s = s.apply(s.tr.insertText("big ", 7));
  assert.equal(mdOf(s), "Hello big world\n");
});

test("review: accept and reject each, or all, and nothing else on the page moves", () => {
  const md = `A {++b++}${meta()} {--c--}${meta()} {~~d~>e~~}${meta("Agent")} f\n`;
  const s = stateOf(md, false);
  const all = listChanges(s.doc);
  assert.deepEqual(
    all.map((c) => [c.kind, c.author]),
    [
      ["add", "Imran"],
      ["del", "Imran"],
      ["sub", "Agent"],
    ],
  );
  assert.equal(mdOf(s.apply(resolveChanges(s, true) as never)), "A b  e f\n");
  assert.equal(mdOf(s.apply(resolveChanges(s, false) as never)), "A  c d f\n");
  assert.equal(
    mdOf(s.apply(resolveChanges(s, true, [all[2] as never]) as never)),
    `A {++b++}${meta()} {--c--}${meta()} e f\n`,
  );
  assert.equal(
    mdOf(s.apply(resolveChanges(s, false, [all[0] as never]) as never)),
    `A  {--c--}${meta()} {~~d~>e~~}${meta("Agent")} f\n`,
  );
  assert.equal(resolveChanges(stateOf("plain\n", false), true), null);
});

test("review: a person who is suggesting does not turn Accept and Reject into new suggestions", () => {
  let s = stateOf(`A {--c--}${meta()} b\n`);
  s = s.apply(resolveChanges(s, true) as never);
  assert.equal(mdOf(s), "A  b\n");
});

test("review: a chip inside a suggestion is settled with it", () => {
  const s = stateOf(`Pay {++{fee}++}${meta()} now\n`, false);
  assert.equal(mdOf(s.apply(resolveChanges(s, true) as never)), "Pay {fee} now\n");
  assert.equal(mdOf(s.apply(resolveChanges(s, false) as never)), "Pay  now\n");
});

/* ---------- text that arrives while a person has the page open ---------- */

const now = (): string => T;
const merged = (
  s: EditorState,
  base: string,
  remote: string,
): { state: EditorState; clashed: boolean; clean: boolean } => {
  const m = mergeRemote(s, base, remote, { author: "Agent", now });
  assert.ok(m);
  return { state: s.apply(m.tr), clashed: m.clashed, clean: m.clean };
};

test("an agent streams a draft: the new blocks arrive, the caret above stays where it was", () => {
  const base = "# Plan\n\nFirst point\n";
  let s = caret(stateOf(base, false), 9);
  const head = s.selection.head;
  const remote = `${base}\nSecond point\n\nThird point\n`;
  const r = merged(s, base, remote);
  assert.equal(mdOf(r.state), remote);
  assert.equal(r.state.selection.head, head);
  assert.equal(r.clean, true);
  // and again, as the draft grows
  const more = `${remote}\nFourth\n`;
  const r2 = merged(r.state, remote, more);
  assert.equal(mdOf(r2.state), more);
  assert.equal(r2.state.selection.head, head);
});

test("an agent grows the block the person is in: the caret keeps its place in it", () => {
  const base = "alpha\n\nbeta\n";
  const s = caret(stateOf(base, false), 3);
  const r = merged(s, base, "alpha longer\n\nbeta\n");
  assert.equal(mdOf(r.state), "alpha longer\n\nbeta\n");
  assert.equal(r.state.selection.head, 3);
});

test("the person typed elsewhere: both changes are kept and nothing is a suggestion", () => {
  const base = "one\n\ntwo\n\nthree\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 1));
  const r = merged(s, base, "one\n\ntwo\n\nthree\n\nfour\n");
  assert.equal(mdOf(r.state), "Xone\n\ntwo\n\nthree\n\nfour\n");
  assert.equal(r.clashed, false);
  assert.equal(r.clean, false);
  // the other way round: the person edits below what the agent changed
  let u = stateOf(base, false);
  u = u.apply(u.tr.insertText("Y", 11));
  const r2 = merged(u, base, "ONE\n\ntwo\n\nthree\n");
  assert.equal(mdOf(r2.state), "ONE\n\ntwo\n\nYthree\n");
});

test("both edited the same block: the person's words stay and the agent's arrive as a suggestion", () => {
  const base = "one\n\ntwo\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 1));
  const r = merged(s, base, "ONE\n\ntwo\n");
  assert.equal(r.clashed, true);
  assert.equal(mdOf(r.state), `Xone\n\n{++ONE++}${meta("Agent")}\n\ntwo\n`);
  assert.equal(mdOf(r.state.apply(resolveChanges(r.state, false) as never)).startsWith("Xone"), true);
});

test("an agent's merge is not turned into the person's suggestion", () => {
  const base = "one\n";
  const s = stateOf(base, true);
  const r = merged(s, base, "one\n\ntwo\n");
  assert.equal(mdOf(r.state), "one\n\ntwo\n");
  assert.equal(mergeRemote(s, base, base, { author: "Agent", now }), null);
});

test("the agent suggests changes to existing text: they arrive as suggestions, whole-file text with CriticMarkup", () => {
  const base = "Hello world\n";
  const s = stateOf(base, false);
  const remote = `Hello {~~world~>planet~~}${meta("Agent")}\n`;
  const r = merged(s, base, remote);
  assert.equal(mdOf(r.state), remote);
  assert.equal(listChanges(r.state.doc)[0]?.author, "Agent");
});

/* ---------- a large document ---------- */

const big = (n: number): string => {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1)
    out.push(
      i % 40 === 0
        ? `## Section ${i / 40}\n`
        : `Paragraph ${i}: {client.name} agrees to pay {fee} under **clause ${i}**, with {++an addition++}${meta()} and a [link](https://example.com/${i}).\n`,
    );
  return out.join("\n");
};

test("a large document: 4,000 blocks with chips and suggestions load, come back unchanged and merge in a draft within the budget", () => {
  const text = big(4000);
  assert.ok(text.length > 400_000);
  let t0 = performance.now();
  const d = markdownToDoc(text, D);
  const back = docToMarkdown(d, D);
  const load = performance.now() - t0;
  assert.equal(back, text);
  assert.ok(load < 8000, `load and save took ${Math.round(load)} ms`);
  const s = stateOf(text, false);
  t0 = performance.now();
  const r = merged(s, text, `${text}\nOne more paragraph with {client.name}.\n`);
  const mergeMs = performance.now() - t0;
  assert.ok(mdOf(r.state).endsWith("One more paragraph with {client.name}.\n"));
  assert.ok(mergeMs < 8000, `a merge took ${Math.round(mergeMs)} ms`);
  t0 = performance.now();
  const list = listChanges(s.doc);
  assert.equal(list.length, 3900);
  assert.ok(performance.now() - t0 < 1000);
});

/* ---------- hostile text and the fill engine's grammar ---------- */

test("hostile text costs a pass, not a freeze: unclosed openers, a million spaces, deep nesting", () => {
  const cases = [
    "{~~a~>".repeat(20000),
    "{++".repeat(60000),
    "{--x".repeat(40000),
    `a${" ".repeat(200000)}b`,
    "{{{{".repeat(50000),
    "{>>".repeat(50000),
  ];
  const gap = " ".repeat(40000);
  cases.push(
    `# a${gap}b`,
    `- a${gap}b`,
    `> a${gap}b`,
    `1. a${gap}b`,
    `\`\`\`${gap}x`,
    `| a |\n| --- |\n| ${gap}x |`,
    "| " + "- |".repeat(20000),
  );
  for (const text of cases) {
    const t0 = performance.now();
    const d = markdownToDoc(`${text}\n`, D);
    docToMarkdown(d, D);
    countCritic(text);
    resolveCritic(text, true);
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${text.slice(0, 8)} took ${Math.round(ms)} ms`);
  }
});

test("a change with a long or broken who-and-when still reads, and a broken one is plain text", () => {
  assert.equal(countCritic(`{++a++}{>>${"x".repeat(900)}|t<<}`), 1);
  assert.equal(listCritic(`{++a++}{>>${"x".repeat(900)}|t<<}`)[0]?.author, "");
  assert.equal(countCritic("{++a+}"), 0);
  assert.equal(countCritic("{~~a~~}"), 0);
});

test("front matter and a page break come back unchanged", () => {
  const t = "---\ntitle: Service agreement\n---\n\nHi {client.name}\n\n{page:break}\n\nEnd\n";
  assert.equal(roundtrip(t), t);
});

test("the chip grammar is the fill engine's: the tag shapes here are the ones modules/documents/handlers/vdoc.ts reads", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../modules/documents/handlers/vdoc.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes("const TAG = /\\{([#^/]?)\\s*([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*|\\.)\\s*\\}/g;"),
    "vdoc.ts changed its tag grammar: update CHIP in mdtree.ts",
  );
  assert.ok(
    src.includes("const MARK = /\\{(sign|date):([A-Za-z0-9_]+)\\}/g;"),
    "vdoc.ts changed its signing marks: update CHIP in mdtree.ts",
  );
});
