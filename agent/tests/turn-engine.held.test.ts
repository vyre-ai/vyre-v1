// A tool call held at the Gate parks the turn (ARCH 6.7): turn.waiting { task }, no result to the model, and a wake continues it when the task is answered.
// This file uses the engine's in-memory stores; modules/engine/tests/control.persist.test.ts runs the same flow on SQL across two hosts.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider, toolRunnerFrom } from "../src/turn-engine/index.ts";
import type { DriverEvent, EngineAgent, OpenThread } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }, { id: "docs", mode: "listen" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const sendCall: DriverEvent = { type: "tool_call", id: "call_1", name: "mail_send", input: { to: "pat" } };

test("a held call parks the turn and sends the model nothing; approval wakes it on the same account", async () => {
  const p = scriptedProvider({ script: (input) => (input.resumed ? [{ type: "text", text: "Sent." }, { type: "done" }] : [{ type: "text", text: "Sending." }, sendCall, { type: "text", text: "never" }, { type: "done" }]) });
  const runner = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_1", runId: "run_1" }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "send it" });
  await engine.idle("T");

  const turn = engine.turns("T")[0];
  assert.equal(turn?.state, "waiting");
  assert.equal(turn?.endedAt, null);
  assert.deepEqual(engine.events("T").filter((e) => e.type === "turn.waiting").map((e) => ("taskId" in e ? [e.reason, e.taskId, e.runId] : [e.reason])), [["approval", "tsk_1", "run_1"]]);
  assert.equal(p.sessions[0]?.toolResults.length, 0);
  assert.equal(engine.messages("T").filter((m) => m.author.kind === "agent").length, 0);
  assert.deepEqual(engine.queue("T").map((q) => q.state), ["done"]);

  assert.notEqual(engine.resume("tsk_1", { approved: true }), null);
  await engine.idle("T");
  assert.equal(p.sessions[1]?.inputs[0]?.resumed?.approved, true);
  assert.equal(p.sessions[1]?.inputs[0]?.resumed?.callId, "call_1");
  assert.equal(engine.turns("T")[1]?.kind, "wake");
  assert.equal(engine.turns("T")[1]?.state, "completed");
  assert.equal(engine.messages("T").filter((m) => m.author.kind === "agent").at(-1)?.body, "Sent.");
  assert.equal(engine.resume("tsk_1", { approved: true }), null);
  assert.equal(engine.resume("tsk_unknown", { approved: true }), null);
});

test("a thread keeps taking messages while a turn waits on a Gate task", async () => {
  const p = scriptedProvider({ script: (input) => (input.resumed || input.trigger?.body === "hello" ? [{ type: "text", text: "Hi." }, { type: "done" }] : [sendCall, { type: "done" }]) });
  const runner = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_2" }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "send it" });
  await engine.idle("T");
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["waiting", "completed"]);
  assert.deepEqual(engine.waiting("T").map((w) => w.taskId), ["tsk_2"]);
});

test("a result that is not held goes back to the model as before", async () => {
  const p = scriptedProvider({ script: [sendCall, { type: "text", text: "ok" }, { type: "done" }] });
  const runner = toolRunnerFrom(async () => ({ kind: "result", result: { ok: true, content: { data: 1 } } }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "go" });
  await engine.idle("T");
  assert.deepEqual(p.sessions[0]?.toolResults, [{ id: "call_1", result: { ok: true, content: { data: 1 } } }]);
  assert.equal(engine.turns("T")[0]?.state, "completed");
});

test("stop with an agent drops that agent's queued turns and releases its parked turn; others stay", async () => {
  const p = scriptedProvider({ script: [sendCall, { type: "done" }] });
  const runner = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_3" }));
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, callTool: runner });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "send it" });
  await engine.idle("T");
  const out = await engine.stop("T", { agentId: "docs" });
  assert.deepEqual([out.stopped.length, out.released.length, out.dropped.length], [0, 0, 0], "docs has nothing to stop");
  assert.equal(engine.waiting("T").length, 1);
  const all = await engine.stop("T", { agentId: "intake" });
  assert.deepEqual(all.released.map((r) => r.taskId), ["tsk_3"]);
  assert.equal(engine.waiting("T").length, 0);
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
});
