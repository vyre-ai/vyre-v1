// S13 on the v1-perf runner (ruling 46): the 60 ms budget for brute-force cosine over 200,000 vectors of 384 dimensions, and the 100 chunks per second budget for the real model.
// Prints every number and exits non-zero when a budget is missed. Median of 5 after one warm-up; the worst is printed too. Usage: node spikes/s13/bench.ts [kernel|embed|all]
import { DIM, VectorIndex, jsKernel, normalise } from "../../modules/search/projections.ts";
import { createEmbedder } from "./embedder.ts";
import { loadWasmKernel } from "./kernel.ts";

const which = process.argv[2] ?? "all";
let failed = false;
const say = (s: string): void => console.log(s);
const budget = (name: string, got: number, limit: number, lowerIsBetter: boolean): void => {
  const ok = lowerIsBetter ? got < limit : got > limit;
  say(`${ok ? "PASS" : "FAIL"} ${name}: ${got.toFixed(1)} against ${lowerIsBetter ? "under" : "over"} ${limit}`);
  if (!ok) failed = true;
};
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function unit(seed: number, into: Float32Array): Float32Array {
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < DIM; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; into[i] = (x / 0xffffffff) * 2 - 1; }
  return normalise(into);
}

async function kernels(): Promise<void> {
  const N = 200_000;
  const wasm = await loadWasmKernel();
  if (!wasm) throw new Error("this runtime has no WebAssembly SIMD");
  const index = new VectorIndex(N, wasm);
  const plain = new VectorIndex(N, jsKernel);
  const v = new Float32Array(DIM);
  say(`node ${process.version}, ${N} vectors x ${DIM}`);
  for (let i = 0; i < N; i++) { unit(i + 1, v); index.set(i + 1, v); plain.set(i + 1, v); }
  const q = unit(987_654, new Float32Array(DIM));
  const time = (ix: VectorIndex): number[] => { ix.top(q, 20); const t: number[] = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); ix.top(q, 20); t.push(performance.now() - t0); } return t; };
  const w = time(index), j = time(plain);
  say(`wasm-simd runs ${w.map((x) => x.toFixed(1)).join(", ")} ms; js runs ${j.map((x) => x.toFixed(1)).join(", ")} ms`);
  const same = index.top(q, 20).map((x) => x.n).join() === plain.top(q, 20).map((x) => x.n).join();
  say(`${same ? "PASS" : "FAIL"} the two kernels return the same 20 neighbours`);
  if (!same) failed = true;
  say(`worst wasm run ${Math.max(...w).toFixed(1)} ms; js median ${median(j).toFixed(1)} ms`);
  // VectorIndex stores its vectors in the kernel's memory (VectorKernel.alloc), so the VectorIndex.top time above is the production path
  const own = wasm.alloc(N * DIM);
  for (let i = 0; i < N; i++) own.set(unit(i + 1, v), i * DIM);
  const out = new Float32Array(N);
  wasm.score(own, 0, N, q, out);
  const z: number[] = [];
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); wasm.score(own, 0, N, q, out); z.push(performance.now() - t0); }
  say(`wasm-simd, vectors in the kernel's own memory (zero copy), scoring only: ${z.map((x) => x.toFixed(1)).join(", ")} ms`);
  budget("cosine over 200k vectors, median of 5, vectors in the kernel's memory", median(z), 60, true);
  budget("cosine over 200k vectors through VectorIndex.top (the production path), median of 5", median(w), 60, true);
}

async function embedder(): Promise<void> {
  const t0 = performance.now();
  const embed = await createEmbedder();
  say(`model loaded in ${(performance.now() - t0).toFixed(0)} ms`);
  const dot = (a: Float32Array, b: Float32Array): number => { let s = 0; for (let i = 0; i < DIM; i++) s += a[i]! * b[i]!; return s; };
  const [a, b, c] = await embed(["The warehouse rent is due on the first of the month.", "Monthly rent for the harbor warehouse.", "Soup, salad and bread for the team lunch."]);
  say(`unit length ${dot(a!, a!).toFixed(4)}; related ${dot(a!, b!).toFixed(3)}; unrelated ${dot(a!, c!).toFixed(3)}`);
  if (!(Math.abs(dot(a!, a!) - 1) < 1e-3 && dot(a!, b!) > dot(a!, c!) + 0.15)) { say("FAIL the embeddings do not separate related from unrelated text"); failed = true; } else say("PASS related text is closer than unrelated text");
  const chunk = "Please send the signed lease for the harbor warehouse before Friday so that the renewal can be filed with the property company. ".repeat(3).slice(0, 380);
  const texts = Array.from({ length: 200 }, (_, i) => `${chunk} ${i}`);
  await embed(texts.slice(0, 16));
  const rates: number[] = [];
  for (let r = 0; r < 3; r++) { const s = performance.now(); await embed(texts); rates.push(texts.length / ((performance.now() - s) / 1000)); }
  say(`chunks per second: ${rates.map((x) => x.toFixed(1)).join(", ")}`);
  budget("embedder chunks per second, median of 3 (200 chunks of about 380 characters)", median(rates), 100, false);
}

if (which === "kernel" || which === "all") await kernels();
if (which === "embed" || which === "all") await embedder();
process.exit(failed ? 1 : 0);
