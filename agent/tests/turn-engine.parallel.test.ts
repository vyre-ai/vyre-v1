// A step that asks for several tools: independent reads run together (at most six at once), writes and anything the Gate may hold run alone and in order after them, a held call parks the turn,
// a failed call does not stop the others, and results go back in the order the model asked.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider, toolRunnerFrom } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const call = (id: string, name: string): DriverEvent => ({ type: "tool_call", id, name, input: {} });
const toolClass = (name: string): "read" | "other" => (name.startsWith("r_") ? "read" : "other");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** An engine whose provider asks for these calls in one step, and a runner that logs when each starts and ends. */
function run(calls: DriverEvent[], o: { parallel?: boolean; cap?: number; classify?: boolean; held?: string; fail?: string; ms?: number } = {}) {
  const log: string[] = [];
  let live = 0, peak = 0;
  const p = scriptedProvider({ script: [...calls, { type: "tool_wait" }, { type: "text", text: "done" }, { type: "done" }] });
  const open: typeof p.openSession = async (x) => { const s = await p.openSession(x); if (o.parallel !== false) Object.assign(s, { parallelTools: true }); return s; };
  const runner = toolRunnerFrom(async (c) => {
    log.push(`start ${c.name}`);
    live++; peak = Math.max(peak, live);
    await sleep(o.ms ?? 15);
    live--;
    log.push(`end ${c.name}`);
    if (c.name === o.fail) throw new Error("boom");
    if (c.name === o.held) return { kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_h" };
    return { kind: "result", result: { ok: true, content: { name: c.name } } };
  });
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: runner, ...(o.classify === false ? {} : { toolClass }), ...(o.cap ? { maxParallel: o.cap } : {}) });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "go" });
  return { engine, p, log, peak: () => peak };
}

test("three independent reads run at the same time and their results come back in the order asked", async () => {
  const t = run([call("c1", "r_a"), call("c2", "r_b"), call("c3", "r_c")]);
  await t.engine.idle("T");
  assert.equal(t.peak(), 3);
  assert.deepEqual(t.p.sessions[0]?.toolResults.map((r) => r.id), ["c1", "c2", "c3"]);
  assert.equal(t.engine.turns("T")[0]?.state, "completed");
});

test("writes run after the reads, one at a time, in the order asked", async () => {
  const t = run([call("c1", "w_one"), call("c2", "r_a"), call("c3", "r_b"), call("c4", "w_two")]);
  await t.engine.idle("T");
  assert.deepEqual(t.log.slice(0, 2).sort(), ["start r_a", "start r_b"], "the reads go first, together");
  assert.deepEqual(t.log.slice(4), ["start w_one", "end w_one", "start w_two", "end w_two"], "then each write on its own");
  assert.equal(t.peak(), 2);
  assert.deepEqual(t.p.sessions[0]?.toolResults.map((r) => r.id), ["c1", "c2", "c3", "c4"]);
});

test("at most six reads run at once; the rest follow in the next wave", async () => {
  const t = run(Array.from({ length: 8 }, (_, i) => call(`c${i}`, `r_${i}`)));
  await t.engine.idle("T");
  assert.equal(t.peak(), 6);
  assert.equal(t.p.sessions[0]?.toolResults.length, 8);
  const small = run(Array.from({ length: 5 }, (_, i) => call(`c${i}`, `r_${i}`)), { cap: 2 });
  await small.engine.idle("T");
  assert.equal(small.peak(), 2);
});

test("a call the Gate holds runs alone, parks the turn, and the calls after it do not run", async () => {
  const t = run([call("c1", "r_a"), call("c2", "w_send"), call("c3", "w_after")], { held: "w_send" });
  await t.engine.idle("T");
  assert.equal(t.engine.turns("T")[0]?.state, "waiting");
  assert.ok(!t.log.includes("start w_after"), "nothing runs after the held call");
  assert.deepEqual(t.p.sessions[0]?.toolResults.map((r) => r.id), ["c1"], "the read's result went back, the held call has none");
  assert.deepEqual(t.engine.waiting("T").map((w) => w.taskId), ["tsk_h"]);
});

test("a call that throws does not stop the others", async () => {
  const t = run([call("c1", "r_a"), call("c2", "r_bad"), call("c3", "r_c")], { fail: "r_bad" });
  await t.engine.idle("T");
  const results = t.p.sessions[0]!.toolResults;
  assert.deepEqual(results.map((r) => [r.id, r.result.ok]), [["c1", true], ["c2", false], ["c3", true]]);
  assert.equal(t.engine.turns("T")[0]?.state, "completed");
});

test("without a session that says parallelTools, or without a classifier, calls run one at a time as before", async () => {
  const a = run([call("c1", "r_a"), call("c2", "r_b"), call("c3", "r_c")], { parallel: false });
  await a.engine.idle("T");
  assert.equal(a.peak(), 1);
  const b = run([call("c1", "r_a"), call("c2", "r_b")], { classify: false });
  await b.engine.idle("T");
  assert.equal(b.peak(), 1);
  assert.deepEqual(b.p.sessions[0]?.toolResults.map((r) => r.id), ["c1", "c2"]);
});
