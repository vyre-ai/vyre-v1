// perf search.server (ARCH 9): with 100,000 records and 10,000 messages in the index, the server's answer, merged with the device's own, stays under 300 ms at p95. The
// timings include the full path a request takes in the handler: the full text query, the vector scan, the fusion, the authorize check of every candidate and the merge.
import test from "node:test";
import assert from "node:assert/strict";
import { query, mergeHits } from "../handlers/query.ts";
import { VectorIndex, writeVector, DIM } from "../projections.ts";
import { bulk, harness, randomUnit } from "../fixtures/harness.ts";

// The shard kills a file at 20 s without a word: fail inside the loops, naming the phase, well before that.
const FILE_START = performance.now();
const LIMIT_MS = 16_000;
const marks: string[] = [];
function tick(phase: string): void {
  const t = performance.now() - FILE_START;
  if (/^(seeded|vectors)/.test(phase)) marks.push(`${phase} @${t.toFixed(0)}`);
  if (t > LIMIT_MS) throw new assert.AssertionError({ message: `${phase}: ${t.toFixed(0)} ms into the file, over ${LIMIT_MS} ms of the 20 s file cap; ${marks.join("; ")}` });
}

test("perf search.server: p95 under 300 ms merged with local, 100k records and 10k messages", async () => {
  const sy = ["ba", "ke", "lo", "mi", "ra", "su", "te", "vo", "na", "pi", "do", "ga", "fe", "zu", "ho"];
  const word = (n: number): string => `${sy[n % 15]}${sy[Math.floor(n / 15) % 15]}${sy[Math.floor(n / 225) % 15]}`;
  const pick = (i: number, k: number): string => word((Math.imul(i * 31 + k, 2654435761) >>> 0) % 3375);
  const w = (i: number, k: number): string => `${pick(i, k)} ${pick(i, k + 17)}`;
  const h = harness();
  bulk(h, 100_000, (i) => ({ title: w(i, 1), body: `${w(i, 2)} ${w(i, 3)}`, kind: "record", entity: "rec", recordType: i % 3 === 0 ? "client" : "invoice" }));
  tick("seeded 100k records");
  bulk(h, 10_000, (i) => ({ title: "", body: `${w(i, 3)} ${w(i, 4)} please`, kind: "chat", entity: "msg" }));
  bulk(h, 2, (i) => (i === 0 ? { title: "Zelda Quillfeather", body: "Partner", kind: "person", entity: "usr" } : { title: "Quillfeather deed.pdf", body: "", kind: "file", entity: "fil" }));
  tick("seeded 10k messages");
  // vectors for a slice of them, so the semantic and hybrid paths scan something real
  const v = new Float32Array(DIM);
  const n0 = Number(h.rows("SELECT MIN(n) AS m FROM search_docs")[0]!["m"]);
  for (let i = 0; i < 5_000; i++) writeVector(h.db, h.space, n0 + i, randomUnit(i + 1, v));
  tick("vectors written");
  assert.ok(new VectorIndex(8).kernel.length > 0);

  const queries = ["b", "ba", "k", "ke", "a", "b k", "ba ke", "bake", "balo mi", "pidog", "gafe zu", "zelda", "quill", "vona", "kera", "mirasu", "tevo na"];
  const local = Array.from({ length: 20 }, (_, i) => ({ kind: "record", id: `rec_${i * 7}`, title: `Local ${i}` }));
  const samples: number[] = [];
  let hits = 0;
  for (const mode of ["keyword", "hybrid"] as const) {
    for (let round = 0; round < 3; round++) {
      for (const q of queries) {
        tick(`${mode} ${q}`);
        const t0 = performance.now();
        const r = await query(h.ctx, { q, mode });
        const merged = mergeHits(local, r.hits);
        samples.push(performance.now() - t0);
        hits += merged.length;
      }
    }
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  assert.ok(hits > 0);
  assert.deepEqual((await query(h.ctx, { q: "zelda" })).hits.map((x) => x.id), ["usr_0"]);
  assert.deepEqual((await query(h.ctx, { q: "quill", types: ["file"] })).hits.map((x) => x.id), ["fil_1"], "the type filter finds the one file among 110,000 rows");
  assert.ok(p95 < 300, `search.server p95 ${p95.toFixed(1)} ms is over 300 ms; slowest ${samples[samples.length - 1]!.toFixed(0)} ms`);
});
