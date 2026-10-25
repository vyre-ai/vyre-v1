// The real embedder (ruling 47): all-MiniLM-L6-v2 quantized ONNX on onnxruntime-web's WASM backend, mean pooled over the attention mask and normalised to unit length (384 dimensions).
// It fits the module's seam: `setEmbedder(createEmbedder(...))` in modules/search. Texts are batched and padded to the longest in the batch.
import { MODEL_FILES, fetchModelFile } from "./model.ts";
import type { Fetch } from "./model.ts";
import { encode, vocabOf } from "./tokenizer.ts";

export const DIM = 384;

interface Tensor { readonly data: unknown; readonly dims: readonly number[] }
interface Session { run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> }
interface Ort {
  InferenceSession: { create(model: Uint8Array, o: Record<string, unknown>): Promise<Session> };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => Tensor;
  env: { wasm: { numThreads: number } };
}

export interface Embedder { (texts: readonly string[]): Promise<Float32Array[]>; readonly maxTokens: number }

export async function createEmbedder(o: { dir?: string; fetch?: Fetch; batch?: number; maxTokens?: number } = {}): Promise<Embedder> {
  const ort = (await import("onnxruntime-web")) as unknown as Ort;
  ort.env.wasm.numThreads = 1;
  const files = { dir: o.dir, fetch: o.fetch } as { dir?: string; fetch?: Fetch };
  const [model, tok] = await Promise.all([fetchModelFile(MODEL_FILES.model, files), fetchModelFile(MODEL_FILES.tokenizer, files)]);
  const vocab = vocabOf(new TextDecoder().decode(tok));
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const batch = o.batch ?? 16;
  const maxTokens = o.maxTokens ?? 128;

  async function run(texts: readonly string[]): Promise<Float32Array[]> {
    const rows = texts.map((t) => encode(t, vocab, maxTokens));
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

  const embed = (async (texts: readonly string[]) => {
    const all: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batch) all.push(...(await run(texts.slice(i, i + batch))));
    return all;
  }) as Embedder;
  (embed as { maxTokens: number }).maxTokens = maxTokens;
  return embed;
}
