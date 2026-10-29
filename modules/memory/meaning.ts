// Meaning search (owner design 30 Oct 2026, ruling 7): a small embedding model on each server finds what a question means, not only the words it shares, and the result is blended with the keyword
// (BM25) and trigram scores that stay. The model is a host seam: the host binds a local one (a MiniLM-class model that runs from Node and is downloaded on first use into the Space data folder) and
// the memory key's provider can stand in for it (setting memory.meaning_search: local, key or off). With no model, a model still loading, or a model that fails, search is keyword search and says so
// in `meaning`; "not set up" reads healthy.
// Vectors of shared text (agent, project and Space layers, notes) are kept in memory_vectors keyed by the text's hash, so an edit is re-embedded and nothing else is. A personal layer is never kept as
// vectors: its text is embedded for the question and dropped, so nothing derived from personal text sits in a table.
import { createLocalEmbedder } from "./local-embedder.ts";
import type { ModelFiles } from "./local-embedder.ts";
import { meaningMode } from "./policy.ts";
import { num, rowsOf, str } from "./projections.ts";
import type { MemCtx } from "./projections.ts";

export type EmbedderState = "ready" | "loading" | "not_set_up" | "failed";
export interface Embedder {
  /** Model name, kept with each vector so a changed model re-embeds. */
  name: string;
  dim: number;
  status(): { state: EmbedderState; detail?: string };
  /** One unit-length vector per text. Rejects when the model is not ready. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

const seams: { local: Embedder | null; key: Embedder | null } = { local: null, key: null };
/** Bind the local model (the host) or the memory key's provider (key resolution). null unbinds. */
export function setEmbedder(kind: "local" | "key", e: Embedder | null): void { seams[kind] = e; }

export interface MeaningHost {
  /** A ready-made embedder (tests, or a host that runs its own). */
  local?: Embedder | null;
  /** The model files, fetched on first use and checked against pinned hashes; the module runs the model on them. */
  files?: ModelFiles | null;
  now?: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}
/** The host's single call: it hands over the model files (or an embedder of its own). null unbinds. */
export function configureMeaning(host: MeaningHost | null): void {
  seams.local = host?.local ?? (host?.files ? createLocalEmbedder({ files: host.files, ...(host.now ? { now: host.now } : {}), ...(host.log ? { log: host.log } : {}) }) : null);
}

export type MeaningState = "on" | "loading" | "not_set_up" | "degraded" | "off";
export interface MeaningStatus { mode: "local" | "key" | "off"; state: MeaningState; model?: string; hint?: string }

/** Cosine similarity of two unit vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i]! * b[i]!;
  return d;
}

/** Below this a document is not "about" the question. Tuned for MiniLM-class models; the blend keeps keyword hits whatever this says. */
export const MEANING_MIN = 0.3;
const NEW_SHARED_PER_CALL = 256;
const PERSONAL_PER_CALL = 128;

function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${s.length}`;
}

export async function meaningStatus(ctx: Pick<MemCtx, "call">): Promise<MeaningStatus & { embedder: Embedder | null }> {
  const mode = await meaningMode(ctx);
  if (mode === "off") return { mode, state: "off", hint: "Meaning search is turned off. Keyword search is in use.", embedder: null };
  const e = mode === "key" ? seams.key : seams.local;
  if (!e) {
    return {
      mode, state: "not_set_up", embedder: null,
      hint: mode === "key" ? "Meaning search uses the memory key, and no memory key is chosen. Keyword search is in use." : "Meaning search is not set up on this server. Keyword search is in use.",
    };
  }
  const s = e.status();
  if (s.state === "ready") return { mode, state: "on", model: e.name, embedder: e };
  if (s.state === "loading") return { mode, state: "loading", model: e.name, hint: s.detail ?? "Meaning search is getting ready. Keyword search is in use until it is.", embedder: null };
  if (s.state === "not_set_up") return { mode, state: "not_set_up", model: e.name, hint: s.detail ?? "Meaning search is not set up on this server. Keyword search is in use.", embedder: null };
  return { mode, state: "degraded", model: e.name, hint: s.detail ?? "Meaning search could not start. Keyword search is in use.", embedder: null };
}

export interface MeaningDoc { kind: "fact" | "note" | "page"; id: string; text: string; shared: boolean }
export interface MeaningResult { scores: Map<string, number> | null; status: MeaningStatus }

const keyOf = (d: Pick<MeaningDoc, "kind" | "id">): string => `${d.kind}:${d.id}`;

/** Cosine of the question against each document, or scores null when search has to stay keyword-only. */
export async function meaningScores(ctx: MemCtx, docs: MeaningDoc[], query: string): Promise<MeaningResult> {
  const st = await meaningStatus(ctx);
  const { embedder, ...status } = st;
  if (!embedder) return { scores: null, status };
  try {
    const [q] = await embedder.embed([query]);
    if (!q) return { scores: null, status: { ...status, state: "degraded", hint: "Meaning search returned nothing. Keyword search is in use." } };
    const scores = new Map<string, number>();
    const vecs = new Map<string, Float32Array>();
    const shared = docs.filter((d) => d.shared && d.text.trim() !== "");
    // vectors already kept for shared text whose hash has not changed
    for (const kind of ["fact", "note", "page"] as const) {
      const mine = shared.filter((d) => d.kind === kind);
      if (mine.length === 0) continue;
      const have = new Map<string, { hash: string; vec: Uint8Array }>();
      for (const r of rowsOf(ctx.db, "SELECT doc_id, text_hash, vec FROM memory_vectors WHERE doc_kind = ? AND model = ?", kind, embedder.name)) have.set(str(r["doc_id"]), { hash: str(r["text_hash"]), vec: r["vec"] as Uint8Array });
      const missing: MeaningDoc[] = [];
      for (const d of mine) {
        const h = have.get(d.id);
        if (h && h.hash === hashOf(d.text)) vecs.set(keyOf(d), new Float32Array(h.vec.buffer.slice(h.vec.byteOffset, h.vec.byteOffset + h.vec.byteLength)));
        else missing.push(d);
      }
      const batch = missing.slice(0, NEW_SHARED_PER_CALL);
      if (batch.length > 0) {
        const out = await embedder.embed(batch.map((d) => d.text));
        batch.forEach((d, i) => {
          const v = out[i];
          if (!v) return;
          vecs.set(keyOf(d), v);
          ctx.db.run(
            "INSERT OR REPLACE INTO memory_vectors (doc_kind, doc_id, model, text_hash, dim, vec, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            d.kind, d.id, embedder.name, hashOf(d.text), v.length, new Uint8Array(v.buffer, v.byteOffset, v.byteLength), ctx.now(),
          );
        });
      }
    }
    // personal text: embedded for this question and dropped
    const personal = docs.filter((d) => !d.shared && d.text.trim() !== "").slice(0, PERSONAL_PER_CALL);
    if (personal.length > 0) {
      const out = await embedder.embed(personal.map((d) => d.text));
      personal.forEach((d, i) => { const v = out[i]; if (v) vecs.set(keyOf(d), v); });
    }
    for (const d of docs) { const v = vecs.get(keyOf(d)); if (v) scores.set(keyOf(d), cosine(q, v)); }
    return { scores, status };
  } catch {
    return { scores: null, status: { ...status, state: "degraded", hint: "Meaning search could not run just now. Keyword search is in use." } };
  }
}

/** How many shared documents have a vector, for the status line. */
export function indexedCount(ctx: MemCtx, model: string | undefined): number {
  if (!model) return 0;
  return num(rowsOf(ctx.db, "SELECT COUNT(*) AS n FROM memory_vectors WHERE model = ?", model)[0]?.["n"]);
}

/** Drop the vectors of documents that are gone, trashed or no longer current. */
export function dropVectors(ctx: MemCtx, kind: "fact" | "note" | "page", ids: string[]): void {
  for (const id of ids) ctx.db.run("DELETE FROM memory_vectors WHERE doc_kind = ? AND doc_id = ?", kind, id);
}
