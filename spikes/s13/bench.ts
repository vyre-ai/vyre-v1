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
  const rss0 = process.memoryUsage();
  for (let i = 0; i < N; i++) { unit(i + 1, v); index.set(i + 1, v); plain.set(i + 1, v); }
  const mb = (n: number): string => (n / 1048576).toFixed(0);
  const rss1 = process.memoryUsage();
  say(`memory after loading both indexes: rss ${mb(rss1.rss - rss0.rss)} MB, arrayBuffers ${mb(rss1.arrayBuffers - rss0.arrayBuffers)} MB (the plain float32 index is ${mb(N * DIM * 4)} MB of that; the int8 store holds ${mb(N * DIM)} MB int8 + ${mb(N * 4)} MB scales + ${mb(N * DIM * 4)} MB float32 for the rerank = ${mb(N * DIM * 5 + N * 4)} MB)`);
  const queries = [987_654, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((s) => unit(s, new Float32Array(DIM)));
  const time = (ix: VectorIndex): number[] => { ix.top(queries[0]!, 20); const t: number[] = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); ix.top(queries[0]!, 20); t.push(performance.now() - t0); } return t; };
  const w = time(index), j = time(plain);
  say(`wasm-int8 VectorIndex.top runs ${w.map((x) => x.toFixed(1)).join(", ")} ms; js runs ${j.map((x) => x.toFixed(1)).join(", ")} ms`);
  say(`worst wasm run ${Math.max(...w).toFixed(1)} ms; js median ${median(j).toFixed(1)} ms`);
  let hit = 0, total = 0, identical = 0;
  for (const q of queries) {
    const a = index.top(q, 20).map((x) => x.n), b = plain.top(q, 20).map((x) => x.n);
    const set = new Set(b);
    for (const n of a) { total++; if (set.has(n)) hit++; }
    if (a.join() === b.join()) identical++;
  }
  const recall = hit / total;
  say(`recall@20 over ${queries.length} queries: ${recall.toFixed(4)}; identical top 20 in order: ${identical} of ${queries.length}`);
  if (recall < 0.99) { say("FAIL recall@20 under 0.99"); failed = true; } else say("PASS recall@20 at least 0.99");
  if (a0same(index, plain, queries[0]!)) say("PASS the fixed query (987654) returns the identical top 20"); else { say("FAIL the fixed query returns a different top 20"); failed = true; }
  budget("cosine over 200k vectors through VectorIndex.top (the production path), median of 5", median(w), 60, true);
}
const a0same = (a: VectorIndex, b: VectorIndex, q: Float32Array): boolean => a.top(q, 20).map((x) => x.n).join() === b.top(q, 20).map((x) => x.n).join();

async function embedder(): Promise<void> {
  const dot = (a: Float32Array, b: Float32Array): number => { let s = 0; for (let i = 0; i < DIM; i++) s += a[i]! * b[i]!; return s; };
  const chunk = "Please send the signed lease for the harbor warehouse before Friday so that the renewal can be filed with the property company. ".repeat(3).slice(0, 380);
  const texts = Array.from({ length: 200 }, (_, i) => `${chunk} ${i}`);
  let best = 0;
  // the same model under the settings that can matter: threads (the perf runner has two cores to itself) and batch size
  for (const [threads, batch] of [[1, 16], [2, 16], [2, 32], [1, 8]] as const) {
    const t0 = performance.now();
    const embed = await createEmbedder({ threads, batch });
    const loaded = performance.now() - t0;
    const [a, b, c] = await embed(["The warehouse rent is due on the first of the month.", "Monthly rent for the harbor warehouse.", "Soup, salad and bread for the team lunch."]);
    if (threads === 1 && batch === 16) {
      say(`model loaded in ${loaded.toFixed(0)} ms; unit length ${dot(a!, a!).toFixed(4)}; related ${dot(a!, b!).toFixed(3)}; unrelated ${dot(a!, c!).toFixed(3)}`);
      if (!(Math.abs(dot(a!, a!) - 1) < 1e-3 && dot(a!, b!) > dot(a!, c!) + 0.15)) { say("FAIL the embeddings do not separate related from unrelated text"); failed = true; } else say("PASS related text is closer than unrelated text");
    }
    await embed(texts.slice(0, 16));
    const rates: number[] = [];
    for (let r = 0; r < 3; r++) { const s = performance.now(); await embed(texts); rates.push(texts.length / ((performance.now() - s) / 1000)); }
    say(`threads ${threads}, batch ${batch}: chunks per second ${rates.map((x) => x.toFixed(1)).join(", ")}`);
    best = Math.max(best, median(rates));
  }
  budget("embedder chunks per second, best setting, median of 3 (200 chunks of about 380 characters)", best, 100, false);
}

if (which === "kernel" || which === "all") await kernels();
if (which === "embed" || which === "all") await embedder();
process.exit(failed ? 1 : 0);
