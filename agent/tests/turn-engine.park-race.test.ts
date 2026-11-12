// Release gate, 12 Nov (lane f-gate): the card of a held call is in the chat from the moment the call is held, but the turn wrote its wait only after its session had closed (up to 5 s on a
// busy server). An answer in that window found no wait, so the Allow ran the call and the turn sat "waiting" for ever. The wait is now written before the session closes; these hold a
// session's close open and answer inside the window.
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryWaits, createTurnEngine, scriptedProvider, toolRunnerFrom } from "../src/turn-engine/index.ts";
import { gate, until } from "../src/turn-engine/harness.ts";
import type { DriverEvent, EngineAgent, EngineSession, OpenSession, OpenThread } from "../src/turn-engine/index.ts";

const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const thread = (): OpenThread => ({ id: "T", kind: "chat", starter: "dana", agents: agents() });
const rm: DriverEvent = { type: "tool_call", id: "call_1", name: "terminal_run", input: { command: "rm -f a.txt" } };

/** The scripted provider with the first session's close held until `slow` opens. `closing` opens when that close starts. */
function slowClose() {
  const slow = gate();
  const closing = gate();
  const p = scriptedProvider({ script: (input) => (input.resumed ? [{ type: "text", text: `Resumed ${input.resumed.approved} ${JSON.stringify(input.resumed.result.content)}` }, { type: "done" }] : [rm, { type: "done" }]) });
  let first = true;
  const open: OpenSession = async (spec) => {
    const s = await p.openSession(spec);
    const held = first;
    first = false;
    const out: EngineSession = {
      send: (i) => s.send(i), sendToolResult: (id, r) => s.sendToolResult(id, r), inject: (m) => s.inject(m), cancel: () => s.cancel(),
      close: async () => { if (held) { closing.open(); await slow.wait; } return s.close(); },
      get warm() { return s.warm; },
    } as EngineSession;
    return out;
  };
  return { p, open, slow, closing };
}

test("Allow while the parked turn's session is still closing: the turn resumes once, with the answer that came", async () => {
  const { p, open, slow, closing } = slowClose();
  const waits = createMemoryWaits();
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_1" })), waits });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "remove it" });
  await closing.wait;
  // inside the window: the wait is there already, and the answer is taken
  assert.ok(waits.get("tsk_1"), "the wait is written before the session closes");
  const answer = { ok: true, content: { data: { exitCode: 0, output: "removed" } } };
  assert.notEqual(engine.resume("tsk_1", { approved: true, result: answer }), null, "the Allow finds the parked turn");
  assert.equal(engine.resume("tsk_1", { approved: true }), null, "a second answer is ignored");
  slow.open();
  await engine.idle("T");
  const turns = engine.turns("T");
  assert.deepEqual(turns.map((t) => `${t.kind}:${t.state}`), ["message:completed", "wake:completed"], "the parked turn left waiting and the wake ran once");
  assert.equal(p.sessions.length, 2, "one resume, no extra turn");
  assert.deepEqual(p.sessions[1]?.inputs[0]?.resumed?.result, answer, "the answer that came in the window was kept, not overwritten");
  assert.equal(engine.messages("T").filter((m) => m.author.kind === "agent").at(-1)?.body, `Resumed true ${JSON.stringify(answer.content)}`);
  assert.equal(engine.waiting("T").length, 0);
  assert.equal(waits.get("tsk_1"), null, "the wait was used up once");
});

test("Deny while the session is still closing: the turn resumes with the refusal", async () => {
  const { p, open, slow, closing } = slowClose();
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_2" })) });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "remove it" });
  await closing.wait;
  assert.notEqual(engine.resume("tsk_2", { approved: false, result: { ok: false, content: { code: "denied", message: "A person did not approve this: not now" } } }), null);
  slow.open();
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["completed", "completed"]);
  assert.equal(p.sessions[1]?.inputs[0]?.resumed?.approved, false);
  assert.match(JSON.stringify(p.sessions[1]?.inputs[0]?.resumed?.result), /not now/);
});

test("the answer comes after the session closed: unchanged, the wait is written once and resumed", async () => {
  const { p, open, slow } = slowClose();
  slow.open();
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_3" })) });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "remove it" });
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["waiting"]);
  assert.deepEqual(engine.waiting("T").map((w) => w.taskId), ["tsk_3"]);
  assert.notEqual(engine.resume("tsk_3", { approved: true }), null);
  await engine.idle("T");
  assert.deepEqual(engine.turns("T").map((t) => t.state), ["completed", "completed"]);
  assert.equal(p.sessions.length, 2);
});

test("Stop while the parked turn's session closes: the early wait goes, an answer that came is not run, and a later Allow finds nothing", async () => {
  const { p, open, slow, closing } = slowClose();
  const waits = createMemoryWaits();
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_4" })), waits });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "remove it" });
  await closing.wait;
  assert.notEqual(engine.resume("tsk_4", { approved: true }), null, "an Allow lands first");
  const stopping = engine.stop("T");
  slow.open();
  await stopping;
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]?.state, "cancelled");
  assert.equal(engine.turns("T").length, 1, "no wake ran into the stopped turn");
  assert.equal(p.sessions.length, 1);
  assert.equal(waits.get("tsk_4"), null, "no orphan wait");
  assert.ok(engine.queue("T").every((q) => q.state !== "queued"), "the wake the Allow queued was cancelled");
  assert.equal(engine.resume("tsk_4", { approved: true }), null, "a later Allow finds no turn to resume");
});

test("Stop while closing with no answer yet: no orphan wait", async () => {
  const { open, slow, closing } = slowClose();
  const waits = createMemoryWaits();
  const engine = createTurnEngine({ holder: "host:s", openSession: open, callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_5" })), waits });
  engine.openThread(thread());
  engine.receive({ threadId: "T", author: person, body: "remove it" });
  await closing.wait;
  const stopping = engine.stop("T");
  slow.open();
  await stopping;
  await engine.idle("T");
  await until(() => engine.turns("T")[0]?.state === "cancelled");
  assert.equal(waits.get("tsk_5"), null);
  assert.equal(engine.waiting("T").length, 0);
});
