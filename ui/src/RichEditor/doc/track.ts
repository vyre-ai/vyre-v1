// Tracked changes on the ProseMirror document: turning a person's edit into a suggestion, listing the suggestions, and accepting or rejecting them.
// No DOM is touched, so the same code is tested against a plain EditorState.
import { Fragment } from "@tiptap/pm/model";
import type { Mark, MarkType, Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { cleanAuthor } from "./critic.ts";

/** A transaction with this meta is never turned into a suggestion (Accept and Reject, an agent's merge, a restore). */
export const SKIP = "vyre-suggest-skip";

export interface Who {
  author: string;
  now: () => string;
}

const sgTypes = (state: EditorState): { add: MarkType; del: MarkType } | null => {
  const add = state.schema.marks["suggestAdd"];
  const del = state.schema.marks["suggestDel"];
  return add && del ? { add, del } : null;
};

const attrsOf = (m: Mark | undefined): { author: string; at: string; sub: boolean } | null =>
  m ? { author: String(m.attrs["author"] ?? ""), at: String(m.attrs["at"] ?? ""), sub: m.attrs["sub"] === true } : null;

interface Op {
  /** where the changed range starts and ends in the document after the edit */
  s: number;
  e: number;
  /** what the edit removed, when it was plain text inside one block */
  removed: Fragment | null;
  /** where the removed range ended in the document before the edit */
  goneTo: number;
}

/**
 * The edit a person just made, as a suggestion: the text they typed carries "added", the text they deleted is put back with "removed". The caller runs this as an appended transaction
 * (see the Suggesting extension); it returns null when the edit is one it leaves alone (undo, a mark change, a restructure of blocks).
 */
export function trackTransaction(
  tr: Transaction,
  before: EditorState,
  after: EditorState,
  who: Who,
): Transaction | null {
  const t = sgTypes(after);
  if (!t || !tr.docChanged) return null;
  if (
    tr.getMeta(SKIP) === true ||
    tr.getMeta("history$") ||
    tr.getMeta("appendedTransaction") ||
    tr.getMeta("addToHistory") === false
  )
    return null;
  const ops: Op[] = [];
  for (let i = 0; i < tr.steps.length; i += 1) {
    const step = tr.steps[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) continue;
    if (!(step instanceof ReplaceStep)) return null;
    const rest = tr.mapping.slice(i + 1);
    const s = rest.map(step.from, -1);
    const e = rest.map(step.from + step.slice.size, 1);
    const gone = (tr.docs[i] as PMNode).slice(step.from, step.to);
    const inline =
      gone.openStart === 0 &&
      gone.openEnd === 0 &&
      gone.content.childCount > 0 &&
      gone.content.content.every((c) => c.isInline);
    ops.push({ s, e, removed: step.to > step.from && inline ? gone.content : null, goneTo: step.to });
  }
  if (ops.length === 0) return null;
  const author = cleanAuthor(who.author);
  const at = who.now();
  const nt = after.tr;
  let changed = false;
  let struckEnd = -1;
  for (const op of [...ops].sort((a, b) => b.s - a.s)) {
    // the struck text to put back: what the person deleted, except their own earlier suggestions (those are really deleted) and what was already struck
    const keep: PMNode[] = [];
    let fresh = false;
    op.removed?.forEach((c) => {
      if (c.marks.some((m) => m.type === t.add)) return;
      if (c.marks.some((m) => m.type === t.del)) {
        keep.push(c);
        return;
      }
      fresh = true;
      keep.push(c.mark(c.marks.concat(t.del.create({ author, at, sub: op.e > op.s }))));
    });
    if (op.e > op.s) {
      const own = (m: Mark): boolean => m.type === t.add && m.attrs["author"] === author;
      const near = attrsOf(nt.doc.resolve(op.s).nodeBefore?.marks.find(own));
      const next = attrsOf(nt.doc.resolve(op.e).nodeAfter?.marks.find(own));
      nt.removeMark(op.s, op.e, t.del);
      nt.addMark(op.s, op.e, t.add.create(near ?? next ?? { author, at, sub: fresh }));
      changed = true;
    }
    if (keep.length > 0) {
      nt.insert(op.s, Fragment.from(keep));
      changed = true;
      if (op.e === op.s) struckEnd = op.s + keep.reduce((n, c) => n + c.nodeSize, 0);
    }
  }
  if (!changed) return null;
  // the caret: after what was typed; for a plain deletion, Backspace stays before the struck text and Delete moves past it
  const only = ops.length === 1 ? (ops[0] as Op) : null;
  if (only && only.e === only.s && struckEnd >= 0) {
    const backspace = before.selection.empty && before.selection.head === only.goneTo;
    nt.setSelection(TextSelection.create(nt.doc, backspace ? only.s : struckEnd));
  } else nt.setSelection(after.selection.map(nt.doc, nt.mapping));
  nt.setMeta(SKIP, true);
  return nt;
}

/* ---------- the list of suggestions ---------- */

export interface Change {
  kind: "add" | "del" | "sub";
  /** the whole change; for a replacement, `mid` is where the removed text ends and the added text begins */
  from: number;
  to: number;
  mid: number;
  author: string;
  at: string;
  /** what was removed and what was added */
  old: string;
  added: string;
}

interface Run {
  kind: "add" | "del";
  from: number;
  to: number;
  author: string;
  at: string;
  sub: boolean;
  text: string;
}

/** The suggestions of a document in reading order. Neighbouring text with the same suggestion is one change; a removal followed at once by its replacement is one replacement. */
export function listChanges(doc: PMNode): Change[] {
  const runs: Run[] = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const m = node.marks.find((x) => x.type.name === "suggestAdd" || x.type.name === "suggestDel");
    if (!m) return false;
    const kind = m.type.name === "suggestAdd" ? "add" : "del";
    const a = attrsOf(m) as { author: string; at: string; sub: boolean };
    const last = runs[runs.length - 1];
    const text = node.isText ? (node.text ?? "") : "￼";
    if (
      last &&
      last.kind === kind &&
      last.to === pos &&
      last.author === a.author &&
      last.at === a.at &&
      last.sub === a.sub
    ) {
      last.to = pos + node.nodeSize;
      last.text += text;
    } else runs.push({ kind, from: pos, to: pos + node.nodeSize, author: a.author, at: a.at, sub: a.sub, text });
    return false;
  });
  const out: Change[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const r = runs[i] as Run;
    const n = runs[i + 1];
    if (
      r.kind === "del" &&
      r.sub &&
      n &&
      n.kind === "add" &&
      n.sub &&
      n.from === r.to &&
      n.author === r.author &&
      n.at === r.at
    ) {
      out.push({
        kind: "sub",
        from: r.from,
        to: n.to,
        mid: r.to,
        author: r.author,
        at: r.at,
        old: r.text,
        added: n.text,
      });
      i += 1;
    } else
      out.push({
        kind: r.kind,
        from: r.from,
        to: r.to,
        mid: r.to,
        author: r.author,
        at: r.at,
        old: r.kind === "del" ? r.text : "",
        added: r.kind === "add" ? r.text : "",
      });
  }
  return out;
}

/** The suggestion the caret is in or against, if any. */
export const changeAt = (changes: readonly Change[], pos: number): Change | undefined =>
  changes.find((c) => pos >= c.from && pos <= c.to);

/** A transaction that accepts or rejects some of the suggestions (all of them when `which` is left out). Nothing else on the page changes. */
export function resolveChanges(state: EditorState, accept: boolean, which?: readonly Change[]): Transaction | null {
  const t = sgTypes(state);
  if (!t) return null;
  const list = which ?? listChanges(state.doc);
  if (list.length === 0) return null;
  const tr = state.tr;
  for (const c of [...list].sort((a, b) => b.from - a.from)) {
    if (c.kind === "add") {
      if (accept) tr.removeMark(c.from, c.to, t.add);
      else tr.delete(c.from, c.to);
    } else if (c.kind === "del") {
      if (accept) tr.delete(c.from, c.to);
      else tr.removeMark(c.from, c.to, t.del);
    } else if (accept) {
      tr.removeMark(c.mid, c.to, t.add);
      tr.delete(c.from, c.mid);
    } else {
      tr.removeMark(c.from, c.mid, t.del);
      tr.delete(c.mid, c.to);
    }
  }
  tr.setMeta(SKIP, true);
  return tr;
}

/** "just now", "5 min ago", "3 h ago", "19 Nov": when a suggestion was made, for the card on it. */
export function whenText(at: string, now: Date = new Date()): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
