// Send budget (spec Speed and smoothness): first streamed token = the provider's own latency plus under 150 ms of ours.
// Fake provider injects 200 ms; the engine's measured overhead (receive to first token, minus the injected latency) must stay under 150 ms.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";

const BUDGET_MS = 150;
const INJECTED_MS = 200;

test("perf send: turn.first_token_overhead is under 150 ms with a 200 ms provider", async () => {
  const p = scriptedProvider({ latencyMs: INJECTED_MS, script: [{ type: "text", text: "hi" }, { type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  const overheads: number[] = [];
  for (let i = 0; i < 5; i++) {
    const id = `T${i}`;
    engine.openThread({ id, kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
    const t0 = performance.now();
    engine.receive({ threadId: id, author: { kind: "person", id: "dana" }, body: "hello" });
    await engine.idle(id);
    const wall = performance.now() - t0;
    const turn = engine.turns(id)[0];
    assert.ok(turn && turn.firstTokenOverheadMs !== null, "first token was measured");
    overheads.push(turn.firstTokenOverheadMs);
    assert.ok(wall >= INJECTED_MS - 5, "the injected latency really elapsed");
  }
  const max = Math.max(...overheads);
  console.log(`perf send: injected=${INJECTED_MS}ms first_token_overhead_ms=${overheads.map((n) => n.toFixed(2)).join(",")} max=${max.toFixed(2)} budget=${BUDGET_MS}`);
  assert.ok(max < BUDGET_MS, `first token overhead ${max.toFixed(2)} ms is over the ${BUDGET_MS} ms budget`);
});

test("perf send: queueing ten messages does not add per-message overhead to the first turn", async () => {
  const p = scriptedProvider({ latencyMs: 20, script: [{ type: "text", text: "hi" }, { type: "done" }] });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
  for (let i = 0; i < 10; i++) engine.receive({ threadId: "T", author: { kind: "person", id: "dana" }, body: `m${i}` });
  await engine.idle("T");
  const first = engine.turns("T")[0]?.firstTokenOverheadMs;
  assert.ok(first !== null && first !== undefined && first < BUDGET_MS, `first turn overhead ${String(first)} ms`);
});
