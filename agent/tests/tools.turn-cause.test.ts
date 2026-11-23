// Why the engine started a turn reaches the capability an agent's tool call runs (r42-runtime, 20 Nov 2026): the engine notes the cause when it takes the turn off the queue (agent/src/tools/turn-start.ts), the tool layer puts it on
// the call's seed (turn.kind), and a capability reads it as ctx.turn. A turn nobody noted has none.
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { ctx, loadGenerated } from "../src/tools/harness.ts";
import { noteTurnStart, turnCauseOf, turnTriggerOf } from "../src/tools/turn-start.ts";
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

test("a call after the turn ended has no cause; a held call resumed carries the cause of the turn it continues (a wake stays a wake, a message turn stays a message turn); an answer that came as a plain wake is not guarded", async () => {
  const { createTurnEngine, scriptedProvider, toolRunnerFrom } = await import("../src/turn-engine/index.ts");
  const { until } = await import("../src/turn-engine/harness.ts");
  const run = async (
    start: "message" | "wake",
    answer: "resume" | "wake",
  ): Promise<{ seen: Array<string | undefined>; after: string | undefined }> => {
    const seen: Array<string | undefined> = [];
    const p = scriptedProvider({
      script: (input) =>
        input.resumed
          ? [{ type: "tool_call", id: "c2", name: "read_prices", input: {} }, { type: "done" }]
          : [{ type: "tool_call", id: "c1", name: "mail_send", input: {} }, { type: "done" }],
    });
    const e = createTurnEngine({
      holder: "host:a",
      openSession: p.openSession,
      toolSafety: () => "read",
      callTool: toolRunnerFrom(async (c) => {
        seen.push(turnCauseOf("TH", "intake"));
        return c.name === "mail_send"
          ? { kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_h" }
          : { kind: "done", result: { ok: true, content: {} } };
      }),
    });
    e.openThread({ id: "TH", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
    if (start === "message") e.receive({ threadId: "TH", author: { kind: "person", id: "dana" }, body: "Go" });
    else e.wake("TH", "intake");
    await until(() => e.waiting("TH").length === 1);
    await e.idle("TH");
    assert.equal(turnCauseOf("TH", "intake"), undefined, "the turn ended: the cause is cleared");
    if (answer === "resume") e.resume("tsk_h", { approved: true });
    else e.wake("TH", "intake", { answers: "tsk_nobody" });
    await until(() => seen.length === 2);
    await e.idle("TH");
    return { seen, after: turnCauseOf("TH", "intake") };
  };
  const m = await run("message", "resume");
  assert.equal(m.seen[0], "message");
  assert.equal(m.seen[1], "message", "a resumed message turn is a message turn");
  const w = await run("wake", "resume");
  assert.equal(w.seen[1], "wake", "a resumed wake is a wake");
  assert.equal(w.after, undefined, "after the resumed turn ended there is no cause");
  const plain = await run("message", "wake");
  assert.equal(
    plain.seen[1],
    "resume",
    "the wake of a call whose wait was not recorded is not a wake (no capability guards it)",
  );
});

test("a wake that answers a held call and is dropped before it runs leaves no pending cause; one that runs leaves none either", async () => {
  const { createTurnEngine, scriptedProvider } = await import("../src/turn-engine/index.ts");
  const { until, gate } = await import("../src/turn-engine/harness.ts");
  const stuck = gate();
  const p = scriptedProvider({
    script: [{ type: "text", text: "ok" }, { type: "done" }],
    beforeEvent: async () => {
      await stuck.wait;
    },
  });
  const e = createTurnEngine({ holder: "host:a", openSession: p.openSession, toolSafety: () => "read" });
  e.openThread({ id: "TD", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
  e.wake("TD", "intake");
  await until(() => e.turns("TD").length === 1);
  // the agent is busy: this wake waits in the queue, with its cause
  e.wake("TD", "intake", { answers: "tsk_gone" });
  assert.equal(e.pendingWakeCauses(), 1);
  await e.stop("TD", { clearQueue: true });
  stuck.open();
  await e.idle("TD");
  // the next wake on the chat sweeps the entry of the dropped one
  e.wake("TD", "intake");
  await e.idle("TD");
  assert.equal(e.pendingWakeCauses(), 0, "the dropped wake left its entry");
  e.wake("TD", "intake", { answers: "tsk_ran" });
  await e.idle("TD");
  assert.equal(e.pendingWakeCauses(), 0, "a wake that ran leaves none");
});

test("the message that started a turn (its id and author) reaches the capability with the cause; a wake, a routine or a turn noted without one has no message", async () => {
  const r = rig();
  const call = () =>
    r.session.call(ctx({ thread: { threadId: "thr_cause", kind: "chat", planMode: false } }), "tasks_get", {
      taskId: "tsk_a1b2c3",
    });
  noteTurnStart("thr_cause", "agt_intake", 1, "message", { messageId: "msg_1", authorKind: "person", authorId: "usr_dana" });
  await call();
  assert.deepEqual(r.seeds[0]!.turn, { kind: "message", messageId: "msg_1", authorKind: "person", authorId: "usr_dana" });
  noteTurnStart("thr_cause", "agt_intake", 2, "wake");
  await call();
  assert.deepEqual(r.seeds[1]!.turn, { kind: "wake" });
  assert.equal(turnTriggerOf("thr_cause", "agt_intake"), undefined);
});

test("the engine notes the message that started a message turn, and none for a wake", async () => {
  const { createTurnEngine, scriptedProvider } = await import("../src/turn-engine/index.ts");
  const { until } = await import("../src/turn-engine/harness.ts");
  const seen: Array<{ cause?: string | undefined; by?: string | undefined; kind?: string | undefined }> = [];
  const p = scriptedProvider({
    script: [{ type: "tool_call", id: "c1", name: "read_prices", input: {} }, { type: "done" }],
  });
  const e = createTurnEngine({
    holder: "host:a",
    openSession: p.openSession,
    toolSafety: () => "read",
    callTool: async () => {
      const t = turnTriggerOf("TM", "intake");
      seen.push({ cause: turnCauseOf("TM", "intake"), by: t?.authorId, kind: t?.authorKind });
      return { ok: true, content: {} };
    },
  });
  e.openThread({ id: "TM", kind: "chat", starter: "dana", agents: [{ id: "intake", mode: "lead" }] });
  e.receive({ threadId: "TM", author: { kind: "person", id: "dana" }, body: "Go" });
  await until(() => seen.length === 1);
  await e.idle("TM");
  e.wake("TM", "intake");
  await until(() => seen.length === 2);
  await e.idle("TM");
  assert.deepEqual(seen, [
    { cause: "message", by: "dana", kind: "person" },
    { cause: "wake", by: undefined, kind: undefined },
  ]);
});
