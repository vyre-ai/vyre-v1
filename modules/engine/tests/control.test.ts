// engine control (spec 4.14, 4.17): interrupt, stop, stop_all, set_mode, set_model, switch, and a tool call held at the Gate.
// Real SQLite behind ctx.db, fake provider behind the turn engine. Every event a handler emits is checked against the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngineRuntime, handlers } from "../impl.ts";
import { interrupt, setMode, setModel, stop, stopAll, switchEngine } from "../handlers/control.ts";
import { bindEngine, mintEngineId, sqlMessages } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import { gate, until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent, EngineAgent } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_intake";
const DANA = { kind: "person" as const, id: "usr_dana" };
const NO_BEAT = (): (() => void) => () => {};
const agents = (): EngineAgent[] => [{ id: "agt_intake", mode: "lead", model: "claude-sonnet-5-5" }, { id: "agt_docs", mode: "listen" }, { id: "agt_billing", mode: "listen" }];
const THREAD_SPEC = { threadId: THREAD, kind: "chat", starter: "usr_dana", agents: [
  { agentId: "agt_intake", mode: "lead" as const, model: "claude-sonnet-5-5" }, { agentId: "agt_docs", mode: "listen" as const }, { agentId: "agt_billing", mode: "listen" as const },
] };
const done: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];

// ---- a held tool call parks the turn

for (const mode of ["ask", "allow", "auto"] as const) {
  test(`set_mode Auto cannot loosen a Gate hold: in ${mode} mode the held call parks the turn and nothing runs after it`, async () => {
    const h = harness();
    // Ask, Allow and Auto only decide the prompts of local tools. The Gate is decided inside invoke, which answers held in every mode.
    const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true, taskId: "tsk_gate1", mode } }, taskId: "tsk_gate1", runId: "run_send1" }));
    const p = scriptedProvider({
      script: (input) => (input.resumed
        ? [{ type: "text", text: input.resumed.approved ? "Sent." : "Not sent." }, { type: "done" }]
        : [{ type: "text", text: "Sending." }, { type: "tool_call", id: "call_1", name: "mail_send", input: { to: "pat@acme.test" } }, { type: "text", text: "Sent." }, { type: "done" }]),
    });
    const engine = h.runtime({ openSession: p.openSession, callTool: held, schedule: NO_BEAT });
    engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
    engine.receive({ threadId: THREAD, author: DANA, body: "send it" });
    await engine.idle(THREAD);

    const waits = engine.events(THREAD).flatMap((e) => (e.type === "turn.waiting" && e.reason === "approval" ? [e] : []));
    assert.equal(waits.length, 1, mode);
    assert.equal(waits[0]?.taskId, "tsk_gate1");
    assert.equal(waits[0]?.runId, "run_send1");
    assert.equal(p.sessions[0]?.toolResults.length, 0, "the model never gets a result for a held call");
    assert.equal(engine.turns(THREAD)[0]?.state, "waiting");
    assert.equal(engine.events(THREAD).filter((e) => e.type === "turn.completed").length, 0, "the turn did not complete past the hold");
    assert.equal(engine.messages(THREAD).filter((m) => m.author.kind === "agent").length, 0, "no reply was posted past the hold");
    assert.deepEqual(engine.waiting(THREAD).map((w) => w.taskId), ["tsk_gate1"]);
    assert.equal(h.rows("SELECT task_id, call_id, tool_name FROM engine_waits").length, 1);

    // Denied: the wake runs on the same account and the model is told no.
    assert.notEqual(engine.resume("tsk_gate1", { approved: false }), null);
    assert.equal(engine.resume("tsk_gate1", { approved: false }), null, "a second answer is ignored");
    await engine.idle(THREAD);
    const wake = p.sessions[1]?.inputs[0];
    assert.equal(wake?.resumed?.approved, false);
    assert.equal(wake?.resumed?.callId, "call_1");
    assert.equal(wake?.resumed?.result.ok, false);
    assert.equal(wake?.asker, "usr_dana");
    assert.equal(engine.turns(THREAD)[1]?.state, "completed");
    assert.equal(engine.waiting(THREAD).length, 0);
    assert.equal(h.rows("SELECT task_id FROM engine_waits").length, 0, "the wait row is gone once the wake started");
  });
}

test("an approved hold continues the turn with the tool's own result", async () => {
  const h = harness();
  const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_gate2" }));
  const p = scriptedProvider({
    script: (input) => (input.resumed ? [{ type: "text", text: "Sent." }, { type: "done" }] : [{ type: "tool_call", id: "call_9", name: "mail_send", input: {} }, { type: "done" }]),
  });
  const engine = h.runtime({ openSession: p.openSession, callTool: held, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "go" });
  await engine.idle(THREAD);
  engine.resume("tsk_gate2", { approved: true, result: { ok: true, content: { data: { sent: true } } } });
  await engine.idle(THREAD);
  assert.deepEqual(p.sessions[1]?.inputs[0]?.resumed?.result, { ok: true, content: { data: { sent: true } } });
  assert.equal(p.sessions[1]?.inputs[0]?.resumed?.toolName, "mail_send");
  assert.equal(engine.turns(THREAD)[1]?.state, "completed");
  assert.equal(engine.messages(THREAD).filter((m) => m.author.kind === "agent").at(-1)?.body, "Sent.");
});

// ---- stop and stop_all

test("stop_all stops every turn: the running one, everything queued, and the thread takes the next message", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  const hold = gate();
  let holding = true;
  const p = scriptedProvider({ script: done, beforeEvent: async (i) => { if (i === 0 && holding) await hold.wait; } });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "start" });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], body: "docs too" });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_billing" }], body: "and billing" });
  await until(() => engine.turns(THREAD).some((t) => t.state === "running"));
  const running = engine.turns(THREAD).find((t) => t.state === "running");

  const out = await stopAll(h.ctx, { threadId: THREAD });
  holding = false;
  await engine.idle(THREAD);

  assert.equal(out.stopped, 3, "one running turn and two queued");
  assert.deepEqual(contractErrors("engine.stop_all", "out", out), []);
  assert.deepEqual(engine.turns(THREAD).map((t) => t.state), ["cancelled"], "no queued turn started");
  assert.deepEqual(engine.queue(THREAD).map((q) => q.state), ["cancelled", "cancelled", "cancelled"]);
  assert.equal(h.named("turn.cancelled").length, 1);
  assert.equal(h.named("turn.cancelled")[0]?.payload["turnId"], running?.id);
  assert.equal(h.named("turn.cancelled")[0]?.payload["by"], "usr_dana");
  assert.deepEqual(assertEventsConform(h), []);

  engine.receive({ threadId: THREAD, author: DANA, body: "are you there" });
  await engine.idle(THREAD);
  assert.equal(engine.turns(THREAD).at(-1)?.state, "completed", "a stopped thread accepts the next message as a fresh turn");
});

test("stop_all also releases a turn parked on a held tool call", async () => {
  const h = harness();
  const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: {} }, taskId: "tsk_gate3" }));
  const p = scriptedProvider({ script: [{ type: "tool_call", id: "call_2", name: "mail_send", input: {} }, { type: "done" }] });
  const engine = h.runtime({ openSession: p.openSession, callTool: held, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "go" });
  await engine.idle(THREAD);
  const parked = engine.turns(THREAD)[0];
  assert.equal(parked?.state, "waiting");

  const out = await stopAll(h.ctx, { threadId: THREAD });
  assert.equal(out.stopped, 1);
  assert.equal(engine.turns(THREAD)[0]?.state, "cancelled");
  assert.equal(engine.waiting(THREAD).length, 0);
  assert.equal(engine.resume("tsk_gate3", { approved: true }), null, "the approval of a stopped turn starts nothing");
  assert.equal(h.named("turn.cancelled")[0]?.payload["turnId"], parked?.id);
  assert.deepEqual(assertEventsConform(h), []);
});

test("stop with an agent stops that agent only: its running turn and its queued turns", async () => {
  const h = harness();
  const hold = gate();
  const p = scriptedProvider({ script: done, beforeEvent: async (i, _ev, spec) => { if (i === 0 && spec.agent.id === "agt_docs") await hold.wait; } });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], body: "docs first" });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], body: "docs again" });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_billing" }], body: "billing" });
  await until(() => engine.turns(THREAD).some((t) => t.state === "running"));

  const other = await stop(h.ctx, { threadId: THREAD, agentId: "agt_intake" });
  assert.equal(other.stopped, 0, "the agent that is not working has nothing to stop");

  const out = await stop(h.ctx, { threadId: THREAD, agentId: "agt_docs" });
  assert.equal(out.stopped, 2, "its running turn and the one queued behind it");
  await engine.idle(THREAD);
  const states = engine.turns(THREAD).map((t) => `${t.agentId}:${t.state}`);
  // Billing answers without an @mention, so its reply goes to the lead: one more turn.
  assert.deepEqual(states, ["agt_docs:cancelled", "agt_billing:completed", "agt_intake:completed"]);
  assert.deepEqual(contractErrors("engine.stop", "out", out), []);
  assert.deepEqual(assertEventsConform(h), []);
});

// ---- interrupt

test("interrupt cancels the running turn and runs the stored message first", async () => {
  const h = harness();
  const hold = gate();
  let first = true;
  const p = scriptedProvider({ script: done, beforeEvent: async (i) => { if (i === 0 && first) { first = false; await hold.wait; } } });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "draft the whole letter" });
  engine.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], body: "docs, check the template" });
  await until(() => engine.turns(THREAD).some((t) => t.state === "running"));
  const running = engine.turns(THREAD).find((t) => t.state === "running");

  // The chat module stored the message; interrupt makes it the next turn.
  const stored = sqlMessages(h.db).append({ id: mintEngineId("m"), threadId: THREAD, author: DANA, mentions: [], depth: 0, body: "stop, use the new plan" });
  const out = await interrupt(h.ctx, { threadId: THREAD, messageId: stored.id });
  await engine.idle(THREAD);

  assert.deepEqual(out, { queued: true });
  assert.deepEqual(contractErrors("engine.interrupt", "out", out), []);
  const turns = engine.turns(THREAD);
  assert.equal(turns[0]?.id, running?.id);
  assert.equal(turns[0]?.state, "cancelled");
  assert.equal(turns[1]?.kind, "interrupt", "the interrupt runs before the docs turn that was already waiting");
  assert.equal(turns[1]?.state, "completed");
  assert.equal(p.sessions[1]?.inputs[0]?.trigger?.body, "stop, use the new plan");
  assert.equal(h.named("turn.cancelled")[0]?.payload["turnId"], running?.id);
  assert.equal(h.named("turn.queued")[0]?.payload["kind"], "interrupt");
  assert.deepEqual(assertEventsConform(h), []);
});

test("interrupt without a message only cancels; an unknown message is validation.not_found", async () => {
  const h = harness();
  const hold = gate();
  const p = scriptedProvider({ script: done, beforeEvent: async (i) => { if (i === 0) await hold.wait; } });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  engine.receive({ threadId: THREAD, author: DANA, body: "start" });
  await until(() => engine.turns(THREAD).some((t) => t.state === "running"));
  const out = await interrupt(h.ctx, { threadId: THREAD });
  await engine.idle(THREAD);
  assert.deepEqual(out, { queued: false });
  assert.equal(engine.turns(THREAD)[0]?.state, "cancelled");
  await assert.rejects(interrupt(h.ctx, { threadId: THREAD, messageId: "msg_nothere" }), (e) => codeOf(e) === "validation.not_found");
});

// ---- set_mode, set_model, switch

test("set_mode makes one lead, demotes the old lead, saves it, and a reopened thread keeps it", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  const p = scriptedProvider({ script: done });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });

  const out = await setMode(h.ctx, { threadId: THREAD, agentId: "agt_docs", mode: "lead" });
  assert.deepEqual(out, { mode: "lead", leadAgentId: "agt_docs" }, "the handler opens the thread from threads.get first");
  assert.deepEqual(contractErrors("engine.set_mode", "out", out), []);
  assert.deepEqual(engine.agents(THREAD).map((a) => `${a.id}:${a.mode}`), ["agt_intake:listen", "agt_docs:lead", "agt_billing:listen"]);
  assert.equal(h.named("agent.mode_changed")[0]?.payload["agentId"], "agt_docs");
  assert.deepEqual(h.rows("SELECT agent_id, mode FROM engine_agent_state ORDER BY agent_id").map((r) => `${String(r["agent_id"])}:${String(r["mode"])}`), ["agt_docs:lead", "agt_intake:listen"]);

  // A second host opens the same thread: threads.get still says intake leads, the saved modes win.
  const other = harness({ raw: h.raw, threads: [THREAD_SPEC] });
  const engine2 = createEngineRuntime({ db: other.db, holder: "host:b", openSession: p.openSession, schedule: NO_BEAT });
  bindEngine(engine2);
  const again = await setMode(other.ctx, { threadId: THREAD, agentId: "agt_docs", mode: "lead" });
  assert.equal(again.leadAgentId, "agt_docs");
  assert.deepEqual(engine2.agents(THREAD).filter((a) => a.mode === "lead").map((a) => a.id), ["agt_docs"]);

  const gone = await setMode(h.ctx, { threadId: THREAD, agentId: "agt_nobody", mode: "lead" }).catch((e: unknown) => e);
  assert.equal(codeOf(gone), "validation.not_found");
  assert.deepEqual(assertEventsConform(h), []);
});

test("set_mode to listen leaves the thread with no lead and the composer says nobody will reply", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  const engine = h.runtime({ openSession: scriptedProvider({ script: done }).openSession, schedule: NO_BEAT });
  const out = await setMode(h.ctx, { threadId: THREAD, agentId: "agt_intake", mode: "listen" });
  assert.deepEqual(out, { mode: "listen", leadAgentId: null });
  assert.equal(engine.preview(THREAD, { author: DANA }).responders.length, 0);
});

test("set_model keeps the provider, effort and account, and tells the thread", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  const engine = h.runtime({ openSession: scriptedProvider({ script: done }).openSession, schedule: NO_BEAT });
  const out = await setModel(h.ctx, { threadId: THREAD, agentId: "agt_intake", model: "gpt-5", effort: "high", accountRef: "#Team_OpenAI_Key" });
  assert.deepEqual(out, { model: "gpt-5", provider: "openai", effort: "high", accountRef: "#Team_OpenAI_Key" });
  assert.deepEqual(contractErrors("engine.set_model", "out", out), []);
  assert.equal(engine.agents(THREAD).find((a) => a.id === "agt_intake")?.model, "gpt-5");
  assert.equal(engine.agents(THREAD).find((a) => a.id === "agt_intake")?.accountRef, "#Team_OpenAI_Key");
  // Only the effort changes next: the rest stays as saved.
  const next = await setModel(h.ctx, { threadId: THREAD, agentId: "agt_intake", effort: "low" });
  assert.deepEqual(next, { model: "gpt-5", provider: "openai", effort: "low", accountRef: "#Team_OpenAI_Key" });
  assert.equal(h.named("agent.model_changed").length, 2);
  assert.deepEqual(assertEventsConform(h), []);
  const none = await setModel(h.ctx, { threadId: THREAD, agentId: "agt_docs", effort: "low" }).catch((e: unknown) => e);
  assert.equal(codeOf(none), "validation.precondition_failed", "an agent with no model yet needs one named");
});

test("switch changes the engine from the next turn and says so in one quiet line", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  const p = scriptedProvider({ script: done });
  const engine = h.runtime({ openSession: p.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  for (let i = 0; i < 3; i++) { engine.receive({ threadId: THREAD, author: DANA, body: `message ${i}` }); await engine.idle(THREAD); }

  const out = await switchEngine(h.ctx, { threadId: THREAD, driver: "codex", model: "gpt-5-codex" });
  assert.equal(out.engine, "codex");
  assert.equal(out.handoffTurns, 3);
  assert.equal(out.quietLine, "Switched to Codex, picked up from the summary and the last 3 turns");
  assert.deepEqual(contractErrors("engine.switch", "out", out), []);
  assert.equal(engine.agents(THREAD).find((a) => a.id === "agt_intake")?.model, "gpt-5-codex");
  const ev = h.named("turn.engine_switched")[0]?.payload;
  assert.equal(ev?.["to"], "codex");
  assert.equal(ev?.["handoffTurns"], 3);
  assert.equal(h.named("agent.model_changed").length, 1);

  engine.receive({ threadId: THREAD, author: DANA, body: "after the switch" });
  await engine.idle(THREAD);
  assert.equal(p.sessions.at(-1)?.spec.agent.model, "gpt-5-codex");
  assert.deepEqual(assertEventsConform(h), []);
});

test("switch with nobody leading needs an agent; a paused Space refuses the switch", async () => {
  const h = harness({ threads: [THREAD_SPEC] });
  h.runtime({ openSession: scriptedProvider({ script: done }).openSession, schedule: NO_BEAT });
  await setMode(h.ctx, { threadId: THREAD, agentId: "agt_intake", mode: "listen" });
  const noLead = await switchEngine(h.ctx, { threadId: THREAD, driver: "grok", model: "grok-4" }).catch((e: unknown) => e);
  assert.equal(codeOf(noLead), "validation.precondition_failed");
  await handlers["engine.spend.pause_all"]?.(h.ctx as never, { reason: "month end" });
  const paused = await switchEngine(h.ctx, { threadId: THREAD, agentId: "agt_intake", driver: "grok", model: "grok-4" }).catch((e: unknown) => e);
  assert.equal(codeOf(paused), "permission.limit");
});

test("the handler table covers the control and account capabilities", () => {
  for (const name of ["engine.interrupt", "engine.stop", "engine.stop_all", "engine.set_mode", "engine.set_model", "engine.switch", "engine.probe_account", "engine.accounts.list", "engine.account.resolve"]) {
    assert.equal(typeof handlers[name], "function", name);
  }
});
