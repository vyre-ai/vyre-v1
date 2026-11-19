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
  // a block that does not take marks (a code block) is brought in as it is: its text is not struck or underlined, but it is not lost either
  const walk = (n: PMNode): PMNode => {
    if (n.isTextblock)
      return n.type.allowsMarkType(add)
        ? n.copy(Fragment.fromArray(n.content.content.map((c) => c.mark(mark.addToSet(c.marks)))))
        : n;
    return n.isInline ? n : n.copy(Fragment.fromArray(n.content.content.map(walk)));
  };
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
  // where a block boundary of the old text sits in the page now. The start of a change counts every local change that ends at or before it; the end of a change counts only those that end strictly
  // before it, so a block the person typed right after a rewritten block is not swallowed with it (unless the change is a pure insertion, which has no end of its own).
  const delta = (h: Hunk): number => h.d - h.c - (h.b - h.a);
  const shiftStart = (x: number): number => x + lh.filter((h) => h.b <= x).reduce((n, h) => n + delta(h), 0);
  const shiftEnd = (x: number, pure: boolean): number =>
    x + lh.filter((h) => h.b < x || (pure && h.b === x)).reduce((n, h) => n + delta(h), 0);

  // which hunks of the new text touch the person's edits. A clash is the stretch of old blocks from the new hunk and every local hunk it touches; stretches that meet are one; a new hunk that
  // falls inside a stretch joins it. Sorted sweeps, repeated until nothing joins.
  const clashing = new Array<boolean>(rh.length).fill(false);
  const reach: Array<{ a: number; b: number }> = rh.map((h) => ({ a: h.a, b: h.b }));
  const as = (r: { a: number; b: number }): Hunk => ({ a: r.a, b: r.b, c: 0, d: 0 });
  rh.forEach((h, i) => {
    for (const g of lh) if (touches(h, g)) clashing[i] = true;
  });
  for (let again = true; again;) {
    again = false;
    // 1. widen each clashing hunk over the local hunks it touches
    for (let i = 0; i < rh.length; i += 1) {
      if (!clashing[i]) continue;
      for (const g of lh) {
        const r = reach[i] as { a: number; b: number };
        if (touches(as(r), g) && (g.a < r.a || g.b > r.b)) reach[i] = { a: Math.min(r.a, g.a), b: Math.max(r.b, g.b) };
      }
    }
    // 2. join stretches that meet, in order
    const order = rh
      .map((_h, i) => i)
      .filter((i) => clashing[i])
      .sort((x, y) => (reach[x] as { a: number }).a - (reach[y] as { a: number }).a);
    let cur: number | null = null;
    for (const i of order) {
      if (
        cur !== null &&
        touches(as(reach[cur] as { a: number; b: number }), as(reach[i] as { a: number; b: number }))
      ) {
        const r = reach[cur] as { a: number; b: number };
        const t = reach[i] as { a: number; b: number };
        const u = { a: Math.min(r.a, t.a), b: Math.max(r.b, t.b) };
        if (u.a !== r.a || u.b !== r.b || u.a !== t.a || u.b !== t.b) again = true;
        reach[cur] = u;
        reach[i] = u;
      } else cur = i;
    }
    // 3. a new hunk inside a stretch is part of it
    for (let i = 0; i < rh.length; i += 1) {
      if (clashing[i]) continue;
      for (const k of order)
        if (touches(as(reach[i] as { a: number; b: number }), as(reach[k] as { a: number; b: number }))) {
          clashing[i] = true;
          reach[i] = { ...(reach[k] as { a: number; b: number }) };
          again = true;
          break;
        }
    }
  }

  const ops: Op[] = [];
  const regions = new Map<string, Op>();
  rh.forEach((h, i) => {
    const incoming = R.slice(h.c, h.d);
    if (!clashing[i]) {
      ops.push({ from: shiftStart(h.a), to: shiftEnd(h.b, h.a === h.b), nodes: incoming, clash: false, strike: false });
      return;
    }
    const r = reach[i] as { a: number; b: number };
    // the stretch of the page: every local change that touches it is inside it; the others that end before it only move it
    const inside = lh.filter((g) => touches(as(r), g));
    const before = lh.filter((g) => !inside.includes(g) && g.b <= r.a).reduce((n, g) => n + delta(g), 0);
    const from = r.a + before;
    const to = r.b + before + inside.reduce((n, g) => n + delta(g), 0);
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

/**
 * Whether a text that arrived as the page's `value` is the page's own save coming home. A host that echoes save ids passes `valueId`: the id of the save the value is (a string), or null when it
 * came from anywhere else (an agent, another person, a restore). Only an id this page issued is its own, so a revert to older text is never taken for an echo, however many saves are in flight.
 * A host that does not pass ids (`undefined`) is matched by text: only the latest text sent counts, and the page then merges anything else.
 */
export function isOwnEcho(
  value: string,
  valueId: string | null | undefined,
  ids: ReadonlySet<string>,
  sent: readonly string[],
): boolean {
  if (valueId !== undefined) return valueId !== null && ids.has(valueId);
  return sent.length > 0 && sent[sent.length - 1] === value;
}

/** The ids the page gave its saves (a few dozen of them are small), and the last two texts sent: whole documents are not kept in numbers. */
export const IDS_KEEP = 64;
export const TEXTS_KEEP = 2;
/** The most characters of sent text kept in all: a long document is not held twice over; the ids still tell its echo from news. */
export const TEXTS_CHARS = 200_000;
export function noteSent(sent: string[], ids: Set<string>, text: string, id: string): void {
  ids.add(id);
  if (ids.size > IDS_KEEP) ids.delete(ids.values().next().value as string);
  if (text.length > TEXTS_CHARS / 2) {
    sent.length = 0;
    return;
  }
  sent.push(text);
  let total = sent.reduce((n, t) => n + t.length, 0);
  while (sent.length > TEXTS_KEEP || (total > TEXTS_CHARS && sent.length > 1)) total -= (sent.shift() as string).length;
}

/** The editor's last save as a host remembers it: the text and the id the editor gave it. */
export interface OwnSave {
  text: string;
  id: string | undefined;
}
/**
 * What to pass the editor as `valueId` for a draft: the id of the editor's own save when the draft is that text, otherwise null (the draft came from outside). When the draft has moved on to
 * something that is not the editor's, the remembered save is dropped, so the same text arriving later (a revert) is not taken for the editor's own.
 */
export function ownValueId(own: OwnSave, draft: string): { valueId: string | null; own: OwnSave } {
  if (draft === own.text) return { valueId: own.id ?? null, own };
  return { valueId: null, own: own.id === undefined ? own : { text: "\u0000", id: undefined } };
}
