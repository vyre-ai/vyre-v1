// The read side of the search module (spec b11, ARCH 9): Cmd-K's server half. One query is answered from the full text index and the vectors, then every candidate is passed through
// `authorize` as the asker, so a row the asker cannot read never appears (and an end-to-end row is not here to find). 1-2 characters are type-ahead, newest first; from three
// characters BM25 ranks every match (title over body); semantic and hybrid fuse the vector ranks with the full text ranks and recency. Also here: Recent, Related, the > actions
// and `mergeHits`, which the client uses to put the server's answer after the local one.
import { DIM, LABELS, askerOf, docOf, embed, ensure, matchText, rowsOf, str, vectorsOf, wordsOf } from "../projections.ts";
import type { DocRow, Kind, SearchCtx } from "../projections.ts";

export interface Hit {
  kind: Kind;
  id: string;
  title: string;
  snippet?: string;
  path?: string;
  link: string;
  label?: (typeof LABELS)[number];
  score: number;
  updatedAt?: number;
}

/** A query whose longest word has this many characters or fewer is type-ahead: newest first, an early-stopped index scan. */
export const SHORT_QUERY = 2;
const RRF = 60;
/** A vector under this cosine is not about the query: random 384-dimension vectors score within about 0.05 of zero, so 0.2 is well clear of chance. */
const MIN_COSINE = 0.2;
const MIN_CANDIDATES = 120;
const MAX_CANDIDATES = 600;
const SAFE = /^[A-Za-z0-9_.-]+$/;

const quoted = (s: string): string => `"${s.replaceAll('"', "")}"`;

/** May the asker see this document? The kernel decides, on the resource the document belongs to. */
function visible(ctx: SearchCtx, d: DocRow): boolean {
  return ctx.authorize({ perm: null, level: "view" }, { type: d.resType, id: d.resId }).effect === "allow";
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** A short stretch of the text around the first typed word, the word marked with [ ]; the head of the body when nothing matches. Done here, not in SQL, so only the rows shown pay for it. */
export function snippetOf(d: Pick<DocRow, "title" | "body">, words: readonly string[]): string | undefined {
  for (const text of [d.body, d.title]) {
    const low = text.toLowerCase();
    for (const w of words.map((x) => x.toLowerCase()).filter((x) => x.length > 0)) {
      for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, at + 1)) {
        if (at > 0 && WORD_CHAR.test(low[at - 1]!)) continue;
        let end = at + w.length;
        while (end < text.length && WORD_CHAR.test(text[end]!)) end++;
        const from = Math.max(0, at - 50), to = Math.min(text.length, end + 70);
        return `${from > 0 ? "…" : ""}${text.slice(from, at)}[${text.slice(at, end)}]${text.slice(end, to)}${to < text.length ? "…" : ""}`;
      }
    }
  }
  return d.body.length > 0 ? `${d.body.slice(0, 140)}${d.body.length > 140 ? "…" : ""}` : undefined;
}

function hitOf(d: DocRow, score: number, words: readonly string[]): Hit {
  const snip = snippetOf(d, words);
  return {
    kind: d.kind, id: d.id, title: d.title, ...(snip ? { snippet: snip } : {}), ...(d.path ? { path: d.path } : {}), link: d.link, label: LABELS[Math.max(0, Math.min(3, d.label))]!,
    score, ...(d.updatedAt !== null ? { updatedAt: d.updatedAt } : {}),
  };
}

function docsByRowid(ctx: SearchCtx, ns: readonly number[]): Map<number, DocRow> {
  const out = new Map<number, DocRow>();
  for (let i = 0; i < ns.length; i += 400) {
    const chunk = ns.slice(i, i + 400).filter((n) => Number.isInteger(n));
    if (chunk.length === 0) continue;
    for (const r of rowsOf(ctx.db, `SELECT * FROM search_docs WHERE n IN (${chunk.join(",")})`)) { const d = docOf(r); out.set(d.n, d); }
  }
  return out;
}

export interface QueryInput { q: string; types?: readonly Kind[]; mode?: "keyword" | "semantic" | "hybrid"; folderId?: string; recordType?: string; cursor?: string; limit?: number }
export interface Candidate { n: number }

/** The filters that are part of the MATCH, so a rare kind, type or folder is found by its own posting list, not by scanning every match of a broad prefix. */
function filterMatch(input: QueryInput): string {
  let m = "";
  if (input.types && input.types.length > 0) m += ` AND kind : (${input.types.filter((k) => SAFE.test(k)).map(quoted).join(" OR ")})`;
  if (input.recordType && SAFE.test(input.recordType)) m += ` AND rtype : ${quoted(input.recordType)}`;
  if (input.folderId && SAFE.test(input.folderId)) m += ` AND folder : ${quoted(input.folderId)}`;
  return m;
}

/** Full text candidates, best first. Type-ahead is newest first (title matches before body matches); three characters and up are ranked by BM25 with the title worth eight bodies. */
export function keywordCandidates(ctx: SearchCtx, input: QueryInput, cap: number): Candidate[] {
  const match = matchText(input.q);
  if (!match) return [];
  const f = filterMatch(input);
  const longest = Math.max(...wordsOf(input.q).map((w) => [...w].length));
  const rows = (m: string, order: string): Candidate[] =>
    rowsOf(ctx.db, `SELECT rowid AS n FROM search_fts WHERE search_fts MATCH ? ORDER BY ${order} LIMIT ?`, m, cap).map((r) => ({ n: Number(r["n"]) }));
  if (longest <= SHORT_QUERY) {
    const seen = new Set<number>();
    const out: Candidate[] = [];
    for (const c of [...rows(`title : (${match})${f}`, "rowid DESC"), ...rows(`{title body} : (${match})${f}`, "rowid DESC")]) if (!seen.has(c.n)) { seen.add(c.n); out.push(c); }
    return out.slice(0, cap);
  }
  return rows(`{title body} : (${match})${f}`, "bm25(search_fts, 8.0, 1.0, 0.0, 0.0, 0.0)");
}

export async function query(ctx: SearchCtx, input: QueryInput): Promise<{ hits: Hit[]; tookMs: number; next?: string; total?: number }> {
  const t0 = performance.now();
  ensure(ctx.db);
  const limit = input.limit ?? 20;
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const want = offset + limit;
  const cap = Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, want * 6));
  const mode = input.mode ?? "hybrid";
  const words = wordsOf(input.q);
  const short = words.length > 0 && Math.max(...words.map((w) => [...w].length)) <= SHORT_QUERY;

  const kw = mode === "semantic" ? [] : keywordCandidates(ctx, input, cap);
  let vec: Array<{ n: number; score: number }> = [];
  if (mode !== "keyword" && words.length > 0 && !(mode === "hybrid" && short)) {
    const index = vectorsOf(ctx.db, ctx.space);
    if (index.size > 0) {
      const [qv] = await embed([input.q]);
      if (qv && qv.length === DIM) vec = index.top(qv, cap).filter((v) => v.score > MIN_COSINE);
    }
  }

  // fuse: reciprocal rank of the full text order and of the cosine order, plus a little for recency
  const fused = new Map<number, { score: number }>();
  kw.forEach((c, i) => fused.set(c.n, { score: 1 / (RRF + i) }));
  vec.forEach((v, i) => { const e = fused.get(v.n); if (e) e.score += 1 / (RRF + i); else fused.set(v.n, { score: 1 / (RRF + i) }); });
  const docs = docsByRowid(ctx, [...fused.keys()]);
  if (!short) {
    [...fused.keys()].filter((n) => docs.has(n)).sort((a, b) => (docs.get(b)!.updatedAt ?? 0) - (docs.get(a)!.updatedAt ?? 0)).forEach((n, i) => { fused.get(n)!.score += 0.25 / (RRF + i); });
  }
  const order = [...fused.entries()].sort((a, b) => b[1].score - a[1].score || b[0] - a[0]);

  const kinds = input.types && input.types.length > 0 ? new Set<string>(input.types) : null;
  const hits: Hit[] = [];
  let more = false;
  for (const [n, e] of order) {
    const d = docs.get(n);
    if (!d) continue;
    if (kinds && !kinds.has(d.kind)) continue;
    if (input.recordType && d.recordType !== input.recordType) continue;
    if (input.folderId && d.folderId !== input.folderId) continue;
    if (!visible(ctx, d)) continue;
    if (hits.length === want) { more = true; break; }
    hits.push(hitOf(d, e.score, words));
  }
  const page = hits.slice(offset, offset + limit);
  return { hits: page, tookMs: Math.max(0, Math.round(performance.now() - t0)), ...(more ? { next: String(offset + limit) } : {}) };
}

// ---- Recent

export async function recentList(ctx: SearchCtx, input: { types?: readonly Kind[]; limit?: number }): Promise<{ hits: Hit[] }> {
  ensure(ctx.db);
  const limit = input.limit ?? 20;
  const kinds = input.types && input.types.length > 0 ? new Set<string>(input.types) : null;
  const hits: Hit[] = [];
  for (const r of rowsOf(ctx.db, "SELECT kind, item_id, at FROM search_recent WHERE principal = ? ORDER BY at DESC LIMIT ?", askerOf(ctx), limit * 4)) {
    if (kinds && !kinds.has(str(r["kind"]))) continue;
    const d = rowsOf(ctx.db, "SELECT * FROM search_docs WHERE kind = ? AND id = ?", str(r["kind"]), str(r["item_id"]))[0];
    if (!d) continue;
    const doc = docOf(d);
    if (!visible(ctx, doc)) continue;
    hits.push(hitOf(doc, 1 / (RRF + hits.length), []));
    if (hits.length === limit) break;
  }
  return { hits };
}

// ---- Related

const STOP = new Set(["that", "this", "with", "from", "have", "will", "your", "about", "there", "their", "which", "would", "could", "should", "been", "were", "they", "them", "than", "then"]);

/** The words that make an item itself: its title words and its most frequent longer words. */
function termsOf(d: DocRow): string[] {
  const count = new Map<string, number>();
  for (const w of wordsOf(d.body.toLowerCase())) if (w.length >= 4 && !STOP.has(w)) count.set(w, (count.get(w) ?? 0) + 1);
  const body = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([w]) => w);
  const title = wordsOf(d.title.toLowerCase()).filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set([...title, ...body])].slice(0, 12);
}

export async function related(ctx: SearchCtx, input: { kind: Kind; itemId: string; limit?: number }): Promise<{ hits: Hit[] }> {
  ensure(ctx.db);
  const limit = input.limit ?? 10;
  const row = rowsOf(ctx.db, "SELECT * FROM search_docs WHERE kind = ? AND id = ?", input.kind, input.itemId)[0];
  if (!row) return { hits: [] };
  const self = docOf(row);
  if (!visible(ctx, self)) return { hits: [] };
  const terms = termsOf(self);
  if (terms.length === 0) return { hits: [] };
  const cands = rowsOf(
    ctx.db,
    "SELECT rowid AS n FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts, 8.0, 1.0, 0.0, 0.0, 0.0) LIMIT ?",
    `{title body} : (${terms.map(quoted).join(" OR ")})`, MIN_CANDIDATES,
  );
  const docs = docsByRowid(ctx, cands.map((c) => Number(c["n"])));
  const hits: Hit[] = [];
  for (const c of cands) {
    const d = docs.get(Number(c["n"]));
    if (!d || d.n === self.n || !visible(ctx, d)) continue;
    hits.push(hitOf(d, 1 / (RRF + hits.length), terms));
    if (hits.length === limit) break;
  }
  return { hits };
}

// ---- the > actions

export interface ActionRow { key: string; title: string; icon: string; cap?: string; keys?: string }

export const ACTIONS: readonly ActionRow[] = [
  { key: "task.new", title: "New task", icon: "task", cap: "tasks.create", keys: "create todo add" },
  { key: "call.start", title: "Call someone", icon: "call", keys: "phone dial ring" },
  { key: "skin.switch", title: "Switch skin", icon: "skin", keys: "theme paper graphite dark light" },
  { key: "presence.away", title: "Set yourself away", icon: "away", keys: "status busy" },
  { key: "presence.offline", title: "Go offline", icon: "offline", keys: "disconnect" },
];

/** Every typed word must start a word of the title or the keywords; a title word counts for more, and the first word of the title for most. */
export async function actionsList(_ctx: Pick<SearchCtx, "trace">, input: { q?: string }): Promise<{ actions: ActionRow[] }> {
  const words = wordsOf((input.q ?? "").toLowerCase());
  const scored: Array<{ a: ActionRow; s: number }> = [];
  for (const a of ACTIONS) {
    const title = wordsOf(a.title.toLowerCase());
    const pool = [...title, ...wordsOf((a.keys ?? "").toLowerCase())];
    let s = 0;
    let ok = true;
    for (const w of words) {
      if (title.some((p) => p.startsWith(w))) s += title[0]?.startsWith(w) ? 3 : 2;
      else if (pool.some((p) => p.startsWith(w))) s += 1;
      else { ok = false; break; }
    }
    if (ok) scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s || x.a.title.localeCompare(y.a.title));
  return { actions: scored.map((x) => ({ ...x.a })) };
}

// ---- merge with the device's own answer

export interface MergeHit { kind: string; id: string; title: string; snippet?: string; path?: string; link?: string; label?: string; score?: number; updatedAt?: number }

/**
 * Cmd-K shows the device's own answer first (it never waits) and the server's as it arrives. A thing in both is shown once, at the local position, with whatever the server adds
 * (snippet, path, link, label); a thing only the server found follows, best first. The result is cut to `limit`.
 */
export function mergeHits<T extends MergeHit, S extends MergeHit>(local: readonly T[], server: readonly S[], limit = 20): Array<T | S> {
  const out: Array<T | S> = [];
  const at = new Map<string, number>();
  for (const l of local) {
    const k = `${l.kind}\u0000${l.id}`;
    if (at.has(k)) continue;
    at.set(k, out.length);
    out.push(l);
  }
  for (const s of server) {
    const k = `${s.kind}\u0000${s.id}`;
    const i = at.get(k);
    if (i === undefined) { at.set(k, out.length); out.push(s); continue; }
    const l = out[i]!;
    out[i] = {
      ...l,
      ...(l.snippet === undefined && s.snippet !== undefined ? { snippet: s.snippet } : {}), ...(l.path === undefined && s.path !== undefined ? { path: s.path } : {}),
      ...(l.link === undefined && s.link !== undefined ? { link: s.link } : {}), ...(l.label === undefined && s.label !== undefined ? { label: s.label } : {}),
    };
  }
  return out.slice(0, limit);
}
