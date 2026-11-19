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
import { isOwnEcho, mergeRemote, noteSent } from "../ui/src/RichEditor/doc/merge.ts";

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

test("both edited the same block: the person's words stay struck-and-kept beside the agent's, never twice", () => {
  const base = "one\n\ntwo\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 1));
  const r = merged(s, base, "ONE\n\ntwo\n");
  assert.equal(r.clashed, true);
  assert.equal(mdOf(r.state), `{--Xone--}${meta("Agent")}\n\n{++ONE++}${meta("Agent")}\n\ntwo\n`);
  assert.equal(mdOf(r.state.apply(resolveChanges(r.state, true) as never)), "ONE\n\ntwo\n");
  assert.equal(mdOf(r.state.apply(resolveChanges(r.state, false) as never)), "Xone\n\ntwo\n");
});

test("the person edited the top and the bottom, the agent the middle: no clash, all three kept", () => {
  const base = "a\n\nb\n\nc\n\nd\n\ne\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 1));
  s = s.apply(s.tr.insertText("Y", s.doc.content.size - 1));
  const r = merged(s, base, "a\n\nb\n\nC\n\nd\n\ne\n");
  assert.equal(r.clashed, false);
  assert.equal(mdOf(r.state), "Xa\n\nb\n\nC\n\nd\n\neY\n");
});

test("the agent deletes a block the person is editing: their words stay, struck, and Reject keeps them", () => {
  const base = "one\n\ntwo\n\nthree\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 6));
  const r = merged(s, base, "one\n\nthree\n");
  assert.equal(r.clashed, true);
  assert.equal(mdOf(r.state), `one\n\n{--Xtwo--}${meta("Agent")}\n\nthree\n`);
  assert.equal(mdOf(r.state.apply(resolveChanges(r.state, true) as never)), "one\n\nthree\n");
  assert.equal(mdOf(r.state.apply(resolveChanges(r.state, false) as never)), "one\n\nXtwo\n\nthree\n");
});

test("the file giving back the page's own save is recognised by its save id, a revert never is", () => {
  const sent: string[] = [];
  const ids = new Set<string>();
  noteSent(sent, ids, "T1\n", "s1");
  noteSent(sent, ids, "T2\n", "s2");
  // with ids: only a save this page issued is its own, whatever the text; anything else is news even when its text was sent before
  assert.equal(isOwnEcho("T1\n", "s1", ids, sent), true);
  assert.equal(isOwnEcho("T1\n", null, ids, sent), false, "T1 written back by someone else while s2 is in flight");
  assert.equal(isOwnEcho("T2\n", "s9", ids, sent), false);
  // without ids: the latest text only
  assert.equal(isOwnEcho("T2\n", undefined, ids, sent), true);
  assert.equal(isOwnEcho("T1\n", undefined, ids, sent), false);
  assert.equal(isOwnEcho("x", undefined, new Set(), []), false);
  for (let i = 0; i < 100; i += 1) noteSent(sent, ids, `t${i}\n`, `n${i}`);
  assert.equal(sent.length <= 64 && ids.size <= 64, true);
});

test("a revert to older text from another source while saves are in flight is merged into the page", () => {
  const T1 = "one\n";
  const T2 = "one\n\ntwo\n";
  const s = stateOf(T2, false);
  const m = mergeRemote(s, T2, T1, { author: "Agent", now });
  assert.ok(m);
  assert.equal(mdOf(s.apply(m.tr)), T1);
});

test("suggesting: text deleted across two paragraphs is struck in each, and the paragraphs stay", () => {
  let s = stateOf("ab\n\ncd\n");
  s = s.apply(s.tr.delete(2, 6));
  assert.equal(mdOf(s), `a{--b--}${meta()}\n\n{--c--}${meta()}d\n`);
});

test("suggesting: a deleted chip is struck, the break between paragraphs is put back, another author's suggestion is left alone", () => {
  let s = stateOf("Pay {fee} now\n");
  s = s.apply(s.tr.delete(5, 6));
  assert.equal(mdOf(s), `Pay {--{fee}--}${meta()} now\n`);
  let j = stateOf("ab\n\ncd\n");
  j = j.apply(j.tr.join(4));
  assert.equal(mdOf(j), "ab\n\ncd\n");
  const theirs = `a {++b++}${meta("Agent")} c\n`;
  let o = stateOf(theirs);
  o = o.apply(o.tr.delete(3, 4));
  assert.equal(mdOf(o), theirs);
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
  assert.ok(load < 3000, `load and save took ${Math.round(load)} ms`);
  const s = stateOf(text, false);
  t0 = performance.now();
  const r = merged(s, text, `${text}\nOne more paragraph with {client.name}.\n`);
  const mergeMs = performance.now() - t0;
  assert.ok(mdOf(r.state).endsWith("One more paragraph with {client.name}.\n"));
  assert.ok(mergeMs < 3000, `a merge took ${Math.round(mergeMs)} ms`);
  t0 = performance.now();
  const list = listChanges(s.doc);
  assert.equal(list.length, 3900);
  assert.ok(performance.now() - t0 < 1000);
});

/* ---------- hostile text and the fill engine's grammar ---------- */

/** Hostile texts: each is about 100 KB of something that looks like the start of markup and never finishes it, or of one very long line. */
const HOSTILE: Record<string, string> = {
  "unclosed replacement": "{~~a~>".repeat(17000),
  "unclosed addition": "{++".repeat(33000),
  "unclosed removal": "{--x".repeat(25000),
  "who-and-when never closed": "{++a++}{>>".repeat(10000),
  braces: "{{{{".repeat(25000),
  "a long run of spaces": `a${" ".repeat(100000)}b`,
  "unclosed bold": `${"**a ".repeat(25000)}b`,
  "unclosed underscore bold": `x${" __a ".repeat(20000)}y`,
  "unclosed strike": `${"~~a ".repeat(25000)}b`,
  "unclosed italic": `${"*a ".repeat(33000)}b`,
  "unclosed underscore italic": `x${" _a ".repeat(25000)}y`,
  "unclosed links": "[a".repeat(50000),
  "links with no end": "[a](x".repeat(20000),
  "links ending in a space": `${"[a](x".repeat(15000)} y`,
  "images with no end": "![a](x".repeat(15000),
  "titles never closed": '[a](x "'.repeat(12000),
  backticks: "`a".repeat(50000),
  "a long heading": `# a${" ".repeat(100000)}b`,
  "a long list item": `- a${" ".repeat(100000)}b`,
  "a long quote": `> a${" ".repeat(100000)}b`,
  "a long numbered item": `1. a${" ".repeat(100000)}b`,
  "a long fence line": `\`\`\`${"a".repeat(100000)}\nx\n\`\`\``,
  "a table cell": `| a |\n| --- |\n| ${" ".repeat(100000)}x |`,
  "table separators": `| ${"- |".repeat(30000)}`,
  "openers before a fence, closer after": `${"{++a".repeat(25000)}\n\`\`\`\nx\n\`\`\`\n++}`,
  "a rule": `${"- ".repeat(50000)}x`,
  pipes: "|".repeat(100000),
  "a tag with a long gap": `{${" ".repeat(100000)}x}`,
};
for (const [label, text] of Object.entries(HOSTILE)) {
  test(`hostile text, ${label}: read, saved, counted and settled each in under 100 ms`, () => {
    const body = `${text}\n`;
    // the best of three runs: a shared box has other work on it, and a freeze is a cost every run pays
    const bound = (what: string, f: () => unknown): void => {
      let best = Infinity;
      for (let k = 0; k < 3; k += 1) {
        const t0 = performance.now();
        f();
        best = Math.min(best, performance.now() - t0);
      }
      assert.ok(best < 100, `${what} took ${Math.round(best)} ms`);
    };
    // what is valid Markdown comes back exactly as it went in
    // every hostile case that is valid Markdown comes back exactly as written
    assert.equal(roundtrip(body), body, "round trip");
    let d = markdownToDoc("x\n", D);
    bound("reading", () => {
      d = markdownToDoc(body, D);
    });
    bound("saving", () => docToMarkdown(d, D));
    bound("counting", () => countCritic(body));
    bound("settling", () => resolveCritic(body, true));
  });
}

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

test("a very long heading, list item, quote and numbered item come back exactly as written", () => {
  const long = `${"word ".repeat(2000)}end`;
  for (const t of [
    `# ${long}\n`,
    `## ${long}\n`,
    `- ${long}\n`,
    `> ${long}\n`,
    `1. ${long}\n`,
    `- [ ] ${long}\n`,
    `${long}\n`,
  ]) {
    assert.equal(roundtrip(t), t);
    const plain = docToMarkdown(markdownToDoc(t));
    assert.equal(plain, t);
  }
  assert.equal(markdownToDoc(`# ${long}\n`, D).content?.[0]?.type, "heading");
  assert.equal(markdownToDoc(`> ${long}\n`, D).content?.[0]?.type, "blockquote");
  assert.equal(markdownToDoc(`- ${long}\n`, D).content?.[0]?.type, "bulletList");
});

test("heading forms still read the way they did: closing marks, empty headings, seven hashes", () => {
  const cases: Array<[string, string, string]> = [
    ["# Title\n", "heading", "Title"],
    ["## Title ##\n", "heading", "Title"],
    ["###   Title   \n", "heading", "Title"],
    ["# #\n", "heading", "#"],
    ["# foo#\n", "heading", "foo#"],
    ["#######  x\n", "paragraph", "#######  x"],
    ["#nospace\n", "paragraph", "#nospace"],
  ];
  for (const [md, type, text] of cases) {
    const n = markdownToDoc(md).content?.[0];
    assert.equal(n?.type, type, md);
    assert.equal((n?.content ?? []).map((c) => c.text).join(""), text, md);
  }
});

test("links and images still read the way they did", () => {
  const nodes = inlineToNodes(
    'See [the site](https://example.com "Home") and ![pic](a.png) and [broken](x y) and [a](b',
    D,
  );
  assert.equal(nodes[1]?.marks?.[0]?.type, "link");
  assert.equal(nodes[1]?.marks?.[0]?.attrs?.["href"], "https://example.com");
  assert.equal(nodes[1]?.marks?.[0]?.attrs?.["title"], "Home");
  assert.equal(nodes.map((n) => n.text).join(""), "See the site and ![pic](a.png) and [broken](x y) and [a](b");
});

test("the person typed a block right after the block the agent rewrites or deletes: their block survives", () => {
  const base = "one\n\ntwo\n\nthree\n";
  // the person adds a paragraph after "two"
  const withNew = (): EditorState => {
    const s = stateOf(base, false);
    const end = s.doc.child(0).nodeSize + s.doc.child(1).nodeSize;
    return s.apply(s.tr.insert(end, schema.nodes["paragraph"]!.create(null, schema.text("mine"))));
  };
  const rewritten = merged(withNew(), base, "one\n\nTWO\n\nthree\n");
  assert.equal(mdOf(rewritten.state), "one\n\nTWO\n\nmine\n\nthree\n");
  assert.equal(rewritten.clashed, false);
  const deleted = merged(withNew(), base, "one\n\nthree\n");
  assert.equal(mdOf(deleted.state), "one\n\nmine\n\nthree\n");
});

test("a clash that brings a code block in: the block arrives, no error", () => {
  const base = "one\n\ntwo\n";
  let s = stateOf(base, false);
  s = s.apply(s.tr.insertText("X", 1));
  const r = merged(s, base, "ONE\n\n```js\nlet a = 1;\n```\n\ntwo\n");
  assert.equal(r.clashed, true);
  assert.ok(mdOf(r.state).includes("```js\nlet a = 1;\n```"));
  assert.ok(mdOf(r.state).includes("{--Xone--}"));
});

test("many scattered clashes are settled in a pass, not in cubed time", () => {
  const n = 1500;
  const base = Array.from({ length: n }, (_v, i) => `block ${i}`).join("\n\n") + "\n";
  const local = Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? `mine ${i}` : `block ${i}`)).join("\n\n") + "\n";
  const remote = Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? `theirs ${i}` : `block ${i}`)).join("\n\n") + "\n";
  const s = EditorState.create({ schema, doc: schema.nodeFromJSON(markdownToDoc(local, D)) });
  const t0 = performance.now();
  const m = mergeRemote(s, base, remote, { author: "Agent", now });
  const ms = performance.now() - t0;
  assert.ok(m && m.clashed);
  assert.ok(ms < 1500, `a merge of ${n} clashes took ${Math.round(ms)} ms`);
});

test("lists and quotes nested past the reading depth lose nothing and settle after one save", () => {
  for (const t of [
    `${"- ".repeat(60)}x\n`,
    `${"> ".repeat(60)}x\n`,
    `${"1. ".repeat(40)}x\n`,
    `a\n\n${"- ".repeat(30)}x\n\nb\n`,
  ]) {
    const once = roundtrip(t);
    assert.equal(roundtrip(once), once, "saving twice changes nothing");
    assert.ok(once.includes("x"));
  }
  // the deepest levels are kept as written, not escaped into text
  const deep = `${"> ".repeat(60)}x\n`;
  assert.equal(roundtrip(deep), deep);
  assert.ok(!roundtrip(`${"- ".repeat(60)}x\n`).includes("\\-"));
});

test("a change does not reach across a blank line: the text readers see what the editor sees", () => {
  assert.equal(countCritic("{++a\n\nb++}"), 0);
  assert.equal(countCritic("{++a\nb++}"), 1);
  assert.equal(resolveCritic("{++a\n\nb++}", true), "{++a\n\nb++}");
});

test("a transaction that restructures and also deletes text still keeps the text", () => {
  let s = stateOf("ab\n");
  const tr = s.tr.delete(2, 3).setNodeMarkup(0, schema.nodes["heading"], { level: 1 });
  s = s.apply(tr);
  assert.equal(mdOf(s), `# a{--b--}${meta()}\n`);
});

test("a list nested 300 levels deep, and a quote 5,000 deep, come back exactly and read in time", () => {
  const deep = Array.from({ length: 300 }, (_v, i) => `${"  ".repeat(i)}- level ${i}`).join("\n") + "\n";
  const quotes = `${"> ".repeat(5000)}x\n`;
  for (const t of [deep, quotes]) {
    const t0 = performance.now();
    assert.equal(roundtrip(t), t);
    assert.ok(performance.now() - t0 < 1000, "read and save in under a second");
  }
});

test("lists and quotes opened on the marker's line come back as written, at depth 2 and depth 50", () => {
  for (const n of [2, 3, 50])
    for (const mk of ["- ", "1. ", "* ", "> "]) {
      const t = `${mk.repeat(n)}x\n`;
      assert.equal(roundtrip(t), t, `${n} x ${mk}`);
      assert.equal(docToMarkdown(markdownToDoc(t)), t, `plain ${n} x ${mk}`);
    }
  for (const t of ["- > q\n", "1. - x\n     more\n", "- [ ] - x\n", "- - a\n  - b\n- c\n", "a\n\n- - x\n\nb\n"])
    assert.equal(roundtrip(t), t, t);
  schema.nodeFromJSON(markdownToDoc(`${"- ".repeat(50)}x\n`, D)).check();
});

test("the person deleted a block the agent rewrites: the rewrite arrives as a suggestion, no other block is struck", () => {
  const base = "A\n\nB\n";
  const s0 = stateOf(base, false);
  const s = s0.apply(s0.tr.delete(0, s0.doc.child(0).nodeSize));
  assert.equal(mdOf(s), "B\n");
  const r = merged(s, base, "A2\n\nB\n");
  assert.equal(r.clashed, true);
  assert.equal(mdOf(r.state), `{++A2++}${meta("Agent")}\n\nB\n`);
});

test("person and agent each add a block at the same place: both stay, the agent's as a suggestion after the person's", () => {
  const base = "A\n\nB\n";
  const s0 = stateOf(base, false);
  const s = s0.apply(
    s0.tr.insert(s0.doc.child(0).nodeSize, schema.nodes["paragraph"]!.create(null, schema.text("mine"))),
  );
  const r = merged(s, base, "A\n\ntheirs\n\nB\n");
  assert.equal(r.clashed, true);
  assert.equal(mdOf(r.state), `A\n\nmine\n\n{++theirs++}${meta("Agent")}\n\nB\n`);
});
