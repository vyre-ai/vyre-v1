// Vectors (spec b11, ARCH R14): brute-force cosine over 384-dimension vectors behind one kernel interface, replace and remove, and the table round trip that lets another process keep the in-memory copy honest.
import test from "node:test";
import assert from "node:assert/strict";
import { embedRun } from "../handlers/index.ts";
import { CHUNK, DIM, VectorIndex, decodeVector, embed, encodeVector, forgetVectors, hashEmbed, jsKernel, normalise, setVectorKernel, vectorsOf, writeVector } from "../projections.ts";
import type { VectorKernel } from "../projections.ts";
import { harness, randomUnit, seed } from "../fixtures/harness.ts";

// The 60 ms budget over 200,000 vectors belongs to P-L1_15 (spike S13), which brings the fast kernel and proves it on the perf runners. Here: the plain kernel is exact and the kernel is a seam.
test("the plain kernel finds the exact nearest neighbours over 20,000 vectors, best first, and a self query scores 1", () => {
  const N = 20_000;
  const index = new VectorIndex(512);
  const v = new Float32Array(DIM);
  for (let i = 0; i < N; i++) index.set(i + 1, randomUnit(i + 1, v)); // grows past its first capacity five times
  assert.equal(index.size, N);
  assert.equal(index.kernel, "js");
  const q = randomUnit(777_777);
  const top = index.top(q, 10);
  // the answer a straightforward loop gives
  const all: Array<{ n: number; score: number }> = [];
  for (let i = 0; i < N; i++) { const x = randomUnit(i + 1, v); let s = 0; for (let j = 0; j < DIM; j++) s += x[j]! * q[j]!; all.push({ n: i + 1, score: s }); }
  all.sort((a, b) => b.score - a.score);
  assert.deepEqual(top.map((t) => t.n), all.slice(0, 10).map((t) => t.n));
  for (let i = 0; i < 10; i++) assert.ok(Math.abs(top[i]!.score - all[i]!.score) < 1e-4);
  const self = index.top(randomUnit(123), 1)[0]!;
  assert.equal(self.n, 123);
  assert.ok(Math.abs(self.score - 1) < 1e-4);
});

test("a faster kernel can be given to the index and to the module, and gives the same answer", () => {
  const calls: number[] = [];
  const mirror: VectorKernel = { name: "mirror", score(d, from, count, q, out) { calls.push(count); jsKernel.score(d, from, count, q, out); } };
  const plain = new VectorIndex(64);
  const fast = new VectorIndex(64, mirror);
  const v = new Float32Array(DIM);
  const N = CHUNK + 1_904;   // one full chunk and a remainder, whatever the chunk size is
  for (let i = 0; i < N; i++) { randomUnit(i + 1, v); plain.set(i + 1, v); fast.set(i + 1, v); }
  const q = randomUnit(99);
  assert.equal(fast.kernel, "mirror");
  assert.deepEqual(fast.top(q, 5), plain.top(q, 5));
  assert.deepEqual(calls, [CHUNK, 1904], "scanned in chunks");
  setVectorKernel(mirror);
  try { assert.equal(new VectorIndex(8).kernel, "mirror"); } finally { setVectorKernel(null); }
  assert.equal(new VectorIndex(8).kernel, "js");
});

test("set replaces, remove swaps the last vector into the gap, and an accept filter narrows the scan", () => {
  for (let round = 0; round < 2; round++) {
    const index = new VectorIndex(4);
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
