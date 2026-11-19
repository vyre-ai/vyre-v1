// What happens when the file changes under an open page: an agent is writing the draft, or another person saved. The page takes the new text in without losing the person's place or what they have typed.
// A three-way merge by blocks: `base` is the text the file last held as far as the other side is concerned, `remote` is the new text, and the page's own document holds the person's edits since.
// Each side's changes are found as separate hunks of blocks (a longest-common-blocks diff), so an edit at the top and another at the bottom are two changes, not one big one in between.
//   - a hunk of the new text that touches none of the person's edits is applied where it belongs (a streamed draft grows at its end, the caret above or inside it stays put);
//   - a hunk that touches a block the person edited never replaces their words: their version of those blocks is struck through and the new text arrives after it as a suggestion,
//     so accepting takes the new text, rejecting keeps theirs, and nothing is written twice.
// A merge never goes into the undo history and is never read by Suggesting mode as the person's own edit.
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

/** x[a..b) became y[c..d). */
interface Hunk {
  a: number;
  b: number;
  c: number;
  d: number;
}

const MAX_CELLS = 4_000_000;

/** Where two lists differ: the shared start and end are cut off, the middle is matched by longest common run, and each stretch that does not match is one hunk. A middle too big to match is one hunk. */
export function hunks(x: readonly string[], y: readonly string[]): Hunk[] {
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p += 1;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q += 1;
  const n = x.length - p - q;
  const m = y.length - p - q;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) return [{ a: p, b: p + n, c: p, d: p + m }];
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      lcs[i * w + j] =
        x[p + i] === y[p + j]
          ? (lcs[(i + 1) * w + j + 1] as number) + 1
          : Math.max(lcs[(i + 1) * w + j] as number, lcs[i * w + j + 1] as number);
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = (): void => {
    if (open) out.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[p + i] === y[p + j]) {
      close();
      i += 1;
      j += 1;
    } else {
      if (!open) open = { a: p + i, b: p + i, c: p + j, d: p + j };
      if (j >= m || (i < n && (lcs[(i + 1) * w + j] as number) >= (lcs[i * w + j + 1] as number))) {
        i += 1;
        open.b = p + i;
      } else {
        j += 1;
        open.d = p + j;
      }
    }
  }
  close();
  return out;
}

const touches = (h: Hunk, g: Hunk): boolean =>
  (h.a < g.b && g.a < h.b) ||
  (h.a === h.b && g.a < h.a && h.a < g.b) ||
  (g.a === g.b && h.a < g.a && g.a < h.b) ||
  (h.a === h.b && g.a === g.b && h.a === g.a);

const startOf = (doc: PMNode, index: number): number => {
  let pos = 0;
  for (let i = 0; i < index && i < doc.childCount; i += 1) pos += doc.child(i).nodeSize;
  return pos;
};

/** The same blocks with every piece of inline content marked as the other side's suggested addition. */
function asSuggestion(nodes: readonly PMNode[], schema: Schema, who: MergeWho): PMNode[] {
  const add = schema.marks["suggestAdd"];
  if (!add) return [];
  const mark = add.create({ author: cleanAuthor(who.author), at: who.now() });
  const walk = (n: PMNode): PMNode =>
    n.isInline ? n.mark(mark.addToSet(n.marks)) : n.copy(Fragment.fromArray(n.content.content.map(walk)));
  return nodes.map(walk);
}

interface Op {
  /** the blocks of the page this replaces (or, for a clash, strikes and follows) */
  from: number;
  to: number;
  nodes: PMNode[];
  clash: boolean;
  /** a clash that removes text: the person's blocks in [from, to) are struck */
  strike: boolean;
}

/**
 * The transaction that brings `remote` into the page, or null when no block differs. A person's edit is never overwritten and never lost: see the head of this file.
 */
export function mergeRemote(state: EditorState, base: string, remote: string, who: MergeWho): Merged | null {
  if (base === remote) return null;
  const schema = state.schema;
  const B = blocksOf(base, schema);
  const R = blocksOf(remote, schema);
  const L: PMNode[] = [];
  state.doc.forEach((n) => L.push(n));
  const key = (n: PMNode): string => JSON.stringify(n.toJSON());
  const kB = B.map(key);
  const rh = hunks(kB, R.map(key));
  if (rh.length === 0) return null;
  const lh = hunks(kB, L.map(key));
  const localEdited = lh.length > 0;
  const shift = (x: number): number =>
    x + lh.filter((h) => h.b <= x).reduce((s, h) => s + (h.d - h.c) - (h.b - h.a), 0);

  // which hunks of the new text touch the person's edits; a clash swallows every local hunk it touches and every other new hunk inside that stretch
  const clashing = new Array<boolean>(rh.length).fill(false);
  const reach: Array<{ a: number; b: number }> = rh.map((h) => ({ a: h.a, b: h.b }));
  const as = (r: { a: number; b: number }): Hunk => ({ a: r.a, b: r.b, c: 0, d: 0 });
  for (let again = true; again;) {
    again = false;
    const grow = (i: number, a: number, b: number): void => {
      const r = reach[i] as { a: number; b: number };
      if (!clashing[i] || a < r.a || b > r.b) again = true;
      clashing[i] = true;
      reach[i] = { a: Math.min(a, r.a), b: Math.max(b, r.b) };
    };
    for (let i = 0; i < rh.length; i += 1)
      for (const g of lh) if (touches(as(reach[i] as { a: number; b: number }), g)) grow(i, g.a, g.b);
    for (let i = 0; i < rh.length; i += 1)
      for (let k = i + 1; k < rh.length; k += 1) {
        const r = reach[i] as { a: number; b: number };
        const s2 = reach[k] as { a: number; b: number };
        if ((clashing[i] || clashing[k]) && touches(as(r), as(s2))) {
          grow(i, s2.a, s2.b);
          grow(k, r.a, r.b);
        }
      }
  }

  const ops: Op[] = [];
  const regions = new Map<string, Op>();
  rh.forEach((h, i) => {
    const incoming = R.slice(h.c, h.d);
    if (!clashing[i]) {
      ops.push({ from: shift(h.a), to: shift(h.b), nodes: incoming, clash: false, strike: false });
      return;
    }
    const r = reach[i] as { a: number; b: number };
    const from = shift(r.a);
    const to = shift(r.b);
    const k = `${from}:${to}`;
    const have = regions.get(k);
    const sug = asSuggestion(incoming, schema, who);
    if (have) {
      have.nodes.push(...sug);
      have.strike = have.strike || h.b > h.a;
    } else {
      const op: Op = { from, to, nodes: sug, clash: true, strike: h.b > h.a };
      regions.set(k, op);
      ops.push(op);
    }
  });
  const clashed = ops.some((o) => o.clash);
  const del = schema.marks["suggestDel"];
  const at = who.now();
  const tr = state.tr;
  const doc = state.doc;
  for (const op of [...ops].sort((p, q) => q.to - p.to || q.from - p.from)) {
    const a = startOf(doc, op.from);
    const b = startOf(doc, op.to);
    if (!op.clash) {
      let put = op.nodes;
      if (put.length === 0 && op.from === 0 && op.to === L.length)
        put = [schema.nodes["paragraph"]?.create() as PMNode];
      if (op.from !== op.to || put.length > 0) tr.replaceWith(a, b, Fragment.fromArray(put));
      continue;
    }
    if (op.strike && del) tr.addMark(a, b, del.create({ author: cleanAuthor(who.author), at }));
    if (op.nodes.length > 0) tr.insert(b, Fragment.fromArray(op.nodes));
  }
  if (!tr.docChanged) return null;
  tr.setMeta(SKIP, true).setMeta("addToHistory", false).setMeta("vyre-remote", true);
  // a caret inside blocks that were swapped keeps its block and its place in it, rather than jumping to the end of the new text
  const head = state.selection.head;
  const own = ops.find(
    (o) => !o.clash && head >= startOf(doc, o.from) && head <= startOf(doc, o.to) && o.nodes.length > 0,
  );
  if (state.selection.empty && own && ops.length === 1) {
    const a = startOf(doc, own.from);
    let off = a;
    let i = own.from;
    while (i < own.to - 1 && off + doc.child(i).nodeSize <= head) {
      off += doc.child(i).nodeSize;
      i += 1;
    }
    const k = Math.min(i - own.from, own.nodes.length - 1);
    const within = Math.min(head - off, (own.nodes[k] as PMNode).nodeSize - 1);
    let pos = a;
    for (let j = 0; j < k; j += 1) pos += (own.nodes[j] as PMNode).nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + Math.max(1, within), tr.doc.content.size)), -1));
  }
  if (!localEdited) tr.setMeta("vyre-remote-clean", true);
  return { tr, clashed, clean: !localEdited };
}

/** The last few texts the page handed to its host to save. The file echoing one of them back is the person's own save coming home, not the other side's change. */
export const SENT_KEEP = 8;
export function noteSent(sent: string[], text: string): void {
  sent.push(text);
  if (sent.length > SENT_KEEP) sent.shift();
}
export const isOwnEcho = (sent: readonly string[], value: string): boolean => sent.includes(value);
