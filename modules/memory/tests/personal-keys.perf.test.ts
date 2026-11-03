// The speed half of personal-keys.test.ts (ruling 46: only speed tests here). 50,000 of one person's facts under her own key: how long the in-memory index takes to build when her key is first
// held (the background job's warm pass), how fast her pointer and search are once it is built, (the re-seal pass is in personal-keys.reseal.perf.test.ts). Numbers are printed for the report.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pointer, search } from "../handlers/facts.ts";
import { setMemoryKeyPort, sweepHeld } from "../personal.ts";
import { settlePersonal } from "../settle.ts";
import { asPerson, harness, seedFact } from "../fixtures/harness.ts";

const N = 50_000;
const KEY = crypto.randomBytes(32);
const held = new Map<string, Uint8Array>();
setMemoryKeyPort({ personKey: (p) => (held.has(p) ? Uint8Array.from(held.get(p)!) : null) });
test.after(() => setMemoryKeyPort(null));

// A memory with a real spread of words: 6,000 made-up words, 8 to 14 per fact, picked by a fixed generator, so most words are rare and a few are common (as in real notes).
const SYL = ["ka", "ro", "mi", "tu", "sel", "dan", "vo", "ri", "pa", "lun", "es", "or", "fi", "zan", "qui", "bel"];
const VOCAB = Array.from({ length: 6000 }, (_, i) => SYL[i % 16]! + SYL[Math.floor(i / 16) % 16]! + SYL[Math.floor(i / 256) % 16]! + (i >= 4096 ? "x" : ""));
let seed = 7;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (): string => VOCAB[Math.floor(VOCAB.length * rnd() ** 2.2)]!;   // skewed: low indexes are common
const textOf = (i: number): string => `${Array.from({ length: 8 + (i % 7) }, pick).join(" ")} client ${i % 2000}`;
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { best: +s[0]!.toFixed(1), p50: +s[Math.floor(s.length / 2)]!.toFixed(1), p95: +s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!.toFixed(1) }; };

test(`50,000 personal facts under her own key: index build, pointer and search`, async (t) => {
  t.after(() => { held.delete("usr_dana"); sweepHeld(); });
  held.set("usr_dana", KEY);
  const h = harness();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) seedFact(h, { id: `fct_p${i}`, layer: "person", agentId: "agt_intake", text: textOf(i) });
  seedFact(h, { id: "fct_target", layer: "person", agentId: "agt_intake", text: "Dana's quasar retainer renews in November with Fiona" });
  const seedMs = performance.now() - t0;
  assert.match(String(h.rows("SELECT sealed FROM memory_facts WHERE id = 'fct_p7'")[0]?.["sealed"]), /^pm1\.o\./);

  // she signs in on another node: nothing is in memory yet; the job's warm pass builds her index
  sweepHeld();
  held.delete("usr_dana"); sweepHeld(); held.set("usr_dana", KEY);
  const w0 = performance.now();
  const warm = settlePersonal(asPerson(h, { kind: "service", id: "svc_host" }).ctx);
  const warmMs = performance.now() - w0;
  assert.equal(warm.warmed, N + 1);

  const ptr: number[] = [];
  const srch: number[] = [];
  const common: number[] = [];
  for (let i = 0; i < 9; i++) {
    const v = asPerson(h, { kind: "person", id: "usr_dana" });
    let t = performance.now();
    const p = await pointer(v.ctx, { threadId: `thr_${i}`, agentId: "agt_intake", text: "when does the quasar retainer renew?" });
    ptr.push(performance.now() - t);
    assert.equal(p.lines[0]?.fact, "Dana's quasar retainer renews in November with Fiona");
    t = performance.now();
    const s = await search(v.ctx, { q: "quasar retainer Fiona", mode: "keyword" });
    srch.push(performance.now() - t);
    assert.equal(s.hits[0]?.factId, "fct_target");
    // the worst case: a word every fact holds ("client"), so every fact is scored
    t = performance.now();
    await pointer(v.ctx, { threadId: `thr_w${i}`, agentId: "agt_intake", text: "what does client 77 want?" });
    common.push(performance.now() - t);
  }
  // the same lookup with no index (key held, index dropped): every fact is opened on the way
  held.delete("usr_dana"); sweepHeld(); held.set("usr_dana", KEY);
  const c0 = performance.now();
  await pointer(asPerson(h, { kind: "person", id: "usr_dana" }).ctx, { threadId: "thr_cold", agentId: "agt_intake", text: "when does the quasar retainer renew?" });
  const coldMs = performance.now() - c0;

  const out = { facts: N + 1, seedMs: Math.round(seedMs), warmMs: Math.round(warmMs), coldPointerMs: Math.round(coldMs), pointer: stats(ptr), search: stats(srch), pointerEveryFactMatches: stats(common) };
  console.log(`PERF personal-keys ${JSON.stringify(out)}`);
  // budgets (a shared runner can be slowed by its neighbours, so the best of nine holds the budget)
  assert.ok(out.pointer.best < 150, `pointer best ${out.pointer.best} ms`);
  assert.ok(out.search.best < 400, `search best ${out.search.best} ms`);
  assert.ok(warmMs < 8000, `index build ${warmMs} ms`);
  held.delete("usr_dana"); sweepHeld();
});
