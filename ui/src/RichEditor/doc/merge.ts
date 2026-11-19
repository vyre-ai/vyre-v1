// What happens when the file changes under an open page: an agent is writing the draft, or another person saved. The page takes the new text in without losing the person's place or what they have typed.
// A three-way merge by blocks: `base` is the text the page last had in step with the file, `remote` is the new text, and the page's own document holds the person's edits since.
//   - the person has not edited: only the blocks that differ are replaced, so a streamed draft grows at its end and the caret, above or in it, stays put;
//   - the person edited elsewhere: both changes are kept;
//   - the person edited the same blocks: their words stay, and what the other side wrote there arrives as a suggestion, never over their text.
import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { markdownToDoc } from "../mdtree.ts";
import type { PMNode as Json } from "../mdtree.ts";
import { cleanAuthor } from "./critic.ts";
import { SKIP } from "./track.ts";

export interface MergeWho {
  /** who wrote the new text, for the suggestion a clash becomes */
  author: string;
  now: () => string;
}

export interface Merged {
  tr: Transaction;
  /** true when part of the new text clashed with the person's edit and came as a suggestion */
  clashed: boolean;
  /** true when the person had not edited, so the page now holds exactly the new text */
  clean: boolean;
}

const blocksOf = (md: string, schema: Schema): PMNode[] =>
  ((markdownToDoc(md, { doc: true }).content ?? []) as Json[]).map((b) => schema.nodeFromJSON(b));

/** Where two lists of blocks differ: the blocks they share at the start and at the end, so the middle is what changed. */
function span(a: readonly PMNode[], b: readonly PMNode[]): { from: number; aTo: number; bTo: number } {
  let p = 0;
  while (p < a.length && p < b.length && (a[p] as PMNode).eq(b[p] as PMNode)) p += 1;
  let q = 0;
  while (q < a.length - p && q < b.length - p && (a[a.length - 1 - q] as PMNode).eq(b[b.length - 1 - q] as PMNode))
    q += 1;
  return { from: p, aTo: a.length - q, bTo: b.length - q };
}

/** The same blocks with every piece of inline content marked as the other side's suggestion. */
function asSuggestion(nodes: readonly PMNode[], schema: Schema, who: MergeWho): PMNode[] {
  const add = schema.marks["suggestAdd"];
  if (!add) return [];
  const mark = add.create({ author: cleanAuthor(who.author), at: who.now() });
  const walk = (n: PMNode): PMNode => {
    if (n.isInline) return n.mark(mark.addToSet(n.marks));
    return n.copy(Fragment.fromArray(n.content.content.map(walk)));
  };
  return nodes.map(walk);
}

const startOf = (doc: PMNode, index: number): number => {
  let pos = 0;
  for (let i = 0; i < index && i < doc.childCount; i += 1) pos += doc.child(i).nodeSize;
  return pos;
};

/**
 * The transaction that brings `remote` into the page, or null when nothing differs. It never goes into the undo history and is never turned into a suggestion by Suggesting mode.
 */
export function mergeRemote(state: EditorState, base: string, remote: string, who: MergeWho): Merged | null {
  if (base === remote) return null;
  const schema = state.schema;
  const B = blocksOf(base, schema);
  const R = blocksOf(remote, schema);
  const L: PMNode[] = [];
  state.doc.forEach((n) => L.push(n));
  const r = span(B, R);
  const l = span(B, L);
  const incoming = R.slice(r.from, r.bTo);
  const localEdited = l.from < B.length || l.aTo > l.from || l.bTo > l.from;
  let clashed = false;
  let from: number;
  let to: number;
  let put: PMNode[];
  if (!localEdited) {
    from = r.from;
    to = r.aTo;
    put = incoming;
  } else {
    const rStart = r.from;
    const rEnd = r.aTo;
    const lStart = l.from;
    const lEnd = l.aTo;
    const both = rStart === rEnd && lStart === lEnd && rStart === lStart;
    if (!both && rEnd <= lStart) {
      from = rStart;
      to = rEnd;
      put = incoming;
    } else if (!both && lEnd <= rStart) {
      const delta = L.length - B.length;
      from = rStart + delta;
      to = rEnd + delta;
      put = incoming;
    } else {
      // the same blocks: the person's words stay, the other side's arrive as a suggestion after them
      clashed = true;
      from = to = L.length - (B.length - lEnd);
      put = asSuggestion(incoming, schema, who);
    }
  }
  if (from === to && put.length === 0) return null;
  if (put.length === 0 && from === 0 && to === L.length) put = [schema.nodes["paragraph"]?.create() as PMNode];
  const a = startOf(state.doc, from);
  const b = startOf(state.doc, to);
  const tr = state.tr.replaceWith(a, b, Fragment.fromArray(put));
  tr.setMeta(SKIP, true).setMeta("addToHistory", false).setMeta("vyre-remote", true);
  // a caret inside the blocks that were swapped keeps its block and its place in it, rather than jumping to the end of the new text
  const head = state.selection.head;
  if (state.selection.empty && head >= a && head <= b && put.length > 0) {
    let off = a;
    let i = from;
    while (i < to - 1 && off + state.doc.child(i).nodeSize <= head) {
      off += state.doc.child(i).nodeSize;
      i += 1;
    }
    const k = Math.min(i - from, put.length - 1);
    const within = Math.min(head - off, (put[k] as PMNode).nodeSize - 1);
    let at = a;
    for (let j = 0; j < k; j += 1) at += (put[j] as PMNode).nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + Math.max(1, within), tr.doc.content.size)), -1));
  }
  if (!localEdited) tr.setMeta("vyre-remote-clean", true);
  return { tr, clashed, clean: !localEdited };
}
