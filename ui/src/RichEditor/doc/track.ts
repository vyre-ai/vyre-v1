// Tracked changes on the ProseMirror document: turning a person's edit into a suggestion, listing the suggestions, and accepting or rejecting them.
// No DOM is touched, so the same code is tested against a plain EditorState.
import type { Mark, MarkType, Node as PMNode, Slice } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
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
  /** what the edit removed, as it stood (any shape: text, a chip, text across paragraphs) */
  gone: Slice | null;
  /** where the removed range ended in the document before the edit */
  goneTo: number;
}

/**
 * The edit a person just made, as a suggestion: the text they typed carries "added", the text they deleted is put back with "removed". The caller runs this as an appended transaction
 * (see the Suggesting extension); it returns null when the edit is one it leaves alone (undo, a mark change, a restructure it cannot read).
 * Nothing a person deletes while suggesting is lost: text across paragraphs is struck in each paragraph and the paragraphs stay, a chip is struck, and a deletion that leaves nothing to strike
 * (the break between two paragraphs, an image) is put back as it was. Only a person's own earlier suggestion is really deleted; another author's pending suggestion is left as it is.
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
    // a lift or a wrap moves blocks and is left alone; any text deleted in the same transaction is still put back
    if (!(step instanceof ReplaceStep)) continue;
    const rest = tr.mapping.slice(i + 1);
    const s = rest.map(step.from, -1);
    const e = rest.map(step.from + step.slice.size, 1);
    ops.push({
      s,
      e,
      gone: step.to > step.from ? (tr.docs[i] as PMNode).slice(step.from, step.to) : null,
      goneTo: step.to,
    });
  }
  if (ops.length === 0) return null;
  const author = cleanAuthor(who.author);
  const at = who.now();
  const nt = after.tr;
  let changed = false;
  let struckEnd = -1;
  const own = (m: Mark): boolean => m.type === t.add && m.attrs["author"] === author;
  for (const op of [...ops].sort((a, b) => b.s - a.s)) {
    // the deleted text goes back first (before what was typed in its place), then is struck
    let size = 0;
    let fresh = false;
    if (op.gone && op.gone.size > 0) {
      try {
        nt.replace(op.s, op.s, op.gone);
      } catch {
        return null;
      }
      size = op.gone.size;
      changed = true;
      const after1 = nt.steps.length;
      const spans: Array<{ pos: number; node: PMNode }> = [];
      nt.doc.nodesBetween(op.s, op.s + size, (node, pos) => {
        if (node.isInline) spans.push({ pos, node });
        return true;
      });
      // from the end back, so a deletion does not move the places still to be read
      for (const { pos, node } of spans.reverse()) {
        const from = Math.max(pos, op.s);
        const to = Math.min(pos + node.nodeSize, op.s + size);
        if (to <= from) continue;
        if (node.marks.some(own)) nt.delete(from, to);
        else if (!node.marks.some((m) => m.type === t.add || m.type === t.del)) {
          nt.addMark(from, to, t.del.create({ author, at, sub: op.e > op.s }));
          fresh = true;
        }
      }
      struckEnd = nt.mapping.slice(after1).map(op.s + size, -1);
    }
    if (op.e > op.s) {
      const s2 = op.gone && op.gone.size > 0 ? struckEnd : op.s;
      const e2 = s2 + (op.e - op.s);
      const near = attrsOf(nt.doc.resolve(s2).nodeBefore?.marks.find(own));
      const next = attrsOf(nt.doc.resolve(e2).nodeAfter?.marks.find(own));
      nt.removeMark(s2, e2, t.del);
      nt.addMark(s2, e2, t.add.create(near ?? next ?? { author, at, sub: fresh }));
      changed = true;
    }
    if (op.e !== op.s) struckEnd = -1;
  }
  if (!changed) return null;
  // the caret: after what was typed; for a plain deletion, Backspace stays before the struck text and Delete moves past it
  const only = ops.length === 1 ? (ops[0] as Op) : null;
  if (nt.doc.eq(before.doc)) nt.setSelection(Selection.fromJSON(nt.doc, before.selection.toJSON()));
  else if (only && only.e === only.s && only.gone && struckEnd >= 0) {
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
  // text that fills a whole paragraph takes the paragraph with it (unless it is the last one), so settling a suggestion never leaves an empty line behind
  const drop = (from: number, to: number): void => {
    const $f = tr.doc.resolve(from);
    if ($f.parent.isTextblock && from === $f.start() && to === $f.end() && tr.doc.childCount > 1 && $f.depth === 1)
      tr.delete($f.before(), $f.after());
    else tr.delete(from, to);
  };
  for (const c of [...list].sort((a, b) => b.from - a.from)) {
    if (c.kind === "add") {
      if (accept) tr.removeMark(c.from, c.to, t.add);
      else drop(c.from, c.to);
    } else if (c.kind === "del") {
      if (accept) drop(c.from, c.to);
      else tr.removeMark(c.from, c.to, t.del);
    } else if (accept) {
      tr.removeMark(c.mid, c.to, t.add);
      drop(c.from, c.mid);
    } else {
      tr.removeMark(c.from, c.mid, t.del);
      drop(c.mid, c.to);
    }
  }
  tr.setMeta(SKIP, true);
  return tr;
}

/** The change in the document now that is the one a card was drawn for (the page may have moved since); undefined when it is gone. */
export function freshChange(doc: PMNode, c: Change): Change | undefined {
  const same = (x: Change): boolean =>
    x.kind === c.kind && x.author === c.author && x.at === c.at && x.old === c.old && x.added === c.added;
  const all = listChanges(doc).filter(same);
  return (
    all.find((x) => x.from === c.from) ?? all.sort((x, y) => Math.abs(x.from - c.from) - Math.abs(y.from - c.from))[0]
  );
}
