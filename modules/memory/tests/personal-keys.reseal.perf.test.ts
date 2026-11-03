// The speed half of personal-keys.test.ts (ruling 46: only speed tests here), its second file: how fast the background job re-seals 10,000 of one person's facts from the old server seal to her
// own key. Split from personal-keys.perf.test.ts so each file stays under the 30 s cap on a loaded runner. Numbers are printed for the report.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { setMemoryKeyPort, sweepHeld } from "../personal.ts";
import { settlePersonal } from "../settle.ts";
import { asPerson, harness, seedFact } from "../fixtures/harness.ts";

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

test("the job re-seals 10,000 rows from the old server seal", (t) => {
  t.after(() => { held.delete("usr_dana"); sweepHeld(); });
  const h = harness();
  for (let i = 0; i < 10_000; i++) seedFact(h, { id: `fct_o${i}`, layer: "person", agentId: "agt_intake", text: textOf(i) });
  assert.match(String(h.rows("SELECT sealed FROM memory_facts WHERE id = 'fct_o1'")[0]?.["sealed"]), /^\{/);
  held.set("usr_dana", KEY);
  const svc = asPerson(h, { kind: "service", id: "svc_host" });
  const t0 = performance.now();
  let passes = 0;
  let moved = 0;
  for (;;) { passes++; const r = settlePersonal(asPerson(h, { kind: "service", id: "svc_host" }).ctx); moved += r.resealed; if (r.left === 0) break; }
  const ms = performance.now() - t0;
  console.log(`PERF personal-keys reseal ${JSON.stringify({ rows: moved, passes, ms: Math.round(ms), perRowUs: Math.round((ms * 1000) / moved) })}`);
  assert.equal(moved, 10_000);
  assert.equal(svc.rows("SELECT COUNT(*) AS n FROM memory_facts WHERE sealed NOT LIKE 'pm1.o.%'")[0]?.["n"], 0);
  held.delete("usr_dana"); sweepHeld();
});
