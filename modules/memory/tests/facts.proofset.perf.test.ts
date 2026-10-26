// The speed half of facts.proofset.test.ts (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// The 50-question proof set of memory (spec 2.15, ARCH 6.10): does the local lookup find the right fact or note, does it give today's value and not a closed one, does it stay
// quiet when memory has nothing, and does it keep another person's layer to itself. Thresholds of the pointer block (POINTER_MIN_COVERAGE and POINTER_MIN_MASS) were tuned on this set.
// The metrics are compared with fixtures/proofset-baseline.json: none may fall more than 0.02 below its floor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factsList, pointer, search } from "../handlers/facts.ts";
import { asPerson, harness } from "../fixtures/harness.ts";
import { FACTS, NOTES, OMAR, TRAPS, DANA, seedWorld } from "../fixtures/world.ts";
import { QUESTIONS } from "../fixtures/questions.ts";

const baseline = (JSON.parse(readFileSync(new URL("../fixtures/proofset-baseline.json", import.meta.url), "utf8")) as { metrics: Record<string, number> }).metrics;

const textOf = new Map<string, string>([...FACTS, ...TRAPS].map((f) => [f.id, f.text] as const));
const titleOf = new Map<string, string>(NOTES.map((n) => [`not_${n.fileId.replace(/^fil_/, "")}`, n.title] as const));
const trapIds = new Set(TRAPS.map((t) => t.id));
const trapTexts = new Set(TRAPS.map((t) => t.text));

interface Line { title: string; fact?: string; path: string }

/** Which fact or note a pointer line shows. */
function keyOfLine(line: Line): string {
  if (line.fact !== undefined) {
    for (const [id, text] of textOf) if (text === line.fact || (line.fact.endsWith("...") && text.startsWith(line.fact.slice(0, -3)))) return `fact:${id}`;
    return `fact:?`;
  }
  for (const [id, title] of titleOf) if (title === line.title) return `note:${id}`;
  return "note:?";
}

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(0.95 * xs.length))] ?? 0;

async function run() {
  const h = harness();
  seedWorld(h);
  const searchHit: boolean[] = [];
  const pointerTop: boolean[] = [];
  const empty: boolean[] = [];
  const stale: boolean[] = [];
  const ms: number[] = [];
  let closedOffered = 0;
  let leaks = 0;
  const detail: string[] = [];
  let n = 0;
  for (const q of QUESTIONS) {
    n++;
    const thread = `thr_q${n}`;
    const t0 = performance.now();
    const ptr = await pointer(h.ctx, { threadId: thread, agentId: q.agentId, text: q.q });
    ms.push(performance.now() - t0);
    const lines = ptr.lines as Line[];
    const keys = lines.map(keyOfLine);
    const res = await search(h.ctx, { q: q.q, limit: 10 });
    const hitKeys = res.hits.map((x) => (x.kind === "fact" ? `fact:${x.factId}` : `note:${x.noteId}`));
    for (const line of lines) {
      if (line.fact !== undefined && [...trapTexts].some((t) => t === line.fact)) closedOffered++;
      if (line.fact !== undefined && /omar (is interviewing|salary)/i.test(line.fact)) leaks++;
    }
    for (const k of hitKeys) {
      if (k.startsWith("fact:") && trapIds.has(k.slice(5))) closedOffered++;
      if (k === "fact:fct_o01" || k === "fact:fct_o02") leaks++;
    }
    if (q.kind === "irrelevant") {
      empty.push(lines.length === 0);
      if (lines.length !== 0) detail.push(`irrelevant answered: ${q.q} -> ${keys.join(", ")}`);
      continue;
    }
    const top3 = hitKeys.slice(0, 3).some((k) => q.expect.includes(k));
    searchHit.push(top3);
    if (!top3) detail.push(`search miss: ${q.q} -> ${hitKeys.slice(0, 3).join(", ")} (want ${q.expect.join(" | ")})`);
    const top = keys[0] !== undefined && q.expect.includes(keys[0]);
    pointerTop.push(top);
    if (!top) detail.push(`pointer miss: ${q.q} -> ${keys.join(", ") || "nothing"} (want ${q.expect.join(" | ")})`);
    if (q.kind === "stale") {
      const forbidden = q.forbid ?? [];
      stale.push(top3 && !hitKeys.some((k) => forbidden.includes(k)) && !keys.some((k) => forbidden.includes(k)));
    }
  }
  const rate = (xs: boolean[]): number => (xs.length === 0 ? 0 : Math.round((xs.filter(Boolean).length / xs.length) * 1000) / 1000);
  const metrics: Record<string, number> = {
    "search.hit_at_3": rate(searchHit),
    "pointer.top1": rate(pointerTop),
    "pointer.empty_rate": rate(empty),
    "stale.ok": rate(stale),
    leakage: leaks,
    "closed.offered": closedOffered,
  };
  return { metrics, detail, p95ms: p95(ms), h };
}

const report = run();
report.catch(() => {});

test("proof set: a pointer block answers within the 50 ms budget on the world", async () => {
  const r = await report;
  assert.ok(r.p95ms < 50, `pointer p95 was ${r.p95ms} ms`);
});
