// The read side of the search module (spec b11, ARCH 9): Cmd-K's server half. One query is answered from the full text index and the vectors, then every candidate is passed through
// `authorize` as the asker, so a row the asker cannot read never appears (and a private row is not here to find). 1-2 characters are type-ahead, newest first; from three
// characters BM25 ranks every match (title over body); semantic and hybrid fuse the vector ranks with the full text ranks and recency. Also here: Recent, Related, the > actions
// and `mergeHits`, which the client uses to put the server's answer after the local one.
import { DIM, LABELS, askerOf, docOf, embed, ensure, matchText, rowsOf, str, vectorsOf, wordsOf } from "../projections.ts";
import type { DocRow, Kind, SearchCtx } from "../projections.ts";
import { agentBound } from "../../../lib/redact.ts";

export interface Hit {
  kind: Kind;
  id: string;
  title: string;
  /** For a record: the record type it belongs to, so a caller can read that type's schema. */
  recordType?: string;
  snippet?: string;
  path?: string;
  link: string;
  label?: (typeof LABELS)[number];
  score: number;
  updatedAt?: number;
}

/**
 * Federated providers: a module that keeps its own search over private content answers the query itself, through its own capability called as the asker, so its rows never enter
 * this index and its own access rule decides what comes back (notes: the asker's own notes and those shared with them; an agent, only what everyone in its chat may read).
 * Their hits follow the indexed hits on the first page. A provider that fails or is missing leaves the answer as it was.
 */
export interface Federated { kind: Kind; cap: string; hits(out: unknown): Omit<Hit, "score">[] }
type NoteHit = { noteId?: unknown; title?: unknown; snippet?: unknown; updatedAt?: unknown };
export const FEDERATED: readonly Federated[] = [
  {
    kind: "note", cap: "notes.search",
    hits: (out) => (((out as { notes?: NoteHit[] } | null)?.notes) ?? []).filter((n) => typeof n.noteId === "string").map((n) => ({
      kind: "note" as const, id: n.noteId as string, title: typeof n.title === "string" && n.title ? n.title : "Untitled note",
      ...(typeof n.snippet === "string" && n.snippet ? { snippet: n.snippet } : {}), link: `vyre://note/${n.noteId as string}`,
      ...(typeof n.updatedAt === "number" ? { updatedAt: n.updatedAt } : {}),
    })),
  },
];
const FEDERATED_LIMIT = 5;

async function federated(ctx: SearchCtx, input: QueryInput): Promise<Hit[]> {
  if (input.cursor !== undefined && input.cursor !== "0") return [];
  if (input.recordType || input.folderId || !input.q.trim()) return [];
  const out: Hit[] = [];
  for (const p of FEDERATED) {
    if (input.types && input.types.length > 0 && !input.types.includes(p.kind)) continue;
    try {
      const got = p.hits(await ctx.call(p.cap, { q: input.q, limit: FEDERATED_LIMIT })).slice(0, FEDERATED_LIMIT);
      got.forEach((h, i) => out.push({ ...h, score: 1 / (RRF + i) }));
    } catch {
      ctx.log.warn("search provider did not answer", { cap: p.cap });
    }
  }
  return out;
}

/** A query whose longest word has this many characters or fewer is type-ahead: newest first, an early-stopped index scan. */
export const SHORT_QUERY = 2;
const RRF = 60;
/** A vector at or under this cosine is not counted as about the query. The spec gives no figure (ARCH 6.9 says only that hybrid search fuses BM25, cosine and recency), so this is the module's own, kept small. */
const MIN_COSINE = 0.05;
const MIN_CANDIDATES = 120;
const MAX_CANDIDATES = 600;
const SAFE = /^[A-Za-z0-9_.-]+$/;

const quoted = (s: string): string => `"${s.replaceAll('"', "")}"`;

/** May the asker see this document? The kernel decides, on the resource the document belongs to. */
function visible(ctx: SearchCtx, d: DocRow): boolean {
  return ctx.authorize({ perm: null, level: "view" }, { type: d.resType, id: d.resId }).effect === "allow";
}

/**
 * The kernel's view grant covers a whole Space, but a chat is the people in it: an invite-only channel's text is not for a manager who was not invited. So a chat or channel document also has to be one
 * the asker can open through the chat module's own rule (the same answer chat gives when they press it), asked as the asker. Anything else that says no, or fails, is not shown.
 */
/** An agent's own home in Files (Agents/<name>/: AGENT.md, MAP.md, agent.toml and what the template put there) is Vyre's working set for the agent, not a firm's document: a person's search never offers it (client walk, 11 Nov 2026). */
export const inAgentHome = (d: Pick<DocRow, "kind" | "path">): boolean => d.kind === "file" && d.path !== null && d.path.startsWith("Agents/");

async function readable(ctx: SearchCtx, d: DocRow, seen: Map<string, boolean> = new Map()): Promise<boolean> {
  if (ctx.principal.kind !== "agent" && inAgentHome(d)) return false;
  if (!visible(ctx, d)) return false;
  if (d.kind !== "chat" && d.kind !== "channel") return true;
  const k = `${d.kind}:${d.id}`;
  const known = seen.get(k);
  if (known !== undefined) return known;
  let ok = false;
  try {
    if (d.kind === "chat") await ctx.call("chat.messages.list", { threadId: d.id, limit: 1 });
    else await ctx.call("channels.get", { channelId: d.id });
    ok = true;
  } catch { ok = false; }
  seen.set(k, ok);
  return ok;
}

// ---- Redaction for AI: what an agent's search sees

/**
 * A person's search reads the index as it is. An agent-bound caller (an agent, or a person's turn run by an agent: Ask, MCP, the engine) sees a file with a redaction layer only as an agent may
 * read it: its title, path and body from search_agent_docs, a file agents may not see not at all, and a match only when every typed word is in that text (the full text index and the vectors were
 * built from the whole file, so a redacted word or a meaning near it would otherwise find it).
 */
interface AgentDoc { title: string; path: string | null; body: string; withheld: boolean }
type AgentDocs = Map<number, AgentDoc> | null;

function agentDocs(ctx: SearchCtx, ns: readonly number[]): AgentDocs {
  if (!agentBound(ctx)) return null;
  const out = new Map<number, AgentDoc>();
  for (let i = 0; i < ns.length; i += 400) {
    const chunk = ns.slice(i, i + 400).filter((n) => Number.isInteger(n));
    if (chunk.length === 0) continue;
    for (const r of rowsOf(ctx.db, `SELECT * FROM search_agent_docs WHERE n IN (${chunk.join(",")})`)) {
      out.set(Number(r["n"]), { title: str(r["title"]), path: r["path"] === null ? null : str(r["path"]), body: str(r["body"]), withheld: Number(r["withheld"]) === 1 });
    }
  }
  return out;
}

/** The document as this caller may see it: itself for a person, the agent's view for an agent-bound caller, null when agents may not see it. */
function asSeen(d: DocRow, agent: AgentDocs): DocRow | null {
  const a = agent?.get(d.n);
  if (!a) return d;
  if (a.withheld) return null;
  return { ...d, title: a.title, path: a.path, body: a.body };
}

/**
 * A room that gained a person (a channel or thread with a later join) is read by an agent only from the last join on: what was said before was not said to the people there now, and an agent's
 * answer is read by all of them. The index holds the whole text of the room, so for an agent-bound caller the text is read again from the messages after the cut, and a hit that matches only
 * words from before it is dropped. A person searching their own history is not cut here.
 */
async function afterJoin(ctx: SearchCtx, d: DocRow, memo: Map<string, DocRow | null>): Promise<DocRow | null> {
  if (d.kind !== "chat" || !agentBound(ctx)) return d;
  const had = memo.get(d.id);
  if (had !== undefined) return had;
  let out: DocRow | null = null;
  try {
    const th = ((await ctx.call("threads.get", { threadId: d.id })) as { thread?: { joinedAt?: Record<string, unknown> } }).thread;
    const joins = Object.values(th?.joinedAt ?? {}).filter((x): x is number => typeof x === "number");
    if (joins.length === 0) out = d;
    else {
      const cut = Math.max(...joins);
      const m = (await ctx.call("chat.messages.list", { threadId: d.id, limit: 200 })) as { messages?: Array<{ body?: unknown; enc?: unknown; createdAt?: unknown }> };
      const body = (m.messages ?? []).filter((x) => Number(x.enc) !== 2 && Number(x.createdAt ?? 0) >= cut).map((x) => (typeof x.body === "string" ? x.body : "")).filter((t) => t.length > 0).join("\n");
      out = body === "" ? null : { ...d, body };
    }
  } catch { out = null; }
  memo.set(d.id, out);
  return out;
}

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Is every typed word the start of a word of the title or body, as the full text index matches it (prefix, case and accents folded)? `any` asks for one word instead (Related). */
function wordsIn(d: Pick<DocRow, "title" | "body">, words: readonly string[], any = false): boolean {
  const have = new Set(wordsOf(fold(`${d.title}\n${d.body}`)));
  const has = (w: string): boolean => { const f = fold(w); for (const h of have) if (h.startsWith(f)) return true; return false; };
  const want = words.filter((w) => w.length > 0);
  if (want.length === 0) return true;
  return any ? want.some(has) : want.every(has);
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
    kind: d.kind, id: d.id, title: d.title, ...(snip ? { snippet: snip } : {}), ...(d.path ? { path: d.path } : {}), ...(d.kind === "record" && d.recordType ? { recordType: d.recordType } : {}), link: d.link, label: LABELS[Math.max(0, Math.min(3, d.label))]!,
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
  const agent = agentDocs(ctx, [...docs.keys()]);
  const hits: Hit[] = [];
  const opened = new Map<string, boolean>();
  const cuts = new Map<string, DocRow | null>();
  let more = false;
  for (const [n, e] of order) {
    const raw = docs.get(n);
    if (!raw) continue;
    const seenDoc = asSeen(raw, agent);
    if (!seenDoc) continue;
    const d = await afterJoin(ctx, seenDoc, cuts);
    if (!d) continue;
    if (d !== raw && !wordsIn(d, words)) continue;
    if (kinds && !kinds.has(d.kind)) continue;
    if (input.recordType && d.recordType !== input.recordType) continue;
    if (input.folderId && d.folderId !== input.folderId) continue;
    if (!(await readable(ctx, d, opened))) continue;
    if (hits.length === want) { more = true; break; }
    hits.push(hitOf(d, e.score, words));
  }
  const page = [...hits.slice(offset, offset + limit), ...(await federated(ctx, input))];
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
    const raw = docOf(d);
    const seenDoc = asSeen(raw, agentDocs(ctx, [raw.n]));
    const doc = seenDoc ? await afterJoin(ctx, seenDoc, new Map()) : null;
    if (!doc || !(await readable(ctx, doc))) continue;
    hits.push(hitOf(doc, 1 / (RRF + hits.length), []));
    if (hits.length === limit) break;
  }
  return { hits };
}

// ---- Resolve

/** One indexed item by kind and id, as the asker may see it (a record's hit names its record type). Absent when it is not indexed or not visible. */
export async function resolveItem(ctx: SearchCtx, input: { kind: Kind; itemId: string }): Promise<{ hit?: Hit }> {
  ensure(ctx.db);
  const row = rowsOf(ctx.db, "SELECT * FROM search_docs WHERE kind = ? AND id = ?", input.kind, input.itemId)[0];
  if (!row) return {};
  const raw = docOf(row);
  const seenDoc = asSeen(raw, agentDocs(ctx, [raw.n]));
  const doc = seenDoc ? await afterJoin(ctx, seenDoc, new Map()) : null;
  return doc && (await readable(ctx, doc)) ? { hit: hitOf(doc, 1, []) } : {};
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
  const selfRaw = docOf(row);
  const selfSeen = asSeen(selfRaw, agentDocs(ctx, [selfRaw.n]));
  const self = selfSeen ? await afterJoin(ctx, selfSeen, new Map()) : null;
  if (!self || !(await readable(ctx, self))) return { hits: [] };
  const terms = termsOf(self);
  if (terms.length === 0) return { hits: [] };
  const cands = rowsOf(
    ctx.db,
    "SELECT rowid AS n FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts, 8.0, 1.0, 0.0, 0.0, 0.0) LIMIT ?",
    `{title body} : (${terms.map(quoted).join(" OR ")})`, MIN_CANDIDATES,
  );
  const docs = docsByRowid(ctx, cands.map((c) => Number(c["n"])));
  const agent = agentDocs(ctx, [...docs.keys()]);
  const hits: Hit[] = [];
  const cuts = new Map<string, DocRow | null>();
  for (const c of cands) {
    const raw = docs.get(Number(c["n"]));
    if (!raw || raw.n === self.n) continue;
    const seenDoc = asSeen(raw, agent);
    const d = seenDoc ? await afterJoin(ctx, seenDoc, cuts) : null;
    if (!d || (d !== raw && !wordsIn(d, terms, true)) || !(await readable(ctx, d))) continue;
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
