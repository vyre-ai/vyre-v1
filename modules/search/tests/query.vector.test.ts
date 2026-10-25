// Vectors (spec b11, ARCH R14 spike S13): brute-force cosine over 200,000 vectors of 384 dimensions in under 60 ms, the same answer from the WebAssembly kernel and the plain
// JavaScript one, replace and remove, and the table round trip that lets another process keep the in-memory copy honest.
import test from "node:test";
import assert from "node:assert/strict";
import { embedRun } from "../handlers/index.ts";
import { DIM, VectorIndex, decodeVector, embed, encodeVector, forgetVectors, hashEmbed, normalise, vectorsOf, writeVector } from "../projections.ts";
import { harness, randomUnit, seed } from "../fixtures/harness.ts";

test("cosine over 200,000 vectors of 384 dimensions takes under 60 ms (median of five, one warm-up)", () => {
  const N = 200_000;
  const index = new VectorIndex(N);
  const v = new Float32Array(DIM);
  for (let i = 0; i < N; i++) index.set(i + 1, randomUnit(i + 1, v));
  assert.equal(index.size, N);
  assert.equal(index.kernel, "wasm", "the SIMD kernel is what runs on the runner");
  const q = randomUnit(777_777);
  index.top(q, 20); // warm-up: not counted
  const times: number[] = [];
  let top: Array<{ n: number; score: number }> = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    top = index.top(q, 20);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[2]!;
  assert.equal(top.length, 20);
  assert.ok(top.every((t, i) => i === 0 || top[i - 1]!.score >= t.score), "best first");
  assert.ok(median < 60, `cosine over ${N} vectors: median ${median.toFixed(1)} ms of ${times.map((t) => t.toFixed(0)).join(", ")} ms is over 60 ms`);
});

test("the WebAssembly kernel and the JavaScript kernel return the same neighbours with the same scores", () => {
  const wasm = new VectorIndex(512);
  const js = new VectorIndex(512, { wasm: false });
  assert.equal(js.kernel, "js");
  const v = new Float32Array(DIM);
  for (let i = 0; i < 5_000; i++) { randomUnit(i + 1, v); wasm.set(i + 1, v); js.set(i + 1, v); } // grows past its first capacity twice
  for (const seedN of [1, 42, 9_001]) {
    const q = randomUnit(seedN * 31);
    const a = wasm.top(q, 15);
    const b = js.top(q, 15);
    assert.deepEqual(a.map((x) => x.n), b.map((x) => x.n));
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i]!.score - b[i]!.score) < 1e-4, `score ${i}: ${a[i]!.score} against ${b[i]!.score}`);
  }
  // a vector asked about itself is its own nearest neighbour with cosine 1
  const self = randomUnit(123);
  const hit = wasm.top(self, 1)[0]!;
  assert.equal(hit.n, 123);
  assert.ok(Math.abs(hit.score - 1) < 1e-4);
});

test("set replaces, remove swaps the last vector into the gap, and an accept filter narrows the scan", () => {
  for (const o of [{}, { wasm: false }]) {
    const index = new VectorIndex(4, o);
    const a = randomUnit(1), b = randomUnit(2), c = randomUnit(3);
    index.set(10, a); index.set(20, b); index.set(30, c);
    assert.equal(index.size, 3);
    index.set(20, c); // replace
    assert.equal(index.size, 3);
    assert.equal(index.top(c, 1, (n) => n === 20)[0]?.n, 20, "the replaced vector answers for its new value");
    index.remove(10);
    assert.deepEqual([index.size, index.has(10), index.has(30)], [2, false, true]);
    assert.equal(index.top(c, 3).length, 2);
    assert.equal(index.top(a, 1)[0]?.n === 10, false, "a removed vector is not returned");
    index.remove(999);
    assert.equal(index.size, 2);
    assert.throws(() => index.set(5, new Float32Array(10)), /384/);
  }
});

test("a vector survives the BLOB, and a change made through another handle reloads the in-memory copy", () => {
  const f = randomUnit(5);
  assert.deepEqual([...decodeVector(encodeVector(f))], [...f]);
  const h = harness();
  const h2 = harness({ raw: h.raw, space: h.space });
  seed(h, { id: "rec_a", title: "A", kind: "record" });
  const n = Number(h.rows("SELECT n FROM search_docs WHERE id = 'rec_a'")[0]!["n"]);
  assert.equal(vectorsOf(h.db, h.space).size, 0);
  writeVector(h2.db, h2.space, n, f);
  assert.equal(vectorsOf(h.db, h.space).size, 1, "the reader sees what the writer stored");
  forgetVectors(h.space);
  assert.equal(vectorsOf(h.db, h.space).size, 1, "and a restart loads it from the table");
  assert.equal(vectorsOf(h.db, h.space).top(f, 1)[0]?.n, n);
});

test("the stand-in embedder is 384 unit vectors that put similar texts close and unrelated texts far", async () => {
  const [a, b, c] = await embed(["harbor warehouse rent schedule", "monthly rent for the harbor warehouse", "soup salad and bread for lunch"]);
  assert.equal(a!.length, DIM);
  const dot = (x: Float32Array, y: Float32Array): number => { let s = 0; for (let i = 0; i < DIM; i++) s += x[i]! * y[i]!; return s; };
  assert.ok(Math.abs(dot(a!, a!) - 1) < 1e-4, "unit length");
  assert.ok(dot(a!, b!) > 0.3 && dot(a!, b!) > dot(a!, c!) + 0.2, `${dot(a!, b!)} against ${dot(a!, c!)}`);
  assert.deepEqual([...hashEmbed("same text")], [...hashEmbed("same text")], "deterministic");
  assert.equal(normalise(new Float32Array(DIM))[0], 0, "a zero vector stays zero");
  // the batch job stores them
  const h = harness();
  seed(h, { id: "rec_a", title: "Harbor rent", kind: "record" });
  assert.equal((await embedRun(h.ctx, {})).embedded, 1);
  assert.equal(h.rows("SELECT dim FROM search_vectors")[0]!["dim"], DIM);
});
