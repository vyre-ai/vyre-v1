import os from "node:os";
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
  const fixed = ["The warehouse rent is due on the first of the month.", "Monthly rent for the harbor warehouse.", "Soup, salad and bread for the team lunch.", "Send the signed lease before Friday.", "Quarterly board minutes, harbor lease discussion.", "Café déjà vu, naïve résumé", "", "x ".repeat(300)];
  const rate = async (embed: (t: readonly string[]) => Promise<Float32Array[]>): Promise<number[]> => {
    await embed(texts.slice(0, 32));
    const rates: number[] = [];
    for (let r = 0; r < 3; r++) { const s = performance.now(); await embed(texts); rates.push(texts.length / ((performance.now() - s) / 1000)); }
    return rates;
  };
  say(`cores ${os.availableParallelism()}`);
  // the web runtime on one thread: what a client does
  const web = await createEmbedder({ runtime: "web", threads: 1 });
  const webV = await web(fixed);
  const [a, b, c] = webV;
  say(`web: unit length ${dot(a!, a!).toFixed(4)}; related ${dot(a!, b!).toFixed(3)}; unrelated ${dot(a!, c!).toFixed(3)}`);
  if (!(Math.abs(dot(a!, a!) - 1) < 1e-3 && dot(a!, b!) > dot(a!, c!) + 0.15)) { say("FAIL the embeddings do not separate related from unrelated text"); failed = true; } else say("PASS related text is closer than unrelated text");
  say(`web, 1 thread, batch 16: chunks per second ${(await rate(web)).map((x) => x.toFixed(1)).join(", ")}`);
  // the host's runtime: native, cores - 1 threads, batches of 32 by length
  const t0 = performance.now();
  const host = await createEmbedder({ runtime: "node" });
  say(`onnxruntime-node loaded the model in ${(performance.now() - t0).toFixed(0)} ms`);
  const hostV = await host(fixed);
  // parity (ruling 58): every non-empty text at least 0.99 cosine; blank chunks are skipped by the guard (zero vectors on both sides)
  let worst = 1;
  fixed.forEach((t, i) => {
    const cos = dot(hostV[i]!, webV[i]!);
    if (t.trim() === "") { say(`  parity text ${i} (blank): skipped before the embedder, zero vectors ${hostV[i]!.every((x) => x === 0) && webV[i]!.every((x) => x === 0) ? "on both sides" : "MISMATCH"}`); if (!(hostV[i]!.every((x) => x === 0) && webV[i]!.every((x) => x === 0))) failed = true; return; }
    say(`  parity text ${i} (${JSON.stringify(t.slice(0, 40))}, ${t.length} chars): cosine ${cos.toFixed(6)}`);
    if (cos < worst) worst = cos;
  });
  say(`${worst >= 0.99 ? "PASS" : "FAIL"} every non-empty text has host vs web cosine at least 0.99: worst ${worst.toFixed(6)}`);
  if (!(worst >= 0.99)) failed = true;
  // retrieval overlap: the top 10 of a 60-sentence corpus for five fixed queries, host against web, at least 9 of 10 shared
  const topics = ["lease", "invoice", "meeting", "contract", "renewal", "payment", "report", "budget", "hiring", "audit", "shipping", "insurance"];
  const corpus = Array.from({ length: 60 }, (_, i) => `Note ${i}: the ${topics[i % topics.length]} for the ${["harbor", "northwind", "studio", "clinic", "workshop"][i % 5]} project needs a decision by ${["Monday", "Tuesday", "Friday", "the end of the month"][i % 4]}, owner ${["Ana", "Omar", "Lena", "Sam"][i % 3]}.`);
  const queries = ["when is the lease decision due", "who owns the invoice for the harbor project", "budget meeting for the clinic", "insurance renewal deadline", "hiring plan at the workshop"];
  const [wc, hc, wq, hq] = [await web(corpus), await host(corpus), await web(queries), await host(queries)];
  const top10 = (qv: Float32Array, cv: Float32Array[]): number[] => cv.map((v, i) => ({ i, s: dot(qv, v) })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.i);
  let minOverlap = 10;
  queries.forEach((q, i) => { const w = new Set(top10(wq[i]!, wc)); const o = top10(hq[i]!, hc).filter((x) => w.has(x)).length; say(`  retrieval overlap ${JSON.stringify(q)}: ${o} of 10`); if (o < minOverlap) minOverlap = o; });
  say(`${minOverlap >= 9 ? "PASS" : "FAIL"} top-10 retrieval overlap host vs web at least 9 of 10: worst ${minOverlap}`);
  if (minOverlap < 9) failed = true;
  // throughput by per-thread scaling (ruling 58): 1, 2 and 3 threads; rate x 7 at least 100 and at least 0.85 linear
  const cores = os.availableParallelism();
  const per: { t: number; r: number }[] = [];
  for (const t of [1, 2, Math.max(3, cores - 1)].filter((x, i, a) => a.indexOf(x) === i && x <= Math.max(3, cores - 1))) {
    const e = await createEmbedder({ runtime: "node", threads: t });
    const r = median(await rate(e));
    per.push({ t, r });
    say(`onnxruntime-node, ${t} thread${t > 1 ? "s" : ""}, batch 32: ${r.toFixed(1)} chunks per second`);
  }
  const one = per[0]!.r;
  const last = per[per.length - 1]!;
  const linear = last.r / (last.t * one);
  say(`per thread ${(one).toFixed(1)}; ${last.t} threads reach ${linear.toFixed(2)} of linear`);
  budget("per-thread rate x 7 threads (the 8-core host), chunks per second", one * 7, 100, false);
  budget("scaling at the highest thread count, fraction of linear (0.85)", linear * 100, 85, false);
}

if (which === "kernel" || which === "all") await kernels();
if (which === "embed" || which === "all") await embedder();
process.exit(failed ? 1 : 0);
