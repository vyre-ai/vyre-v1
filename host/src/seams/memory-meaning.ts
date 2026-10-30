// The files of the local embedding model behind memory's meaning search (owner design 30 Oct 2026, ruling 7; rulings 47 and 54): bge-small-en-v1.5, quantized ONNX (Xenova/bge-small-en-v1.5, MIT).
// Nothing is in git and no text leaves the server: the model files (about 35 MB) and the WebAssembly runtime (about 14 MB) are downloaded the first time meaning search is used into <data dir>/models/<revision>/, pinned to one revision and checked by
// sha256 (a file with another hash is deleted and refused). The memory module runs the model (modules/memory/local-embedder.ts); it never imports this file and the host never imports the module: the files
// are handed over through the module's `hostSeams.setMemoryMeaningHost`.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import fs from "node:fs";
import path from "node:path";

export const MODEL_REPO = "Xenova/bge-small-en-v1.5";
export const MODEL_REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
export const RUNTIME_VERSION = "1.30.0";

export interface ModelFile { path: string; sha256: string; bytes: number; url?: string }
export const MODEL_FILES: Readonly<Record<"model" | "tokenizer", ModelFile>> = {
  model: { path: "onnx/model_quantized.onnx", sha256: "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4", bytes: 34_014_426 },
  tokenizer: { path: "tokenizer.json", sha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66", bytes: 711_396 },
};
/** The WebAssembly runtime (onnxruntime-web, MIT): three small files, not the package, fetched once from the npm CDN at the pinned version and checked by sha256. About 14 MB; nothing of it is in the install. */
export const RUNTIME_FILES: Readonly<Record<"entry" | "loader" | "wasm", ModelFile>> = {
  entry: { path: "ort.wasm.min.mjs", sha256: "219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b", bytes: 50_126 },
  loader: { path: "ort-wasm-simd-threaded.mjs", sha256: "e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b", bytes: 24_381 },
  wasm: { path: "ort-wasm-simd-threaded.wasm", sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2", bytes: 14_239_897 },
};

export type MeaningFetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
const urlOf = (f: ModelFile): string => f.url ?? `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${f.path}`;
const runtimeUrl = (f: ModelFile): string => `https://cdn.jsdelivr.net/npm/onnxruntime-web@${RUNTIME_VERSION}/dist/${f.path}`;

/** The bytes of one pinned file: from the data folder when its hash holds, else downloaded, hashed and stored. A wrong hash is never stored and never returned. */
export async function fetchModelFile(f: ModelFile, dir: string, fetchFn: MeaningFetch): Promise<Uint8Array> {
  const file = path.join(dir, f.path);
  if (fs.existsSync(file)) {
    const have = new Uint8Array(fs.readFileSync(file));
    if (sha256Hex(have) === f.sha256) return have;
    fs.rmSync(file, { force: true });
  }
  const res = await fetchFn(urlOf(f));
  if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`);
  const got = new Uint8Array(await res.arrayBuffer());
  const hash = sha256Hex(got);
  if (hash !== f.sha256) throw new Error(`${f.path}: sha256 ${hash} is not the pinned ${f.sha256}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, got);
  fs.renameSync(tmp, file);
  return got;
}


export interface ModelFiles { name: string; load(): Promise<{ model: Uint8Array; tokenizer: string; runtimeDir: string }> }

/** The pinned model and runtime files under `root`, fetched on first use. `runtimeDir` is the folder that holds the verified runtime. */
export function createModelFiles(o: { root: string; fetch?: MeaningFetch }): ModelFiles {
  const dir = path.join(o.root, "models", MODEL_REVISION);
  const runtimeDir = path.join(o.root, "models", `onnxruntime-web-${RUNTIME_VERSION}`);
  const fetchFn = o.fetch ?? (globalThis.fetch as unknown as MeaningFetch);
  return {
    name: `${MODEL_REPO}@${MODEL_REVISION.slice(0, 8)}`,
    async load() {
      const [model, tok] = await Promise.all([fetchModelFile(MODEL_FILES.model, dir, fetchFn), fetchModelFile(MODEL_FILES.tokenizer, dir, fetchFn)]);
      for (const f of Object.values(RUNTIME_FILES)) await fetchModelFile({ ...f, url: runtimeUrl(f) }, runtimeDir, fetchFn);
      return { model, tokenizer: new TextDecoder().decode(tok), runtimeDir };
    },
  };
}
