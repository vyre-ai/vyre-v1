// The local embedding model behind meaning search (owner design 30 Oct 2026, ruling 7; rulings 47 and 54): bge-small-en-v1.5, quantized ONNX, run from Node on the WebAssembly build of onnxruntime (loaded from the data folder, nothing of it in the install), CLS pooled
// and normalised to unit length (384 dimensions). The host owns the files (it fetches them on first use into the Space data folder and checks them against pinned hashes) and hands them
// over through ModelFiles; this file owns the tokenizer, the runtime and the state a search sees: not set up, loading, ready, or failed (retried after ten minutes). While it is not ready, search is
// keyword search and says so.
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Embedder, EmbedderState } from "./meaning.ts";

export const DIM = 384;
/** Cosine at or above which this model calls two texts related: chosen on the 30 pairs in fixtures/meaning-pairs.ts (every related pair scores at least 0.578, every unrelated one at most 0.563 on the shipped runtime). */
export const LOCAL_MIN_SCORE = 0.57;
const RETRY_AFTER_MS = 10 * 60_000;

/** The model's two files, as the host hands them over: it reads them from its data folder, fetching on first use, and refuses a file whose hash is not the pinned one. */
export interface ModelFiles { name: string; load(): Promise<{ model: Uint8Array; tokenizer: string; runtimeDir?: string }> }

// ---- BERT WordPiece (uncased), as all-MiniLM-L6-v2 uses it

export interface Vocab { ids: ReadonlyMap<string, number>; unk: number; cls: number; sep: number; pad: number }

export function vocabOf(tokenizerJson: string): Vocab {
  const j = JSON.parse(tokenizerJson) as { model: { vocab: Record<string, number> } };
  const ids = new Map(Object.entries(j.model.vocab));
  const need = (t: string): number => { const v = ids.get(t); if (v === undefined) throw new Error(`the tokenizer has no ${t}`); return v; };
  return { ids, unk: need("[UNK]"), cls: need("[CLS]"), sep: need("[SEP]"), pad: need("[PAD]") };
}

const isPunct = (c: string): boolean => /[\p{P}\p{S}]/u.test(c) || (c >= "!" && c <= "/") || (c >= ":" && c <= "@") || (c >= "[" && c <= "`") || (c >= "{" && c <= "~");

/** Words as the model sees them: lowercased, accents removed, punctuation its own word. */
export function basicWords(text: string): string[] {
  const clean = text.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  const words: string[] = [];
  let cur = "";
  for (const c of clean) {
    if (/\s/u.test(c)) { if (cur) { words.push(cur); cur = ""; } }
    else if (isPunct(c)) { if (cur) { words.push(cur); cur = ""; } words.push(c); }
    else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

export function wordpiece(word: string, v: Vocab): number[] {
  const chars = [...word];
  if (chars.length > 100) return [v.unk];
  const out: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found: number | undefined;
    while (start < end) {
      const id = v.ids.get((start > 0 ? "##" : "") + chars.slice(start, end).join(""));
      if (id !== undefined) { found = id; break; }
      end--;
    }
    if (found === undefined) return [v.unk];
    out.push(found);
    start = end;
  }
  return out;
}

/** [CLS] pieces [SEP], cut to `max` tokens (the last one stays [SEP]). */
export function encode(text: string, v: Vocab, max = 128): number[] {
  const body: number[] = [];
  for (const w of basicWords(text)) { body.push(...wordpiece(w, v)); if (body.length >= max - 2) break; }
  return [v.cls, ...body.slice(0, max - 2), v.sep];
}

// ---- the embedder

interface Tensor { readonly data: unknown; readonly dims: readonly number[] }
interface Session { run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> }
export interface OrtLike {
  InferenceSession: { create(model: Uint8Array, o: Record<string, unknown>): Promise<Session> };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => Tensor;
}


export interface LocalEmbedderOptions {
  files: ModelFiles;
  ort?: () => Promise<OrtLike>;
  now?: () => number;
  threads?: number;
  batch?: number;
  maxTokens?: number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/**
 * The WebAssembly build of onnxruntime from the folder the host verified (three files, about 14 MB, fetched the first time and checked against pinned hashes). Nothing of the runtime is in the install,
 * and it is loaded from that folder only; one thread, since the model is small and a search embeds a handful of texts.
 */
async function wasmRuntime(dir: string | undefined): Promise<OrtLike> {
  if (!dir) throw new Error("the runtime folder was not provided");
  const url = pathToFileURL(path.join(dir, "ort.wasm.min.mjs")).href;
  const ort = (await import(url)) as unknown as OrtLike & { env: { wasm: { wasmPaths: string; numThreads: number } } };
  ort.env.wasm.wasmPaths = `${pathToFileURL(dir).href}/`;
  ort.env.wasm.numThreads = 1;
  return ort;
}

export function createLocalEmbedder(o: LocalEmbedderOptions): Embedder {
  const now = o.now ?? Date.now;
  const threads = o.threads ?? Math.max(1, os.availableParallelism() - 1);
  const batch = o.batch ?? 32;
  const maxTokens = o.maxTokens ?? 128;
  let state: EmbedderState = "not_set_up";
  let detail: string | undefined;
  let failedAt = 0;
  let ready: ((texts: readonly string[]) => Promise<Float32Array[]>) | null = null;
  let loading: Promise<void> | null = null;

  async function load(): Promise<void> {
    const { model, tokenizer, runtimeDir } = await o.files.load();
    const ort = await (o.ort ? o.ort() : wasmRuntime(runtimeDir));
    const vocab = vocabOf(tokenizer);
    const session = await ort.InferenceSession.create(model, { executionProviders: [o.ort ? "cpu" : "wasm"], graphOptimizationLevel: "all", intraOpNumThreads: threads, interOpNumThreads: 1 });
    async function run(texts: readonly string[]): Promise<Float32Array[]> {
      const rows = texts.map((t) => encode(t, vocab, maxTokens));
      const T = Math.max(...rows.map((r) => r.length));
      const B = rows.length;
      const ids = new BigInt64Array(B * T).fill(BigInt(vocab.pad));
      const mask = new BigInt64Array(B * T);
      rows.forEach((r, i) => r.forEach((id, j) => { ids[i * T + j] = BigInt(id); mask[i * T + j] = 1n; }));
      const out = await session.run({
        input_ids: new ort.Tensor("int64", ids, [B, T]), attention_mask: new ort.Tensor("int64", mask, [B, T]), token_type_ids: new ort.Tensor("int64", new BigInt64Array(B * T), [B, T]),
      });
      const hidden = (out["last_hidden_state"] ?? Object.values(out)[0])!.data as Float32Array;
      return rows.map((r, i) => {
        // CLS pooling: the vector of the first token stands for the text
        const v = new Float32Array(DIM);
        let s = 0;
        for (let d = 0; d < DIM; d++) { v[d] = hidden[i * T * DIM + d]!; s += v[d]! * v[d]!; }
        const k = s === 0 ? 0 : 1 / Math.sqrt(s);
        for (let d = 0; d < DIM; d++) v[d] = v[d]! * k;
        return v;
      });
    }
    ready = async (texts) => {
      // a blank text has nothing to embed: a zero vector, which scores 0 against everything
      const live = texts.map((t, i) => ({ t, i })).filter((x) => x.t.trim() !== "");
      const out = texts.map(() => new Float32Array(DIM));
      const order = [...live].sort((a, b) => a.t.length - b.t.length);
      for (let s = 0; s < order.length; s += batch) {
        const part = order.slice(s, s + batch);
        const vs = await run(part.map((x) => x.t));
        part.forEach((x, j) => { out[x.i] = vs[j]!; });
      }
      return out;
    };
  }

  /** Start loading when nothing is loading and the last failure is old enough. */
  function kick(): void {
    if (loading || state === "ready") return;
    if (state === "failed" && now() - failedAt < RETRY_AFTER_MS) return;
    state = "loading";
    detail = "Meaning search is getting ready: the language model is being fetched the first time (about 23 MB).";
    loading = load().then(() => { state = "ready"; detail = undefined; o.log?.("meaning model ready"); }, (e: unknown) => {
      state = "failed";
      failedAt = now();
      detail = "The language model for meaning search could not be loaded, so keyword search is in use. It tries again later.";
      o.log?.("meaning model failed", { reason: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }).finally(() => { loading = null; });
  }

  return {
    name: o.files.name,
    minScore: LOCAL_MIN_SCORE,
    dim: DIM,
    status() {
      if (state === "not_set_up" || (state === "failed" && now() - failedAt >= RETRY_AFTER_MS)) kick();
      return { state, ...(detail ? { detail } : {}) };
    },
    async embed(texts) {
      kick();
      if (state !== "ready" || !ready) throw new Error("the meaning model is not ready");
      return ready(texts);
    },
  };
}
