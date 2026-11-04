// The chat field's TipTap pieces: a paragraph of text, hard breaks, history and the mention chip, an inline atom whose text is the mention's own words. Loaded when a field mounts.
import { Node } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { ChatNode } from "./chatdoc.ts";

export const Chip = Node.create({
  name: "chip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { label: { default: "" }, kind: { default: "mention" } }; },
  parseHTML() { return [{ tag: "span.vyre-chip" }]; },
  renderHTML({ node }) { return ["span", { class: "vyre-chip", "data-kind": String(node.attrs["kind"] ?? "mention") }, String(node.attrs["label"] ?? "")]; },
  renderText({ node }) { return String(node.attrs["label"] ?? ""); },
});

/**
 * Replace the whole document, with a say in whether the change joins the undo history. Words that Talk puts in the field change the document many times a second (each interim result), so while it
 * listens every change is kept out of the history (addToHistory false), and when it stops the field goes back to what it was before (also out of the history) and then to what it is now (in the history):
 * that is one step, and Undo takes all the spoken words back at once. Chips are in the document as nodes, so they come through as they were.
 */
export function replaceDoc(state: EditorState, doc: ChatNode, history: boolean, caretPos?: number): Transaction {
  const tr = state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(doc).content).setMeta("addToHistory", history);
  if (caretPos !== undefined) tr.setSelection(TextSelection.create(tr.doc, Math.max(1, Math.min(caretPos, tr.doc.content.size - 1))));
  return tr;
}

/** Talk stopped: two transactions that leave one undo step from `before` to the document as it is now. Null when nothing changed. */
export function endTalk(state: EditorState, before: ChatNode): { back: Transaction; forward: (s: EditorState) => Transaction } | null {
  const now = state.doc.toJSON() as ChatNode;
  if (JSON.stringify(now) === JSON.stringify(before)) return null;
  const caret = state.selection.from;
  return { back: replaceDoc(state, before, false), forward: (s) => replaceDoc(s, now, true, caret) };
}

export const chatExtensions = (): Extensions => [Document, Paragraph, Text, HardBreak, History, Chip];
