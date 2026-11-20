// Why the engine started a turn reaches the capability an agent's tool call runs (r42-runtime, 20 Nov 2026): the engine notes the cause when it takes the turn off the queue (agent/src/tools/turn-start.ts), the tool layer puts it on
// the call's seed (turn.kind), and a capability reads it as ctx.turn. A turn nobody noted has none.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { ctx, loadGenerated } from "../src/tools/harness.ts";
import { noteTurnStart, turnCauseOf } from "../src/tools/turn-start.ts";
import type { Invoke } from "../../host/src/invoke.ts";

function rig() {
  const loaded = loadGenerated();
  const seeds: Array<{ turn?: { kind: string } | undefined; thread?: string | undefined }> = [];
  const invoke: Invoke = async (_cap, _input, seed) => {
    seeds.push({ turn: seed.turn, thread: seed.thread });
    return { status: "ok", output: {}, traceId: seed.trace?.traceId ?? "trace" };
  };
  const session = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => false,
    traceId: () => "trace_fixed",
  });
  session.preload("thr_cause", ["tasks_get"]);
  return { session, seeds };
}

test("the cause the engine noted for the agent's turn in this chat is on the call; another chat or another agent has none", async () => {
  const r = rig();
  noteTurnStart("thr_cause", "agt_intake", 1, "wake");
  await r.session.call(ctx({ thread: { threadId: "thr_cause", kind: "chat", planMode: false } }), "tasks_get", {
    taskId: "tsk_a1b2c3",
  });
  assert.deepEqual(r.seeds[0]!.turn, { kind: "wake" });
  await r.session.call(
    ctx({ agentId: "agt_other", thread: { threadId: "thr_cause", kind: "chat", planMode: false } }),
    "tasks_get",
    { taskId: "tsk_a1b2c3" },
  );
  assert.equal(r.seeds[1]!.turn, undefined, "another agent in the same chat: not noted");
  assert.equal(turnCauseOf("thr_nobody", "agt_intake"), undefined);
});

test("a newer turn replaces the cause, and a start noted without one carries none", async () => {
  const r = rig();
  noteTurnStart("thr_cause", "agt_intake", 1, "wake");
  noteTurnStart("thr_cause", "agt_intake", 2, "message");
  await r.session.call(ctx({ thread: { threadId: "thr_cause", kind: "chat", planMode: false } }), "tasks_get", {
    taskId: "tsk_a1b2c3",
  });
  assert.deepEqual(r.seeds[0]!.turn, { kind: "message" });
  noteTurnStart("thr_cause", "agt_intake", 3);
  await r.session.call(ctx({ thread: { threadId: "thr_cause", kind: "chat", planMode: false } }), "tasks_get", {
    taskId: "tsk_a1b2c3",
  });
  assert.equal(r.seeds[1]!.turn, undefined);
});

test("the engine notes why it started each turn: a person's message is a message, engine.wake is a wake", async () => {
  const { createTurnEngine, scriptedProvider } = await import("../src/turn-engine/index.ts");
  const { until } = await import("../src/turn-engine/harness.ts");
  const seen: Array<string | undefined> = [];
  const p = scriptedProvider({
    script: [{ type: "tool_call", id: "c1", name: "read_prices", input: {} }, { type: "done" }],
  });
  const e = createTurnEngine({
    holder: "host:a",
    openSession: p.openSession,
    toolSafety: () => "read",
    callTool: async () => {
      seen.push(turnCauseOf("TC", "intake"));
      return { ok: true, content: {} };
    },
  });
  e.openThread({ id: "TC", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
  e.receive({ threadId: "TC", author: { kind: "person", id: "dana" }, body: "Go" });
  await until(() => seen.length === 1);
  await e.idle("TC");
  e.wake("TC", "intake");
  await until(() => seen.length === 2);
  await e.idle("TC");
  assert.deepEqual(seen, ["message", "wake"]);
});
