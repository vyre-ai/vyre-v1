// The files of the local embedding model behind memory's meaning search: fetched once from the pinned revision into the data folder and checked against their sha256.
// The network is a stand-in; the real model was run once by hand and is described in the pull request.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_FILES, RUNTIME_FILES, createModelFiles, fetchModelFile } from "../src/seams/memory-meaning.ts";
import type { MeaningFetch } from "../src/seams/memory-meaning.ts";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-meaning-"));
const sha = (b: Uint8Array): string => crypto.createHash("sha256").update(b).digest("hex");
const tokenizerJson = JSON.stringify({ model: { vocab: { "[PAD]": 0 } } });

/** A network that serves small stand-ins for the model, tokenizer and runtime files, whose hashes are pinned for this test only. */
function files(): { fetch: MeaningFetch; calls: string[]; restore(): void } {
  const model = new Uint8Array([1, 2, 3, 4]);
  const tok = new TextEncoder().encode(tokenizerJson);
  const rt = { entry: new Uint8Array([7]), loader: new Uint8Array([8]), wasm: new Uint8Array([9, 9]) };
  const saved = { model: { ...MODEL_FILES.model }, tokenizer: { ...MODEL_FILES.tokenizer }, runtime: { ...RUNTIME_FILES } };
  (MODEL_FILES as { model: unknown }).model = { ...saved.model, sha256: sha(model) };
  (MODEL_FILES as { tokenizer: unknown }).tokenizer = { ...saved.tokenizer, sha256: sha(tok) };
  for (const k of ["entry", "loader", "wasm"] as const) (RUNTIME_FILES as Record<string, unknown>)[k] = { ...saved.runtime[k], sha256: sha(rt[k]) };
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const body = url.endsWith("tokenizer.json") ? tok : url.endsWith("ort.wasm.min.mjs") ? rt.entry : url.endsWith("simd-threaded.mjs") ? rt.loader : url.endsWith(".wasm") ? rt.wasm : model;
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
    },
    restore() {
      (MODEL_FILES as { model: unknown }).model = saved.model; (MODEL_FILES as { tokenizer: unknown }).tokenizer = saved.tokenizer;
      for (const k of ["entry", "loader", "wasm"] as const) (RUNTIME_FILES as Record<string, unknown>)[k] = saved.runtime[k];
    },
  };
}

test("a file is fetched once from the pinned revision into the data folder and checked against its hash", async () => {
  const net = files();
  try {
    const dir = tmp();
    const bytes = await fetchModelFile(MODEL_FILES.model, dir, net.fetch);
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    assert.match(net.calls[0]!, /^https:\/\/huggingface\.co\/Xenova\/bge-small-en-v1\.5\/resolve\/ea104dacec62c0de699686887e3f920caeb4f3e3\/onnx\/model_quantized\.onnx$/);
    await fetchModelFile(MODEL_FILES.model, dir, net.fetch);
    assert.equal(net.calls.length, 1, "the second time it is read from the data folder");
    fs.writeFileSync(path.join(dir, MODEL_FILES.model.path), "tampered");
    await fetchModelFile(MODEL_FILES.model, dir, net.fetch);
    assert.equal(net.calls.length, 2, "a damaged file is replaced, not trusted");
    const bad = tmp();
    await assert.rejects(() => fetchModelFile(MODEL_FILES.tokenizer, bad, async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("{}").buffer as ArrayBuffer })), /sha256/);
    assert.equal(fs.existsSync(path.join(bad, MODEL_FILES.tokenizer.path)), false, "a wrong hash is never stored");
  } finally { net.restore(); }
});

test("the model files are handed over as bytes and text under a name that carries the revision", async () => {
  const net = files();
  try {
    const mf = createModelFiles({ root: tmp(), fetch: net.fetch });
    assert.equal(mf.name, "Xenova/bge-small-en-v1.5@ea104dac");
    assert.equal(net.calls.length, 0, "nothing is fetched until the model is used");
    const got = await mf.load();
    assert.deepEqual([...got.model], [1, 2, 3, 4]);
    assert.equal(got.tokenizer, tokenizerJson);
    assert.equal(net.calls.length, 5, "model, tokenizer and the three runtime files");
    assert.ok(net.calls.filter((u) => u.includes("onnxruntime-web@1.30.0/dist/")).length === 3, "the runtime comes from the pinned version");
    assert.deepEqual(fs.readdirSync(got.runtimeDir).sort(), ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm", "ort.wasm.min.mjs"]);
    await mf.load();
    assert.equal(net.calls.length, 5, "the second time everything comes from the data folder");
  } finally { net.restore(); }
});
