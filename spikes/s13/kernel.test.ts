// S13: the kernel is assembled from the readable WAT on this machine and tested as the bytes that run. The store keeps int8 vectors with a per-vector scale, scans them with the SIMD
// kernel, keeps 200 candidates and reranks them exactly: tested for recall@20 against the exact JS scan (200,000 vectors), identical top 20 on fixed queries, removal, replacement and
// growth. The 60 ms budget is measured on the v1-perf runners (bench.ts, spike-s13-vectors workflow, ruling 46); nothing asserted here is a speed claim.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DIM, VectorIndex, jsKernel, normalise } from "../../modules/search/projections.ts";
import { assembleKernel } from "./assemble.ts";
import { loadWasmKernel } from "./kernel.ts";

function unit(seed: number, into = new Float32Array(DIM)): Float32Array {
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < DIM; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; into[i] = (x / 0xffffffff) * 2 - 1; }
  return normalise(into);
}

/** The exact top k of a plain array by the reference kernel. */
function exactTop(all: Float32Array, n: number, q: Float32Array, k: number): number[] {
  const out = new Float32Array(n);
  jsKernel.score(all, 0, n, q, out);
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => out[b]! - out[a]!).slice(0, k);
}

test("the WAT assembles to a module that validates, and the source is the WAT file, not bytes in code", async () => {
  const bytes = await assembleKernel();
  assert.deepEqual([...bytes.slice(0, 4)], [0x00, 0x61, 0x73, 0x6d], "a wasm module");
  assert.ok(WebAssembly.validate(bytes), "the runtime accepts it (simd on)");
  const wat = fs.readFileSync(fileURLToPath(new URL("./kernel.wat", import.meta.url)), "utf8");
  assert.match(wat, /i32x4\.dot_i16x8_s/);
  assert.match(wat, /export "dot8"/);
});

test("the int8 store returns the exact top 20 on fixed queries over 6,000 vectors, and its scores are the exact float32 cosines", async () => {
  const k = (await loadWasmKernel())!;
  assert.ok(k, "the runtime has SIMD");
  const N = 6_000;
  const all = new Float32Array(N * DIM);
  const fast = new VectorIndex(64, k);
  assert.equal(fast.kernel, "wasm-int8");
  assert.ok(fast.kernelStored, "the index keeps its vectors in the kernel's store");
  for (let i = 0; i < N; i++) { const v = unit(i + 1); all.set(v, i * DIM); fast.set(i + 1, v); } // grows past its first capacity six times
  for (const seed of [7, 99, 31337, 987_654]) {
    const q = unit(seed);
    const want = exactTop(all, N, q, 20);
    const got = fast.top(q, 20);
    assert.deepEqual(got.map((x) => x.n), want.map((i) => i + 1), `query ${seed}: the same 20, in the same order`);
    const ref = new Float32Array(1);
    for (const g of got) { jsKernel.score(all, (g.n - 1) * DIM, 1, q, ref); assert.ok(Math.abs(g.score - ref[0]!) < 1e-5, `score of ${g.n} is the exact float32 cosine`); }
  }
  // a self query scores 1
  assert.ok(Math.abs(fast.top(unit(123), 1)[0]!.score - 1) < 1e-5);
  assert.equal(fast.top(unit(123), 1)[0]!.n, 123);
});

test("replace, remove and the accept filter on the store", async () => {
  const k = (await loadWasmKernel())!;
  const index = new VectorIndex(2, k);
  const a = unit(1), b = unit(2), c = unit(3);
  index.set(10, a); index.set(20, b); index.set(30, c);
  index.set(20, c); // replace
  assert.equal(index.size, 3);
  assert.equal(index.top(c, 1, (n) => n === 20)[0]?.n, 20, "the replaced vector answers for its new value");
  index.remove(10);
  assert.deepEqual([index.size, index.has(10), index.has(30)], [2, false, true]);
  assert.equal(index.top(a, 5).some((x) => x.n === 10), false, "a removed vector is not returned");
  assert.deepEqual(index.top(c, 5).map((x) => x.n).sort(), [20, 30]);
  index.remove(999);
  assert.equal(index.size, 2);
  assert.deepEqual(new VectorIndex(4, k).top(a, 5), [], "an empty index answers nothing");
  const zero = new VectorIndex(4, k);
  zero.set(1, new Float32Array(DIM));
  zero.set(2, unit(2));
  assert.equal(zero.top(unit(2), 1)[0]!.n, 2, "a zero vector does not break the scale");
});

test("recall@20 against the exact scan is at least 0.99 over 200,000 vectors", async () => {
  const k = (await loadWasmKernel())!;
  const N = 200_000;
  const all = new Float32Array(N * DIM);
  const v = new Float32Array(DIM);
  const fast = new VectorIndex(N, k);
  for (let i = 0; i < N; i++) { unit(i + 1, v); all.set(v, i * DIM); fast.set(i + 1, v); }
  let hit = 0, total = 0;
  const queries = [11, 222, 3_333, 44_444, 987_654];
  for (const seed of queries) {
    const q = unit(seed);
    const want = new Set(exactTop(all, N, q, 20).map((i) => i + 1));
    for (const g of fast.top(q, 20)) { total++; if (want.has(g.n)) hit++; }
  }
  const recall = hit / total;
  assert.ok(recall >= 0.99, `recall@20 ${recall.toFixed(3)} over ${queries.length} queries and ${N} vectors`);
});
