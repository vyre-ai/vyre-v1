// Talk's words in the chat field (ChatField on the shared editor): interim and final words go in at the caret, a mention chip before or after the caret comes through as it was, and Undo takes all the spoken
// words back as one step. The editor's own state and history plugin run here without a browser; the same transactions are what ChatField dispatches (chatnode.ts replaceDoc and endTalk).
import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { chatDoc, chatText, offsetToPos } from "./chatdoc.ts";
import type { ChatNode } from "./chatdoc.ts";
import { chatExtensions, endTalk, replaceDoc } from "./chatnode.ts";
import { placed } from "./talk.ts";

const schema = getSchema(chatExtensions());
const chips = (d: ChatNode): string[] => (d.content?.[0]?.content ?? []).filter((n) => n.type === "chip").map((n) => String(n.attrs?.["label"]));
const start = (text: string, ranges: { start: number; end: number; kind: string }[]): EditorState => EditorState.create({ doc: schema.nodeFromJSON(chatDoc(text, ranges)), plugins: [history()] });
const docOf = (s: EditorState): ChatNode => s.doc.toJSON() as ChatNode;

/** One Talk session over the field: what Talk's composer glue does on each result, then what ChatField does when it stops. */
function session(text: string, ranges: { start: number; end: number; kind: string }[], caret: number, heard: string[]): { states: EditorState[]; before: ChatNode; after: EditorState } {
  let s = start(text, ranges);
  const before = docOf(s);
  const anchor = { before: text.slice(0, caret), after: text.slice(caret) };
  const states: EditorState[] = [];
  for (const all of heard) {
    const at = placed(anchor, all);
    // the chips after the caret move by what was added
    const grown = at.text.length - text.length;
    const rs = ranges.map((r) => (r.start >= caret ? { ...r, start: r.start + grown, end: r.end + grown } : r));
    s = s.apply(replaceDoc(s, chatDoc(at.text, rs), false, offsetToPos(chatDoc(at.text, rs), at.cursor)));
    states.push(s);
  }
  const end = endTalk(s, before);
  assert.ok(end, "something changed");
  s = s.apply(end.back);
  s = s.apply(end.forward(s));
  return { states, before, after: s };
}

test("interim then final words land at the caret after a chip, the chip stays one chip, the words stay out of the history until Talk stops", () => {
  const text = "Hi @Maya  please check";
  const r = session(text, [{ start: 3, end: 8, kind: "mention" }], 9, ["send", "send the lease", "send the lease draft"]);
  assert.deepEqual(r.states.map((s) => chatText(docOf(s))), ["Hi @Maya send please check", "Hi @Maya send the lease please check", "Hi @Maya send the lease draft please check"]);
  for (const s of r.states) { assert.deepEqual(chips(docOf(s)), ["@Maya"]); assert.equal(undoDepth(s), 0, "while it listens nothing is in the history"); }
  assert.equal(chatText(docOf(r.after)), "Hi @Maya send the lease draft please check");
  assert.deepEqual(chips(docOf(r.after)), ["@Maya"]);
  assert.equal(undoDepth(r.after), 1, "one step for everything spoken");
});

test("words before a chip move the chip with the text, and it stays whole", () => {
  const text = "ask @Omar now";
  const r = session(text, [{ start: 4, end: 9, kind: "mention" }], 4, ["and", "and also", "and also remind"]);
  for (const s of r.states) assert.deepEqual(chips(docOf(s)), ["@Omar"]);
  assert.equal(chatText(docOf(r.after)), "ask and also remind @Omar now");
  assert.deepEqual(chips(docOf(r.after)), ["@Omar"]);
});

test("Undo is one step back to what was there before Talk, Redo brings every word back, chips unharmed", () => {
  const r = session("Hi @Maya  please", [{ start: 3, end: 8, kind: "mention" }], 9, ["send", "send it today", "send it today please"]);
  let s = r.after;
  let next: EditorState | null = null;
  assert.ok(undo(s, (tr) => { next = s.apply(tr); }));
  s = next!;
  assert.deepEqual(docOf(s), r.before, "the field is exactly as it was before Talk");
  assert.deepEqual(chips(docOf(s)), ["@Maya"]);
  assert.equal(undo(s, () => undefined), false, "no second step: one undo took all the words");
  assert.ok(redo(s, (tr) => { next = s.apply(tr); }));
  assert.equal(chatText(docOf(next!)), "Hi @Maya send it today please please");
  assert.deepEqual(chips(docOf(next!)), ["@Maya"]);
});

test("a session that adds nothing leaves no history step", () => {
  const s = start("hello", []);
  assert.equal(endTalk(s, docOf(s)), null);
  assert.equal(undoDepth(s), 0);
});
