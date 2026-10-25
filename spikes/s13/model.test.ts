// S13: the pinned model files and the tokenizer, without the network and without the model: a download whose hash differs is refused and never stored, a cached file is trusted only by hash,
// and WordPiece splits as BERT does. The real model runs in bench.ts on the perf runners.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_FILES, MODEL_REVISION, ModelError, fetchModelFile, sha256Hex, urlOf } from "./model.ts";
import type { Fetch, ModelFile } from "./model.ts";
import { basicWords, encode, vocabOf, wordpiece } from "./tokenizer.ts";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-s13-"));
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);
const fileFor = (content: string): ModelFile => ({ path: "x/file.bin", sha256: sha256Hex(bytesOf(content)), bytes: content.length });
const serve = (content: string, hits: string[]): Fetch => async (url) => { hits.push(url); return { ok: true, status: 200, arrayBuffer: async () => bytesOf(content).buffer as ArrayBuffer }; };

test("the model is pinned to one revision and three sha256 values, in the URL and in the table", () => {
  assert.match(MODEL_REVISION, /^[0-9a-f]{40}$/);
  for (const f of Object.values(MODEL_FILES)) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(urlOf(f).includes(`/resolve/${MODEL_REVISION}/`), "never `main`");
    assert.ok(urlOf(f).startsWith("https://huggingface.co/Xenova/all-MiniLM-L6-v2/"));
  }
  assert.equal(MODEL_FILES.model.path, "onnx/model_quantized.onnx");
});

test("a download is hashed before it is stored; a wrong hash is refused and leaves nothing in the cache", async () => {
  const dir = tmp();
  const hits: string[] = [];
  const good = fileFor("the real bytes");
  assert.deepEqual([...(await fetchModelFile(good, { dir, fetch: serve("the real bytes", hits) }))], [...bytesOf("the real bytes")]);
  assert.equal(hits.length, 1);
  await fetchModelFile(good, { dir, fetch: serve("never asked", hits) });
  assert.equal(hits.length, 1, "the second call is served from the cache");
  const dir2 = tmp();
  await assert.rejects(() => fetchModelFile(good, { dir: dir2, fetch: serve("tampered bytes", []) }), (e: unknown) => e instanceof ModelError && e.code === "hash_mismatch");
  assert.equal(fs.existsSync(path.join(dir2, good.path)), false, "nothing stored");
  await assert.rejects(() => fetchModelFile(good, { dir: tmp(), fetch: async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }) }), (e: unknown) => e instanceof ModelError && e.code === "download_failed");
});

test("a damaged cache entry is replaced, not trusted", async () => {
  const dir = tmp();
  const f = fileFor("good");
  fs.mkdirSync(path.join(dir, "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, f.path), "bad!");
  const hits: string[] = [];
  assert.equal(new TextDecoder().decode(await fetchModelFile(f, { dir, fetch: serve("good", hits) })), "good");
  assert.equal(hits.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, f.path), "utf8"), "good");
});

const VOCAB = vocabOf(JSON.stringify({ model: { vocab: Object.fromEntries(["[PAD]", "[UNK]", "[CLS]", "[SEP]", "harbor", "lease", "un", "##aff", "##able", ",", "cafe", "the"].map((t, i) => [t, i])) } }));

test("WordPiece: lowercase, accents off, punctuation apart, longest piece first, unknown words are [UNK]", () => {
  assert.deepEqual(basicWords("The Harbor, Lease!"), ["the", "harbor", ",", "lease", "!"]);
  assert.deepEqual(basicWords("Café  déjà"), ["cafe", "deja"]);
  assert.deepEqual(wordpiece("unaffable", VOCAB), [6, 7, 8]);
  assert.deepEqual(wordpiece("zzz", VOCAB), [VOCAB.unk]);
  assert.deepEqual(encode("The harbor lease, café", VOCAB), [VOCAB.cls, 11, 4, 5, 9, 10, VOCAB.sep]);
  assert.deepEqual(encode("", VOCAB), [VOCAB.cls, VOCAB.sep]);
  const long = encode("harbor ".repeat(500), VOCAB, 16);
  assert.equal(long.length, 16);
  assert.equal(long[15], VOCAB.sep, "the cut text still ends in [SEP]");
});
