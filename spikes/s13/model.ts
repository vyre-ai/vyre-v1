// The embedding model files (ruling 47): all-MiniLM-L6-v2, quantized ONNX, from Hugging Face (Xenova/all-MiniLM-L6-v2, Apache-2.0), pinned to one revision and checked by sha256.
// CI downloads each file once into the runner cache; the product fetches them at install into the Space's data folder, never at query time. A file whose hash differs is deleted and refused.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODEL_REPO = "Xenova/all-MiniLM-L6-v2";
export const MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";

export interface ModelFile { path: string; sha256: string; bytes: number }

export const MODEL_FILES: Readonly<Record<"model" | "tokenizer" | "config", ModelFile>> = {
  model: { path: "onnx/model_quantized.onnx", sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1", bytes: 22_972_370 },
  tokenizer: { path: "tokenizer.json", sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0", bytes: 711_661 },
  config: { path: "config.json", sha256: "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7", bytes: 650 },
};

export class ModelError extends Error {
  readonly code: "hash_mismatch" | "download_failed";
  constructor(code: ModelError["code"], message: string) { super(message); this.name = "ModelError"; this.code = code; }
}

export const sha256Hex = (b: Uint8Array): string => crypto.createHash("sha256").update(b).digest("hex");
export const urlOf = (f: ModelFile, revision = MODEL_REVISION): string => `https://huggingface.co/${MODEL_REPO}/resolve/${revision}/${f.path}`;
/** Where the files live: the runner cache (VYRE_MODEL_CACHE) or, for the product, the Space's data folder. */
export const cacheDir = (): string => process.env["VYRE_MODEL_CACHE"] ?? path.join(os.tmpdir(), "vyre-models", MODEL_REVISION);

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Return the bytes of one pinned file: from the cache when its hash holds, else downloaded, hashed and stored. A wrong hash is never stored and never returned. */
export async function fetchModelFile(f: ModelFile, o: { dir?: string; fetch?: Fetch } = {}): Promise<Uint8Array> {
  const dir = o.dir ?? cacheDir();
  const file = path.join(dir, f.path);
  if (fs.existsSync(file)) {
    const have = new Uint8Array(fs.readFileSync(file));
    if (sha256Hex(have) === f.sha256) return have;
    fs.rmSync(file, { force: true }); // a damaged cache entry is replaced, not trusted
  }
  const res = await (o.fetch ?? (globalThis.fetch as unknown as Fetch))(urlOf(f));
  if (!res.ok) throw new ModelError("download_failed", `${f.path}: HTTP ${res.status}`);
  const got = new Uint8Array(await res.arrayBuffer());
  const hash = sha256Hex(got);
  if (hash !== f.sha256) throw new ModelError("hash_mismatch", `${f.path}: sha256 ${hash} is not the pinned ${f.sha256}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, got);
  fs.renameSync(tmp, file);
  return got;
}
