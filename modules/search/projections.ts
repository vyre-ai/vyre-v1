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

// The scan kernel: one WebAssembly function (SIMD, 128-bit lanes) that scores a run of vectors against the query, written as bytes so the module needs no toolchain and no package.
// scan(vec, q, count, out): out[i] = dot(vec[i], q) for i in 0..count, vectors of 384 float32 laid end to end. Two accumulators hide the add latency. If the runtime refuses the
// module (no SIMD) the index scans in JavaScript instead; both give the same scores.
const leb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v !== 0) b |= 0x80; o.push(b); } while (v !== 0); return o; };
const sleb = (n: number): number[] => { const o: number[] = []; let v = n; for (;;) { const b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } };
const section = (id: number, body: number[]): number[] => [id, ...leb(body.length), ...body];
const BYTES_PER_VECTOR = DIM * 4;

function kernelBytes(): Uint8Array {
  const L = { get: 0x20, set: 0x21, tee: 0x22, i32const: 0x41 };
  const I32_ADD = 0x6a, I32_SHL = 0x74, I32_GE_U = 0x4f, I32_LT_U = 0x49, F32_ADD = 0x92, F32_STORE = 0x38;
  const V128_LOAD = [0xfd, 0x00], V128_CONST = [0xfd, 0x0c], F32X4_MUL = [0xfd, 0xe6, 0x01], F32X4_ADD = [0xfd, 0xe4, 0x01], EXTRACT = [0xfd, 0x1f];
  // locals: 0 vec, 1 q, 2 count, 3 out (params); 4 acc0, 5 acc1 (v128); 6 qp, 7 qend, 8 end (i32)
  const zero = [...V128_CONST, ...new Array<number>(16).fill(0)];
  const load = (local: number, offset: number): number[] => [L.get, local, ...V128_LOAD, 0x04, ...leb(offset)];
  const lane = (n: number): number[] => [L.get, 4, ...EXTRACT, n];
  const code: number[] = [];
  code.push(0x02, 0x02, 0x7b, 0x03, 0x7f);                                    // locals: 2 x v128, 3 x i32
  code.push(L.get, 3, L.get, 2, L.i32const, 2, I32_SHL, I32_ADD, L.set, 8);   // end = out + count * 4
  code.push(L.get, 1, L.i32const, ...sleb(BYTES_PER_VECTOR), I32_ADD, L.set, 7); // qend = q + 1536
  code.push(0x02, 0x40, 0x03, 0x40);                                          // block, loop
  code.push(L.get, 3, L.get, 8, I32_GE_U, 0x0d, 0x01);                        // if out >= end: leave
  code.push(...zero, L.set, 4, ...zero, L.set, 5, L.get, 1, L.set, 6);        // acc0 = acc1 = 0; qp = q
  code.push(0x03, 0x40);                                                      // inner loop: 8 floats per turn
  code.push(L.get, 4, ...load(0, 0), ...load(6, 0), ...F32X4_MUL, ...F32X4_ADD, L.set, 4);
  code.push(L.get, 5, ...load(0, 16), ...load(6, 16), ...F32X4_MUL, ...F32X4_ADD, L.set, 5);
  code.push(L.get, 0, L.i32const, 32, I32_ADD, L.set, 0);
  code.push(L.get, 6, L.i32const, 32, I32_ADD, L.tee, 6, L.get, 7, I32_LT_U, 0x0d, 0x00, 0x0b);
  // sum = (acc0 + acc1) lanes
  code.push(L.get, 4, L.get, 5, ...F32X4_ADD, L.set, 4);
  code.push(L.get, 3, ...lane(0), ...lane(1), F32_ADD, ...lane(2), ...lane(3), F32_ADD, F32_ADD, F32_STORE, 0x02, 0x00);
  code.push(L.get, 3, L.i32const, 4, I32_ADD, L.set, 3, 0x0c, 0x00, 0x0b, 0x0b, 0x0b);
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00]),
    ...section(2, [0x01, 0x01, 0x65, 0x01, 0x6d, 0x02, 0x00, 0x01]),
    ...section(3, [0x01, 0x00]),
    ...section(7, [0x01, 0x04, 0x73, 0x63, 0x61, 0x6e, 0x00, 0x00]),
    ...section(10, [0x01, ...leb(code.length), ...code]),
  ];
  return Uint8Array.from(bytes);
}

type Scan = (vec: number, q: number, count: number, out: number) => void;
// the lib has no DOM, so the little of WebAssembly used here is declared here
interface WasmMemory { readonly buffer: ArrayBuffer; grow(pages: number): number }
interface WasmApi {
  Memory: new (d: { initial: number }) => WasmMemory;
  Module: new (bytes: Uint8Array) => object;
  Instance: new (m: object, imports: object) => { exports: Record<string, unknown> };
  validate(bytes: Uint8Array): boolean;
}
const wasmApi = (globalThis as { WebAssembly?: WasmApi }).WebAssembly;
let kernelModule: object | null | undefined;
function kernelFor(mem: WasmMemory): Scan | null {
  if (!wasmApi) return null;
  if (kernelModule === undefined) {
    try {
      const b = kernelBytes();
      kernelModule = wasmApi.validate(b) ? new wasmApi.Module(b) : null;
    } catch { kernelModule = null; }
  }
  if (!kernelModule) return null;
  return new wasmApi.Instance(kernelModule, { e: { m: mem } }).exports["scan"] as Scan;
}

const PAGE = 65_536;
const Q_OFF = 0;
const OUT_OFF = 4_096;
const CHUNK = 4_096;
const DATA_OFF = PAGE;

/** Every vector of one Space in one contiguous array, scanned in full for a query: brute force, fine to about 200k vectors (ARCH R14). */
export class VectorIndex {
  private mem: WasmMemory | null = null;
  private scan: Scan | null = null;
  private f32: Float32Array;
  private base: number;            // float index of the first vector in f32
  private cap: number;
  private ids: Int32Array;
  private slot = new Map<number, number>();
  size = 0;
  /** Which kernel scans: the WebAssembly SIMD one, or plain JavaScript. */
  readonly kernel: "wasm" | "js";

  constructor(capacity = 1024, o: { wasm?: boolean } = {}) {
    this.cap = capacity;
    this.ids = new Int32Array(capacity);
    const want = o.wasm !== false && wasmApi !== undefined;
    if (want && wasmApi) {
      try {
        this.mem = new wasmApi.Memory({ initial: Math.ceil((DATA_OFF + capacity * BYTES_PER_VECTOR) / PAGE) });
        this.scan = kernelFor(this.mem);
        if (!this.scan) this.mem = null;
      } catch { this.mem = null; this.scan = null; }
    }
    this.kernel = this.scan ? "wasm" : "js";
    this.f32 = this.mem ? new Float32Array(this.mem.buffer) : new Float32Array(capacity * DIM);
    this.base = this.mem ? DATA_OFF / 4 : 0;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const ids = new Int32Array(cap);
    ids.set(this.ids.subarray(0, this.size));
    this.ids = ids;
    if (this.mem) {
      this.mem.grow(Math.ceil((DATA_OFF + cap * BYTES_PER_VECTOR) / PAGE) - this.mem.buffer.byteLength / PAGE);
      this.f32 = new Float32Array(this.mem.buffer);
    } else {
      const d = new Float32Array(cap * DIM);
      d.set(this.f32.subarray(0, this.size * DIM));
      this.f32 = d;
    }
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
    this.f32.set(v, this.base + s * DIM);
  }

  remove(n: number): void {
    const s = this.slot.get(n);
    if (s === undefined) return;
    const last = this.size - 1;
    if (s !== last) {
      this.f32.copyWithin(this.base + s * DIM, this.base + last * DIM, this.base + (last + 1) * DIM);
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
    const best: Array<{ n: number; score: number }> = [];
    let floor = -Infinity;
    const offer = (s: number, score: number): void => {
      if (best.length === k && score <= floor) return;
      const n = this.ids[s]!;
      if (accept && !accept(n)) return;
      let at = best.length;
      while (at > 0 && best[at - 1]!.score < score) at--;
      best.splice(at, 0, { n, score });
      if (best.length > k) best.pop();
      if (best.length === k) floor = best[k - 1]!.score;
    };
    if (this.scan && this.mem) {
      this.f32.set(q, Q_OFF / 4);
      for (let start = 0; start < this.size; start += CHUNK) {
        const count = Math.min(CHUNK, this.size - start);
        this.scan(DATA_OFF + start * BYTES_PER_VECTOR, Q_OFF, count, OUT_OFF);
        const out = this.f32.subarray(OUT_OFF / 4, OUT_OFF / 4 + count);
        for (let i = 0; i < count; i++) { const sc = out[i]!; if (sc > floor || best.length < k) offer(start + i, sc); }
      }
      return best;
    }
    const d = this.f32;
    for (let s = 0, o = this.base; s < this.size; s++, o += DIM) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0;
      for (let i = 0; i < DIM; i += 8) {
        a0 += d[o + i]! * q[i]!; a1 += d[o + i + 1]! * q[i + 1]!; a2 += d[o + i + 2]! * q[i + 2]!; a3 += d[o + i + 3]! * q[i + 3]!;
        a4 += d[o + i + 4]! * q[i + 4]!; a5 += d[o + i + 5]! * q[i + 5]!; a6 += d[o + i + 6]! * q[i + 6]!; a7 += d[o + i + 7]! * q[i + 7]!;
      }
      const score = ((a0 + a1) + (a2 + a3)) + ((a4 + a5) + (a6 + a7));
      if (score > floor || best.length < k) offer(s, score);
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
