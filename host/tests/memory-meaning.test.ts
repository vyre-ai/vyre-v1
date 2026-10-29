// The files of the local embedding model behind memory's meaning search: fetched once from the pinned revision into the data folder and checked against their sha256.
// The network is a stand-in; the real model was run once by hand and is described in the pull request.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_FILES, createModelFiles, fetchModelFile } from "../src/seams/memory-meaning.ts";
import type { MeaningFetch } from "../src/seams/memory-meaning.ts";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-meaning-"));
const sha = (b: Uint8Array): string => crypto.createHash("sha256").update(b).digest("hex");
const tokenizerJson = JSON.stringify({ model: { vocab: { "[PAD]": 0 } } });

/** A network that serves two small "model files" whose hashes are pinned for this test only. */
function files(): { fetch: MeaningFetch; calls: string[]; restore(): void } {
  const model = new Uint8Array([1, 2, 3, 4]);
  const tok = new TextEncoder().encode(tokenizerJson);
  const saved = { model: { ...MODEL_FILES.model }, tokenizer: { ...MODEL_FILES.tokenizer } };
  (MODEL_FILES as { model: unknown }).model = { ...saved.model, sha256: sha(model) };
  (MODEL_FILES as { tokenizer: unknown }).tokenizer = { ...saved.tokenizer, sha256: sha(tok) };
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const body = url.endsWith("tokenizer.json") ? tok : model;
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
    },
    restore() { (MODEL_FILES as { model: unknown }).model = saved.model; (MODEL_FILES as { tokenizer: unknown }).tokenizer = saved.tokenizer; },
  };
}

test("a file is fetched once from the pinned revision into the data folder and checked against its hash", async () => {
  const net = files();
  try {
    const dir = tmp();
    const bytes = await fetchModelFile(MODEL_FILES.model, dir, net.fetch);
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    assert.match(net.calls[0]!, /^https:\/\/huggingface\.co\/Xenova\/all-MiniLM-L6-v2\/resolve\/751bff37182d3f1213fa05d7196b954e230abad9\/onnx\/model_quantized\.onnx$/);
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
    assert.equal(mf.name, "Xenova/all-MiniLM-L6-v2@751bff37");
    assert.equal(net.calls.length, 0, "nothing is fetched until the model is used");
    const got = await mf.load();
    assert.deepEqual([...got.model], [1, 2, 3, 4]);
    assert.equal(got.tokenizer, tokenizerJson);
    assert.equal(net.calls.length, 2);
  } finally { net.restore(); }
});
