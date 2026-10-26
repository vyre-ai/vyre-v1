// @reads /modules/search/migrations/0001_index.sql
// The durable rows and shared helpers of the search module (spec b11, ARCH 4.3 and 9): the context type the handlers use, the schema bootstrap, the document rows with their
// full-text twin, the 384-dimension vectors and the in-memory scan over them (brute-force cosine), and the seams the host fills (the embedding model, a source for an entity).
// Every statement names a search_* table, which is all ctx.db lets a module touch. The migration file is the one source of the schema.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

/** What the module needs of ctx.db (the host's ScopedDb has this shape). */
export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export type Level = "view" | "use" | "edit" | "manage";
export type Kind = "person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel";
export const KINDS: readonly Kind[] = ["person", "agent", "chat", "inbox", "record", "file", "automation", "app", "setting", "memory", "task", "channel"];
export const LABELS = ["public", "internal", "confidential", "restricted"] as const;
export type LabelName = (typeof LABELS)[number];

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface SearchCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  trace: { traceId: string };
  run?: string | undefined;
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export function raise(ctx: Pick<SearchCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** Who is asking: the person an agent acts for, else the caller. */
export const askerOf = (ctx: Pick<SearchCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

export type Row = Record<string, unknown>;
export const rowsOf = (db: Db, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];
export const str = (v: unknown): string => String(v ?? "");
export const num = (v: unknown): number => Number(v ?? 0);
export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

// ---- schema

const SCHEMA = readFileSync(new URL("./migrations/0001_index.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);

const ready = new WeakSet<object>();

/** Make sure the search tables exist. One cheap probe per handle; the CREATE ... IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try {
    db.all("SELECT k FROM search_meta WHERE k = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
  }
  ready.add(db);
}

// ---- documents

export const KIND_OF_ENTITY: Readonly<Record<string, Kind>> = {
  record: "record", file: "file", thread: "chat", chat: "chat", agent: "agent", automation: "automation", task: "task", channel: "channel", principal: "person", person: "person",
  inbox: "inbox", app: "app", setting: "setting", memory: "memory",
};

/** The permission resource a kind is checked on. */
export const RESOURCE_OF_KIND: Readonly<Record<Kind, string>> = {
  person: "space", agent: "agent", chat: "thread", inbox: "space", record: "record", file: "file", automation: "automation", app: "space", setting: "space", memory: "space", task: "task", channel: "channel",
};

/** One thing the index holds. `enc` is never stored: end-to-end content never reaches this module. */
export interface IndexDoc {
  entity: string;
  id: string;
  kind: Kind;
  title: string;
  body: string;
  path?: string;
  link: string;
  label: number;
  resource: { type: string; id: string | null };
  folderId?: string;
  recordType?: string;
  updatedAt?: number;
}

export interface DocRow {
  n: number; entity: string; id: string; kind: Kind; title: string; body: string; path: string | null; link: string; label: number;
  resType: string; resId: string | null; folderId: string | null; recordType: string | null; updatedAt: number | null; embedded: number;
}

export const docOf = (r: Row): DocRow => ({
  n: num(r["n"]), entity: str(r["entity"]), id: str(r["id"]), kind: str(r["kind"]) as Kind, title: str(r["title"]), body: str(r["body"]), path: r["path"] === null ? null : str(r["path"]), link: str(r["link"]),
  label: num(r["label"]), resType: str(r["res_type"]), resId: r["res_id"] === null ? null : str(r["res_id"]), folderId: r["folder_id"] === null ? null : str(r["folder_id"]),
  recordType: r["record_type"] === null ? null : str(r["record_type"]), updatedAt: r["updated_at"] === null ? null : num(r["updated_at"]), embedded: num(r["embedded"]),
});

/** Words as the full text index and the query see them: letters, digits and underscore. */
export const TOKEN = /[\p{L}\p{N}_]+/gu;
export const wordsOf = (s: string): string[] => s.match(TOKEN) ?? [];

/** FTS5 MATCH text from what was typed: every word quoted and a prefix, so typing narrows as it goes. FTS syntax a person types is just text. */
export function matchText(q: string): string | null {
  const w = wordsOf(q);
  return w.length === 0 ? null : w.map((x) => `"${x.replaceAll('"', "")}"*`).join(" ");
}

const BODY_CAP = 20_000;

/** Put a document in the index, replacing the one it supersedes. Its rowid is new, so rowid order is recency. Returns the new rowid. */
export function putDoc(db: Db, space: string, d: IndexDoc, now: number): number {
  removeDoc(db, space, d.entity, d.id);
  const body = d.body.length > BODY_CAP ? d.body.slice(0, BODY_CAP) : d.body;
  db.run(
    "INSERT INTO search_docs (entity, id, kind, title, body, path, link, label, res_type, res_id, folder_id, record_type, updated_at, embedded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    d.entity, d.id, d.kind, d.title, body, d.path ?? null, d.link, d.label, d.resource.type, d.resource.id, d.folderId ?? null, d.recordType ?? null, d.updatedAt ?? now,
  );
  const n = num(rowsOf(db, "SELECT n FROM search_docs WHERE entity = ? AND id = ?", d.entity, d.id)[0]?.["n"]);
  db.run("INSERT INTO search_fts (rowid, title, body, kind, rtype, folder) VALUES (?, ?, ?, ?, ?, ?)", n, d.title, body, d.kind, d.recordType ?? "", d.folderId ?? "");
  return n;
}

/** Take a document, its full text row and its vector out of the index. True when there was one. */
export function removeDoc(db: Db, space: string, entity: string, id: string): boolean {
  const old = rowsOf(db, "SELECT n FROM search_docs WHERE entity = ? AND id = ?", entity, id)[0];
  if (!old) return false;
  const n = num(old["n"]);
  db.run("DELETE FROM search_fts WHERE rowid = ?", n);
  db.run("DELETE FROM search_docs WHERE n = ?", n);
  dropVector(db, space, n);
  return true;
}

// ---- the embedding model seam

/** Turns texts into 384-dimension vectors. The host binds the small local WASM model (`@huggingface/transformers`, ARCH 6.9); until then the feature-hashing stand-in below answers. */
export type Embedder = (texts: readonly string[]) => Promise<Float32Array[]>;
export const DIM = 384;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Normalise to unit length (cosine becomes a dot product). A zero vector stays zero. */
export function normalise(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  if (s === 0) return v;
  const k = 1 / Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] = v[i]! * k;
  return v;
}

/** A deterministic stand-in embedder: words, word pairs and word prefixes hashed into 384 signed buckets. Similar texts share buckets, so cosine means something; it is not a language model. */
export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const ws = wordsOf(text.toLowerCase());
  const add = (feature: string, weight: number): void => {
    const h = fnv(feature);
    v[h % DIM] = v[h % DIM]! + ((h >>> 9) & 1 ? weight : -weight);
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    add(`w:${w}`, 1);
    if (w.length > 4) add(`p:${w.slice(0, 4)}`, 0.5);
    if (i > 0) add(`b:${ws[i - 1]}:${w}`, 0.7);
  }
  return normalise(v);
}

let embedder: Embedder = async (texts) => texts.map((t) => hashEmbed(t));
/** The host gives the module its model; null puts the stand-in back. */
export function setEmbedder(e: Embedder | null): void { embedder = e ?? (async (texts) => texts.map((t) => hashEmbed(t))); }
export async function embed(texts: readonly string[]): Promise<Float32Array[]> {
  const out = await embedder(texts);
  return out.map((v) => {
    if (v.length !== DIM) throw new Error(`embedder returned ${v.length} dimensions, the index holds ${DIM}`);
    return normalise(Float32Array.from(v));
  });
}

// ---- vectors

// The scan kernel is one interface so a faster one can replace the plain JavaScript version without touching the index (P-L1_15 brings a SIMD kernel and proves the 200k-vector budget).
/** Scores `count` vectors of `DIM` floats laid end to end in `data` from float index `from` against the unit query `q`: out[i] = dot(vector i, q). */
export interface VectorKernel {
  readonly name: string;
  /** Exact scoring of a plain array (the reference every faster path is measured against). */
  score(data: Float32Array, from: number, count: number, q: Float32Array, out: Float32Array): void;
  /** Optional: storage the kernel owns, so it can keep its own compact form of the vectors and scan that. VectorIndex uses it when offered. */
  store?(capacity: number): VectorStore;
}

/** Vectors by slot, in the kernel's own storage. Every vector given is unit length. `top` returns the best `k` slots by cosine, best first, after the kernel's own candidate pass. */
export interface VectorStore {
  /** Room for at least `capacity` slots (never shrinks). */
  reserve(capacity: number): void;
  set(slot: number, v: Float32Array): void;
  /** Copy the vector in slot `from` into slot `to` (the last vector fills the gap a removal leaves). */
  move(to: number, from: number): void;
  /** `count` is how many slots are in use; `accept` skips slots the caller does not want. */
  top(q: Float32Array, count: number, k: number, accept?: (slot: number) => boolean): Array<{ slot: number; score: number }>;
}

/** Eight independent accumulators keep the multiply-adds from waiting on each other. */
export const jsKernel: VectorKernel = {
  name: "js",
  score(d, from, count, q, out) {
    for (let s = 0, o = from; s < count; s++, o += DIM) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0;
      for (let i = 0; i < DIM; i += 8) {
        a0 += d[o + i]! * q[i]!; a1 += d[o + i + 1]! * q[i + 1]!; a2 += d[o + i + 2]! * q[i + 2]!; a3 += d[o + i + 3]! * q[i + 3]!;
        a4 += d[o + i + 4]! * q[i + 4]!; a5 += d[o + i + 5]! * q[i + 5]!; a6 += d[o + i + 6]! * q[i + 6]!; a7 += d[o + i + 7]! * q[i + 7]!;
      }
      out[s] = ((a0 + a1) + (a2 + a3)) + ((a4 + a5) + (a6 + a7));
    }
  },
};

let kernel: VectorKernel = jsKernel;
/** The host (or the vectors spike) gives the module a faster kernel; null puts the JavaScript one back. */
export function setVectorKernel(k: VectorKernel | null): void { kernel = k ?? jsKernel; }

export const CHUNK = 16_384;   // exported so the chunking test follows the constant (S13 raised it from 4,096)

/** Every vector of one Space, scanned in full for a query: brute force, fine to about 200k vectors (ARCH R14). With a kernel that offers storage the kernel keeps the vectors; otherwise they lie in one array. */
export class VectorIndex {
  private f32: Float32Array | null = null;
  private store: VectorStore | null = null;
  private cap: number;
  private ids: Int32Array;
  private slot = new Map<number, number>();
  private scores = new Float32Array(CHUNK);
  private readonly use: VectorKernel | undefined;
  size = 0;

  constructor(capacity = 1024, use?: VectorKernel) {
    this.use = use;
    this.cap = capacity;
    this.ids = new Int32Array(capacity);
    const k = use ?? kernel;
    if (k.store) { this.store = k.store(capacity); } else { this.f32 = new Float32Array(capacity * DIM); }
  }

  /** Which kernel scans. */
  get kernel(): string { return (this.use ?? kernel).name; }
  /** True when the kernel keeps the vectors (its own form), false when they lie in a plain array. */
  get kernelStored(): boolean { return this.store !== null; }

  private grow(): void {
    const cap = this.cap * 2;
    const ids = new Int32Array(cap);
    ids.set(this.ids.subarray(0, this.size));
    this.ids = ids;
    if (this.store) this.store.reserve(cap);
    else { const d = new Float32Array(cap * DIM); d.set(this.f32!.subarray(0, this.size * DIM)); this.f32 = d; }
    this.cap = cap;
  }

  /** Add or replace the vector of a document. The vector must already be unit length. */
  set(n: number, v: Float32Array): void {
    if (v.length !== DIM) throw new Error(`vector has ${v.length} dimensions, the index holds ${DIM}`);
    let s = this.slot.get(n);
    if (s === undefined) {
      if (this.size === this.cap) this.grow();
      s = this.size++;
      this.slot.set(n, s);
      this.ids[s] = n;
    }
    if (this.store) this.store.set(s, v); else this.f32!.set(v, s * DIM);
  }

  remove(n: number): void {
    const s = this.slot.get(n);
    if (s === undefined) return;
    const last = this.size - 1;
    if (s !== last) {
      if (this.store) this.store.move(s, last); else this.f32!.copyWithin(s * DIM, last * DIM, (last + 1) * DIM);
      const moved = this.ids[last]!;
      this.ids[s] = moved;
      this.slot.set(moved, s);
    }
    this.slot.delete(n);
    this.size--;
  }

  has(n: number): boolean { return this.slot.has(n); }

  /** The k best documents by cosine, best first. */
  top(q: Float32Array, k: number, accept?: (n: number) => boolean): Array<{ n: number; score: number }> {
    if (this.store) {
      return this.store.top(q, this.size, k, accept ? (s) => accept(this.ids[s]!) : undefined).map((r) => ({ n: this.ids[r.slot]!, score: r.score }));
    }
    const best: Array<{ n: number; score: number }> = [];
    let floor = -Infinity;
    const k0 = this.use ?? kernel;
    for (let start = 0; start < this.size; start += CHUNK) {
      const count = Math.min(CHUNK, this.size - start);
      k0.score(this.f32!, start * DIM, count, q, this.scores);
      for (let i = 0; i < count; i++) {
        const score = this.scores[i]!;
        if (best.length === k && score <= floor) continue;
        const n = this.ids[start + i]!;
        if (accept && !accept(n)) continue;
        let at = best.length;
        while (at > 0 && best[at - 1]!.score < score) at--;
        best.splice(at, 0, { n, score });
        if (best.length > k) best.pop();
        if (best.length === k) floor = best[k - 1]!.score;
      }
    }
    return best;
  }
}

// The scan reads one contiguous array, so it is kept in memory between calls. The host builds a fresh db handle per call, so the cache is keyed by Space and checked against a
// generation counter in search_meta: a vector written or dropped anywhere bumps it, and the next reader reloads only when its own copy is behind.
const caches = new Map<string, { index: VectorIndex; gen: string | null }>();

const genOf = (db: Db): string | null => { const r = rowsOf(db, "SELECT v FROM search_meta WHERE k = 'vec_gen'")[0]; return r ? str(r["v"]) : null; };
function bump(db: Db): string {
  const g = String(num(genOf(db)) + 1);
  db.run("INSERT INTO search_meta (k, v) VALUES ('vec_gen', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", g);
  return g;
}

/** The vector index of this Space, loaded from search_vectors the first time and whenever another writer changed it. */
export function vectorsOf(db: Db, space: string): VectorIndex {
  ensure(db);
  let c = caches.get(space);
  const gen = genOf(db);
  if (!c || c.gen !== gen) {
    const index = new VectorIndex();
    for (const r of rowsOf(db, "SELECT n, vec FROM search_vectors")) index.set(num(r["n"]), decodeVector(r["vec"] as Uint8Array));
    c = { index, gen };
    caches.set(space, c);
  }
  return c.index;
}

/** Store the vector of a document (unit length) and put it in the scan. */
export function writeVector(db: Db, space: string, n: number, v: Float32Array): void {
  const index = vectorsOf(db, space);
  db.run("INSERT INTO search_vectors (n, dim, vec) VALUES (?, ?, ?) ON CONFLICT (n) DO UPDATE SET dim = excluded.dim, vec = excluded.vec", n, DIM, encodeVector(v));
  index.set(n, v);
  const c = caches.get(space);
  if (c) c.gen = bump(db);
}

export function dropVector(db: Db, space: string, n: number): void {
  const had = rowsOf(db, "SELECT n FROM search_vectors WHERE n = ?", n).length > 0;
  if (!had) return;
  const index = vectorsOf(db, space);
  db.run("DELETE FROM search_vectors WHERE n = ?", n);
  index.remove(n);
  const c = caches.get(space);
  if (c) c.gen = bump(db);
}

/** A test or a reset forgets the in-memory copies. */
export function forgetVectors(space?: string): void { if (space === undefined) caches.clear(); else caches.delete(space); }

export function encodeVector(v: Float32Array): Uint8Array {
  const out = new Uint8Array(v.length * 4);
  new Float32Array(out.buffer).set(v);
  return out;
}

export function decodeVector(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

// ---- sources: how the index learns what an entity row says

/** What a source answers for one row: the document, or why there is none. `e2e` means the row is end-to-end and must never be indexed; `gone` means it no longer exists or is hidden. */
export type Resolved = { doc: IndexDoc } | { skip: "e2e" | "gone" };
export type Source = (ctx: SearchCtx, id: string, sub: string | undefined) => Promise<Resolved>;

const extraSources = new Map<string, Source>();
/** The host (or a module's own wiring) gives the index a source for an entity the defaults do not cover (people, the inbox, space-layer memory, settings, apps). */
export function setSource(entity: string, s: Source | null): void {
  if (s) extraSources.set(entity, s); else extraSources.delete(entity);
}
export const sourceFor = (entity: string): Source | undefined => extraSources.get(entity);

export const FAILED_RETRY_MS = 60_000;
