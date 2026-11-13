// Release gate, 12 Nov (lane f-gate): a turn parked on a held call writes its wait before its session closes, so an answer in that window resumes it. On SQL: the row is there for
// engine.gate_resume and engine.hold_answered to see while the session closes (impl.ts asks engine_waits whether a turn is parked, so the agent is not also woken with a held note),
// and a host that dies inside the window leaves a wait that the host taking the thread over resumes on the Allow.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import { LEASE_TTL_MS } from "../../../agent/src/turn-engine/index.ts";
import { gate, until } from "../../../agent/src/turn-engine/harness.ts";
import type { EngineAgent, EngineSession, OpenSession } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_park";
const DANA = { kind: "person" as const, id: "usr_dana" };
const NO_BEAT = (): (() => void) => () => {};
const agents = (): EngineAgent[] => [{ id: "agt_dex", mode: "lead" }];

function slowly(open: OpenSession, slow: { wait: Promise<void> }, closing: { open: () => void }): OpenSession {
  return async (spec) => {
    const s = await open(spec);
    return {
      send: (i) => s.send(i),
      sendToolResult: (id, r) => s.sendToolResult(id, r),
      inject: (m) => s.inject(m),
      cancel: () => s.cancel(),
      close: async () => {
        closing.open();
        await slow.wait;
        return s.close();
      },
      get warm() {
        return s.warm;
      },
    } as EngineSession;
  };
}

test("on SQL the wait row is there while the parked turn's session closes, and an Allow then resumes the turn once", async () => {
  const a = harness();
  const slow = gate(),
    closing = gate();
  const p = scriptedProvider({
    script: (i) =>
      i.resumed
        ? [{ type: "text", text: "Removed." }, { type: "done" }]
        : [{ type: "tool_call", id: "call_1", name: "terminal_run", input: { command: "rm a" } }, { type: "done" }],
  });
  const e = a.runtime({
    openSession: slowly(p.openSession, slow, closing),
    holder: "host:a",
    callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_p1" })),
    schedule: NO_BEAT,
  });
  e.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  e.receive({ threadId: THREAD, author: DANA, body: "remove a" });
  await closing.wait;
  assert.deepEqual(
    a.rows("SELECT task_id FROM engine_waits WHERE task_id = ?", "tsk_p1").length,
    1,
    "gate_resume and hold_answered see a parked turn inside the window",
  );
  assert.notEqual(e.resume("tsk_p1", { approved: true, result: { ok: true, content: { data: "removed" } } }), null);
  slow.open();
  await e.idle(THREAD);
  // later sessions close at once
  assert.deepEqual(
    e.turns(THREAD).map((t) => t.state),
    ["completed", "completed"],
  );
  assert.equal(p.sessions.length, 2);
  assert.deepEqual(p.sessions[1]?.inputs[0]?.resumed?.result, { ok: true, content: { data: "removed" } });
  assert.equal(a.rows("SELECT task_id FROM engine_waits").length, 0, "used once");
});

test("a host that dies while its parked turn's session closes: the host that takes the thread over resumes it on the Allow, and the late host leaves it alone", async () => {
  const a = harness();
  const slow = gate(),
    closing = gate();
  const pa = scriptedProvider({
    script: [{ type: "tool_call", id: "call_1", name: "terminal_run", input: { command: "rm a" } }, { type: "done" }],
  });
  const ea = a.runtime({
    openSession: slowly(pa.openSession, slow, closing),
    holder: "host:a",
    callTool: toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_p2" })),
    schedule: NO_BEAT,
  });
  ea.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  ea.receive({ threadId: THREAD, author: DANA, body: "remove a" });
  await closing.wait;
  assert.equal(
    a.rows("SELECT task_id FROM engine_waits").length,
    1,
    "the wait is written; the turn row is not yet waiting",
  );

  // host A stops beating (dead in the window); host B takes the thread over
  const b = harness({ raw: a.raw, clock: a.clock });
  const pb = scriptedProvider({
    script: (i) =>
      i.resumed
        ? [{ type: "text", text: "Removed." }, { type: "done" }]
        : [{ type: "text", text: "?" }, { type: "done" }],
  });
  const eb = b.runtime({ openSession: pb.openSession, holder: "host:b", schedule: NO_BEAT });
  eb.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  a.advance(LEASE_TTL_MS + 1000);
  assert.equal(eb.recover(THREAD), true);
  await eb.idle(THREAD);
  assert.equal(pb.sessions.length, 0, "the touched turn is not run again by itself");
  assert.deepEqual(
    eb.waiting(THREAD).map((w) => w.taskId),
    ["tsk_p2"],
    "the parked call is still answerable on the new host",
  );

  // host A comes back late: its lease is gone, so it ends as lost and leaves the rows to B
  slow.open();
  await ea.idle(THREAD);
  assert.equal(ea.turns(THREAD)[0]?.error?.code, "lease_lost");
  assert.equal(a.rows("SELECT task_id FROM engine_waits").length, 1, "the late host did not take the wait away");

  assert.notEqual(eb.resume("tsk_p2", { approved: true }), null, "the Allow after the restart resumes");
  await eb.idle(THREAD);
  await until(() => pb.sessions.length === 1);
  assert.equal(pb.sessions[0]?.inputs[0]?.resumed?.approved, true);
  assert.equal(pb.sessions[0]?.inputs[0]?.resumed?.callId, "call_1");
  assert.equal(a.rows("SELECT task_id FROM engine_waits").length, 0);
});
