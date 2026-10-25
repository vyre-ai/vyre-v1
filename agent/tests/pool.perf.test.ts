// Speed budgets that touch the pool (spec Speed and smoothness, perf/budgets.json):
//   engine_pool  engine.acquire warm p95 under 20 ms on a mid laptop ("a resumed chat never cold-starts its engine")
//   send         first token = the provider's own latency plus under 150 ms of ours, with the pool between the engine and the driver
//   chat_open    a new chat is ready (its engine warm) before the first message, because opening the thread sends the hint
import test from "node:test";
import assert from "node:assert/strict";
import { createPool, poolOpenSession } from "../src/pool/index.ts";
import type { PoolDriver, PoolSpec } from "../src/pool/index.ts";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { SessionSpec } from "../src/turn-engine/index.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
};

const COLD_MS = 40;
function slowDriver(): PoolDriver & { opens: number } {
  const provider = scriptedProvider({ script: [{ type: "text", text: "hi" }, { type: "done" }] });
  const d: PoolDriver & { opens: number } = { id: "anthropic", kind: "api", opens: 0, async open(spec: SessionSpec) { d.opens++; await sleep(COLD_MS); return provider.openSession(spec); } };
  return d;
}
const spec = (thread: string, model = "claude-sonnet-5-5"): PoolSpec => ({
  key: { driver: "anthropic", accountRef: "#Team_Anthropic_Key", model, sandboxId: null, mcpProfile: "default" },
  threadId: thread, person: "usr_dana", session: { threadId: thread, agent: { id: "agt_intake", mode: "lead", model }, asker: "usr_dana" },
});

test("perf engine_pool: engine.acquire on a warm pool is under 20 ms at p95, and a cold open is what the warm one avoids", async () => {
  const d = slowDriver();
  const pool = createPool({ placement: "device", drivers: [d] });
  const t0 = performance.now();
  const cold = await pool.acquire(spec("thr_a"));
  const coldMs = performance.now() - t0;
  await pool.release(cold);

  const ms: number[] = [];
  for (let i = 0; i < 400; i++) {
    const s = performance.now();
    const l = await pool.acquire(spec("thr_a"));
    ms.push(performance.now() - s);
    assert.equal(l.warm, true);
    await pool.release(l);
  }
  const [p50, p95, max] = [percentile(ms, 50), percentile(ms, 95), Math.max(...ms)];
  console.log(`perf engine_pool: cold=${coldMs.toFixed(1)}ms warm n=${ms.length} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms budget_p95=20ms`);
  assert.ok(coldMs >= COLD_MS - 5, "the cold start really took its time");
  assert.ok(p95 < 20, `warm acquire p95 ${p95.toFixed(3)} ms is over the 20 ms budget`);
  assert.equal(d.opens, 1, "400 turns, one open");
});

test("perf engine_pool: acquire stays fast with the pool full of sessions", async () => {
  const pool = createPool({ placement: "device", drivers: [{ id: "anthropic", kind: "api", async open(s: SessionSpec) { return scriptedProvider({ script: [{ type: "done" }] }).openSession(s); } }], maxPerDriver: 24, maxTotal: 24 });
  for (let i = 0; i < 24; i++) await pool.release(await pool.acquire(spec(`thr_${i}`, `model-${i}`)));
  const ms: number[] = [];
  for (let i = 0; i < 300; i++) {
    const s = performance.now();
    const l = await pool.acquire(spec("thr_x", `model-${i % 24}`));
    ms.push(performance.now() - s);
    await pool.release(l);
  }
  const p95 = percentile(ms, 95);
  console.log(`perf engine_pool: full pool (24) n=${ms.length} p95=${p95.toFixed(3)}ms budget_p95=20ms`);
  assert.ok(p95 < 20, `acquire p95 ${p95.toFixed(3)} ms with 24 sessions`);
  assert.equal(pool.status().totalWarm, 24);
});

test("perf chat_open: the hint sent when the thread opens makes the first message's engine warm", async () => {
  const d = slowDriver();
  const pool = createPool({ placement: "device", drivers: [d] });
  pool.hint(spec("thr_new"));                        // the thread was opened
  await sleep(COLD_MS + 20);                         // the person reads, then types
  const s = performance.now();
  const l = await pool.acquire(spec("thr_new"));     // the first message
  const ms = performance.now() - s;
  console.log(`perf chat_open: first acquire after the open hint ${ms.toFixed(3)}ms warm=${l.warm} (a cold open is ${COLD_MS}ms)`);
  assert.equal(l.warm, true);
  assert.ok(ms < 20, `first acquire took ${ms.toFixed(1)} ms`);
  assert.equal(pool.status().sessions[0]?.misses, 0);
});

test("perf send: first-token overhead is under 150 ms with the pool in front of a 200 ms provider, warm or cold", async () => {
  const provider = scriptedProvider({ latencyMs: 200, script: [{ type: "text", text: "hi" }, { type: "done" }] });
  const d: PoolDriver = { id: "anthropic", kind: "api", async open(s: SessionSpec) { await sleep(25); return provider.openSession(s); } };
  const pool = createPool({ placement: "device", drivers: [d] });
  const resolve = (s: SessionSpec): PoolSpec => spec(s.threadId);
  const engine = createTurnEngine({ holder: "device:d1", openSession: poolOpenSession(pool, resolve) });
  const overheads: number[] = [];
  for (let i = 0; i < 4; i++) {
    const id = `T${i % 2}`;
    if (i < 2) engine.openThread({ id, kind: "chat", starter: "usr_dana", agents: [{ id: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" }] });
    engine.receive({ threadId: id, author: { kind: "person", id: "usr_dana" }, body: `hello ${i}` });
    await engine.idle(id);
    const turn = engine.turns(id).at(-1);
    assert.ok(turn && turn.firstTokenOverheadMs !== null);
    overheads.push(turn.firstTokenOverheadMs);
  }
  const max = Math.max(...overheads);
  console.log(`perf send: with pool first_token_overhead_ms=${overheads.map((n) => n.toFixed(2)).join(",")} max=${max.toFixed(2)} budget=150 (the first turn includes a 25 ms cold open)`);
  assert.ok(max < 150, `first token overhead ${max.toFixed(2)} ms`);
  assert.equal(pool.status().sessions[0]?.hits, 3, "turns 2 to 4 ran on the warm session");
});
