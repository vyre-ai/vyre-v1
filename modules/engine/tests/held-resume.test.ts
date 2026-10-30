// A person answers the Gate task a tool call was held on. The turn parked on that task wakes and carries on, with the answer as the tool's result. Nothing else wakes, and a host without an engine does not fail the event.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";
import { bindEngine } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import type { EngineAgent } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_intake";
const DANA = { kind: "person" as const, id: "usr_dana" };
const NO_BEAT = (): (() => void) => () => {};
const agents = (): EngineAgent[] => [{ id: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" }];
const consumer = consumers["engine.held_resume"];
const ctx = {} as never;

afterEach(() => bindEngine(null));

async function parked(taskId: string) {
  const h = harness();
  const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId }));
  const p = scriptedProvider({
    script: (input) => (input.resumed
      ? [{ type: "text", text: input.resumed.approved ? "Allowed." : "Not allowed." }, { type: "done" }]
      : [{ type: "tool_call", id: "call_1", name: "automations_connector_trust_host", input: {} }, { type: "done" }]),
  });
  const engine = h.runtime({ openSession: p.openSession, callTool: held, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "go" });
  await engine.idle(THREAD);
  assert.equal(engine.turns(THREAD)[0]?.state, "waiting");
  bindEngine(engine);
  return { engine, p };
}

test("an approved Gate task wakes the turn parked on it and the model hears yes", async () => {
  const { engine, p } = await parked("tsk_a");
  assert.deepEqual(await consumer.run(ctx, { name: "gate.approved", payload: { taskId: "tsk_a" } }), ["tsk_a"]);
  await engine.idle(THREAD);
  assert.equal(p.sessions[1]?.inputs[0]?.resumed?.approved, true);
  assert.equal(engine.messages(THREAD).filter((m) => m.author.kind === "agent").at(-1)?.body, "Allowed.");
});

test("a denied or expired Gate task wakes it too, and the model hears no", async () => {
  for (const name of ["gate.denied", "gate.expired"]) {
    const { engine, p } = await parked("tsk_d");
    assert.deepEqual(await consumer.run(ctx, { name, payload: { taskId: "tsk_d" } }), ["tsk_d"], name);
    await engine.idle(THREAD);
    assert.equal(p.sessions[1]?.inputs[0]?.resumed?.approved, false, name);
    assert.equal(engine.messages(THREAD).filter((m) => m.author.kind === "agent").at(-1)?.body, "Not allowed.", name);
    bindEngine(null);
  }
});

test("a task no turn is parked on wakes nothing, and a second answer is ignored", async () => {
  const { engine } = await parked("tsk_b");
  assert.deepEqual(await consumer.run(ctx, { name: "gate.approved", payload: { taskId: "tsk_other" } }), []);
  assert.deepEqual(await consumer.run(ctx, { name: "gate.approved", payload: { taskId: "tsk_b" } }), ["tsk_b"]);
  assert.deepEqual(await consumer.run(ctx, { name: "gate.denied", payload: { taskId: "tsk_b" } }), []);
  await engine.idle(THREAD);
  assert.equal(engine.turns(THREAD).length, 2);
});

test("a host that runs no engine takes the event and does nothing", async () => {
  bindEngine(null);
  assert.deepEqual(await consumer.run(ctx, { name: "gate.approved", payload: { taskId: "tsk_x" } }), []);
});
