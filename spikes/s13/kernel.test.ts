// S13: the kernel is assembled from the readable WAT on this machine and tested as the bytes that run: same scores as jsKernel on random data, the zero-copy and staged paths agree,
// and a VectorIndex given the kernel finds the same neighbours. The 60 ms over 200,000 vectors is measured on the v1-perf runners (bench.ts, spike-s13-vectors workflow, ruling 46);
// the time asserted here is only a loose guard against a kernel that is accidentally the slow path.
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

test("the WAT assembles to a module that validates, and the source is the WAT file, not bytes in code", async () => {
  const bytes = await assembleKernel();
  assert.deepEqual([...bytes.slice(0, 4)], [0x00, 0x61, 0x73, 0x6d], "a wasm module");
  assert.ok(WebAssembly.validate(bytes), "the runtime accepts it (simd on)");
  const wat = fs.readFileSync(fileURLToPath(new URL("./kernel.wat", import.meta.url)), "utf8");
  assert.match(wat, /f32x4\.mul/);
  assert.match(wat, /export "scan"/);
});

test("the assembled kernel scores exactly as jsKernel does, on its own memory and on an ordinary array", async () => {
  const k = (await loadWasmKernel())!;
  assert.ok(k, "the runtime has SIMD");
  const N = 5_000;
  const own = k.alloc(N * DIM);
  const plain = new Float32Array(N * DIM);
  for (let i = 0; i < N; i++) { const v = unit(i + 1); own.set(v, i * DIM); plain.set(v, i * DIM); }
  const q = unit(424242);
  const want = new Float32Array(N);
  jsKernel.score(plain, 0, N, q, want);
  const a = new Float32Array(N), b = new Float32Array(N);
  k.score(own, 0, N, q, a);
  k.score(plain, 0, N, q, b);
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(a[i]! - want[i]!) < 1e-4, `own memory, vector ${i}: ${a[i]} against ${want[i]}`);
    assert.ok(Math.abs(b[i]! - want[i]!) < 1e-4, `staged, vector ${i}: ${b[i]} against ${want[i]}`);
  }
  // a window inside the array, not from the start
  const w = new Float32Array(100);
  k.score(own, 700 * DIM, 100, q, w);
  for (let i = 0; i < 100; i++) assert.ok(Math.abs(w[i]! - want[700 + i]!) < 1e-4);
  const s = new Float32Array(10);
  k.score(plain, 2_000 * DIM, 10, q, s);
  for (let i = 0; i < 10; i++) assert.ok(Math.abs(s[i]! - want[2_000 + i]!) < 1e-4);
  // a self query scores 1, an orthogonal pair 0
  const self = new Float32Array(1);
  k.score(own, 0, 1, unit(1), self);
  assert.ok(Math.abs(self[0]! - 1) < 1e-4);
  const e0 = new Float32Array(DIM); e0[0] = 1;
  const e1 = new Float32Array(DIM); e1[1] = 1;
  const zero = new Float32Array(1);
  const one = k.alloc(DIM); one.set(e0);
  k.score(one, 0, 1, e1, zero);
  assert.equal(zero[0], 0);
});

test("a VectorIndex given the kernel returns the same neighbours as the plain one", async () => {
  const k = (await loadWasmKernel())!;
  const fast = new VectorIndex(64, k);
  const slow = new VectorIndex(64);
  assert.equal(fast.kernel, "wasm-simd");
  for (let i = 0; i < 6_000; i++) { const v = unit(i + 1); fast.set(i + 1, v); slow.set(i + 1, v); }
  for (const s of [7, 99, 31337]) {
    const q = unit(s);
    assert.deepEqual(fast.top(q, 10).map((x) => x.n), slow.top(q, 10).map((x) => x.n));
  }
});

test("the kernel is not the slow path: 20,000 vectors score in well under a second", async () => {
  const k = (await loadWasmKernel())!;
  const N = 20_000;
  const own = k.alloc(N * DIM);
  const v = new Float32Array(DIM);
  for (let i = 0; i < N; i++) own.set(unit(i + 1, v), i * DIM);
  const out = new Float32Array(N);
  const q = unit(5);
  k.score(own, 0, N, q, out);
  const t0 = performance.now();
  for (let r = 0; r < 5; r++) k.score(own, 0, N, q, out);
  const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 250, `20,000 vectors took ${ms.toFixed(1)} ms`);
});
