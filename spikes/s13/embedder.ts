// The real embedder (rulings 47 and 54): all-MiniLM-L6-v2 quantized ONNX on onnxruntime-node (the host) or onnxruntime-web's WASM backend (clients), mean pooled over the attention mask and normalised to unit length (384 dimensions).
// It fits the module's seam: `setEmbedder(createEmbedder(...))` in modules/search. Texts are batched and padded to the longest in the batch.
import os from "node:os";
import { MODEL_FILES, fetchModelFile } from "./model.ts";
import type { Fetch } from "./model.ts";
import { encode, vocabOf } from "./tokenizer.ts";

export const DIM = 384;

interface Tensor { readonly data: unknown; readonly dims: readonly number[] }
interface Session { run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> }
interface Ort {
  InferenceSession: { create(model: Uint8Array, o: Record<string, unknown>): Promise<Session> };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => Tensor;
  env: { wasm?: { numThreads: number } };
}

/** `node`: onnxruntime-node, the native runtime the host uses (ruling 54). `web`: onnxruntime-web on WASM, what clients use. Same model, same files, same pooling. */
export type Runtime = "node" | "web";

/** A chunk with nothing to embed (empty or only whitespace) is skipped before the model: it gets a zero vector, which scores 0 against everything, and no runtime is asked (ruling 58). */
export const isBlank = (t: string): boolean => t.trim().length === 0;

/** Run `embed` on the non-blank texts only and put the vectors back in the order asked; blank ones are zero vectors. */
export async function embedSkippingBlanks(texts: readonly string[], embed: (t: readonly string[]) => Promise<Float32Array[]>): Promise<Float32Array[]> {
  const idx: number[] = [];
  texts.forEach((t, i) => { if (!isBlank(t)) idx.push(i); });
  const done = idx.length > 0 ? await embed(idx.map((i) => texts[i]!)) : [];
  const out = texts.map(() => new Float32Array(DIM));
  idx.forEach((i, k) => { out[i] = done[k]!; });
  return out;
}

export interface Embedder { (texts: readonly string[]): Promise<Float32Array[]>; readonly maxTokens: number }

export async function createEmbedder(o: { dir?: string; fetch?: Fetch; batch?: number; maxTokens?: number; threads?: number; runtime?: Runtime } = {}): Promise<Embedder> {
  const runtime = o.runtime ?? "node";
  const ort = (runtime === "node" ? await import("onnxruntime-node") : await import("onnxruntime-web")) as unknown as Ort;
  // the host leaves one core to everything else; a client's WASM runtime stays on one thread unless told
  const threads = o.threads ?? (runtime === "node" ? Math.max(1, os.availableParallelism() - 1) : 1);
  if (runtime === "web" && ort.env.wasm) ort.env.wasm.numThreads = threads;
  const files = { dir: o.dir, fetch: o.fetch } as { dir?: string; fetch?: Fetch };
  const [model, tok] = await Promise.all([fetchModelFile(MODEL_FILES.model, files), fetchModelFile(MODEL_FILES.tokenizer, files)]);
  const vocab = vocabOf(new TextDecoder().decode(tok));
  const session = await ort.InferenceSession.create(model, runtime === "node"
    ? { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: threads, interOpNumThreads: 1 }
    : { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const batch = o.batch ?? (runtime === "node" ? 32 : 16);
  const maxTokens = o.maxTokens ?? 128;

  async function run(texts: readonly string[]): Promise<Float32Array[]> {
    const rows = texts.map((t) => encode(t, vocab, maxTokens));
    // (texts of similar length are batched together by the caller, so padding is small)
    const T = Math.max(...rows.map((r) => r.length));
    const B = rows.length;
    const ids = new BigInt64Array(B * T).fill(BigInt(vocab.pad));
    const mask = new BigInt64Array(B * T);
    rows.forEach((r, i) => r.forEach((id, j) => { ids[i * T + j] = BigInt(id); mask[i * T + j] = 1n; }));
    const out = await session.run({
      input_ids: new ort.Tensor("int64", ids, [B, T]),
      attention_mask: new ort.Tensor("int64", mask, [B, T]),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(B * T), [B, T]),
    });
    const hidden = (out["last_hidden_state"] ?? Object.values(out)[0])!.data as Float32Array;
    return rows.map((r, i) => {
      const v = new Float32Array(DIM);
      for (let j = 0; j < r.length; j++) { const at = (i * T + j) * DIM; for (let d = 0; d < DIM; d++) v[d] = v[d]! + hidden[at + d]!; }
      let s = 0;
      for (let d = 0; d < DIM; d++) { v[d] = v[d]! / r.length; s += v[d]! * v[d]!; }
      const k = s === 0 ? 0 : 1 / Math.sqrt(s);
      for (let d = 0; d < DIM; d++) v[d] = v[d]! * k;
      return v;
    });
  }

  const embed = ((texts: readonly string[]) => embedSkippingBlanks(texts, async (live) => {
    // batch by length so a short text is not padded to a long one, then put the vectors back in the order asked
    const order = live.map((t, i) => ({ i, n: t.length })).sort((a, b) => a.n - b.n);
    const out = new Array<Float32Array>(live.length);
    for (let s = 0; s < order.length; s += batch) {
      const part = order.slice(s, s + batch);
      const vs = await run(part.map((x) => live[x.i]!));
      part.forEach((x, j) => { out[x.i] = vs[j]!; });
    }
    return out;
  })) as Embedder;
  (embed as { maxTokens: number }).maxTokens = maxTokens;
  return embed;
}
