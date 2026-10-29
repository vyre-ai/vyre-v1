// The files of the local embedding model behind memory's meaning search (owner design 30 Oct 2026, ruling 7; rulings 47 and 54): all-MiniLM-L6-v2, quantized ONNX (Xenova/all-MiniLM-L6-v2, Apache-2.0).
// Nothing is in git and no text leaves the server: the two files (about 23 MB) are downloaded the first time meaning search is used into <data dir>/models/<revision>/, pinned to one revision and checked by
// sha256 (a file with another hash is deleted and refused). The memory module runs the model (modules/memory/local-embedder.ts); it never imports this file and the host never imports the module: the files
// are handed over through the module's `hostSeams.setMemoryMeaningHost`.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import fs from "node:fs";
import path from "node:path";

export const MODEL_REPO = "Xenova/all-MiniLM-L6-v2";
export const MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";

export interface ModelFile { path: string; sha256: string; bytes: number }
export const MODEL_FILES: Readonly<Record<"model" | "tokenizer", ModelFile>> = {
  model: { path: "onnx/model_quantized.onnx", sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1", bytes: 22_972_370 },
  tokenizer: { path: "tokenizer.json", sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0", bytes: 711_661 },
};

export type MeaningFetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
const urlOf = (f: ModelFile): string => `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${f.path}`;

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


export interface ModelFiles { name: string; load(): Promise<{ model: Uint8Array; tokenizer: string }> }

/** The pinned model files under `root`, fetched on first use. */
export function createModelFiles(o: { root: string; fetch?: MeaningFetch }): ModelFiles {
  const dir = path.join(o.root, "models", MODEL_REVISION);
  const fetchFn = o.fetch ?? (globalThis.fetch as unknown as MeaningFetch);
  return {
    name: `${MODEL_REPO}@${MODEL_REVISION.slice(0, 8)}`,
    async load() {
      const [model, tok] = await Promise.all([fetchModelFile(MODEL_FILES.model, dir, fetchFn), fetchModelFile(MODEL_FILES.tokenizer, dir, fetchFn)]);
      return { model, tokenizer: new TextDecoder().decode(tok) };
    },
  };
}
