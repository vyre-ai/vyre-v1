// AI spend (spec 3.10, 4.14): caps by Space, person and agent, pause-all, raise once or for good, usage, and the meter that stops a turn at its limit
// and puts a Needs you card "Raise once or Stop" in front of the person who pays. Real SQLite, fake provider, events checked against the frozen schema.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { capsSet, isPaused, pauseAll, raiseLimit, recordUsage, resumeAll, spendGet, usageQuery } from "../handlers/spend.ts";
import { ensure } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { gate, until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_intake";
const AGENT = "agt_intake";
const DANA = { kind: "person" as const, id: "usr_dana" };
const NO_BEAT = (): (() => void) => () => {};
const done: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "done" }];

/** A fake provider whose Nth session waits at its first event until release(N), so a turn stays running while the meter is called. */
function holding() {
  const gates: Array<ReturnType<typeof gate> | undefined> = [];
  const seen = new Map<object, number>();
  const provider = scriptedProvider({
    script: done,
    beforeEvent: async (i, _ev, spec) => {
      if (i !== 0) return;
      let n = seen.get(spec);
      if (n === undefined) { n = seen.size; seen.set(spec, n); }
      const g = gates[n] ?? (gates[n] = gate());
      await g.wait;
    },
  });
  return { provider, release(n: number) { (gates[n] ?? (gates[n] = gate())).open(); } };
}

async function start(h: Harness) {
  const hold = holding();
  const engine = h.runtime({ openSession: hold.provider.openSession, schedule: NO_BEAT });
  engine.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: [{ id: AGENT, mode: "lead", model: "claude-sonnet-5-5" }] });
  const next = async (): Promise<string> => {
    const before = engine.turns(THREAD).length;
    engine.receive({ threadId: THREAD, author: DANA, body: "go on" });
    await until(() => engine.turns(THREAD).length > before && engine.turns(THREAD)[before]?.state === "running");
    return engine.turns(THREAD)[before]?.id ?? "";
  };
  return { engine, hold, next };
}

const use = (h: Harness, turnId: string, costMicros: number) => recordUsage(h.ctx, { turnId, tokensIn: 100, tokensOut: 20, costMicros });

// ---- caps, pause

test("caps are saved per scope, read back with the day's use, and a person or agent cap cannot exceed the Space cap", () => {
  const h = harness();
  const set = capsSet(h.ctx, { scope: "space", caps: { dayMicros: 5_000_000, monthMicros: 50_000_000 } });
  assert.deepEqual(set, { caps: { dayMicros: 5_000_000, monthMicros: 50_000_000 } });
  assert.deepEqual(contractErrors("engine.spend.caps.set", "out", set), []);
  assert.deepEqual(h.named("spend.caps_changed")[0]?.payload, { scope: "space", by: "usr_dana" });

  const agent = capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { dayMicros: 1_000_000, turnsPerDay: 20 } });
  assert.deepEqual(agent.caps, { dayMicros: 1_000_000, turnsPerDay: 20 });
  assert.throws(() => capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { dayMicros: 9_000_000 } }), (e) => codeOf(e) === "validation.bad_input");
  assert.throws(() => capsSet(h.ctx, { scope: "agent", caps: { dayMicros: 1 } }), (e) => codeOf(e) === "validation.bad_input", "an agent cap names its agent");
  assert.throws(() => capsSet(h.ctx, { scope: "person", scopeId: "usr_sam", caps: { dayMicros: -1 } }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(capsSet(h.ctx, { scope: "person", caps: { dayMicros: 2_000_000 } }).caps, { dayMicros: 2_000_000 }, "a person cap without an id is the caller's");

  const got = spendGet(h.ctx, { scope: "agent", scopeId: AGENT });
  assert.deepEqual(got, { caps: { dayMicros: 1_000_000, turnsPerDay: 20 }, todayMicros: 0, monthMicros: 0, turnsToday: 0, paused: false });
  assert.deepEqual(contractErrors("engine.spend.get", "out", got), []);
  assert.deepEqual(spendGet(h.ctx, { scope: "person" }).caps, { dayMicros: 2_000_000 });
  assert.deepEqual(assertEventsConform(h), []);
});

test("pause-all pauses and resume-all resumes, with who and why", () => {
  const h = harness();
  assert.equal(isPaused(h.ctx), false);
  assert.deepEqual(pauseAll(h.ctx, { reason: "month end review" }), { paused: true });
  assert.equal(isPaused(h.ctx), true);
  const state = spendGet(h.ctx, { scope: "space" });
  assert.equal(state.paused, true);
  assert.equal(state.pausedBy, "usr_dana");
  assert.deepEqual(h.named("spend.paused")[0]?.payload, { by: "usr_dana", reason: "month end review" });
  assert.deepEqual(resumeAll(h.ctx, {}), { paused: false });
  assert.equal(isPaused(h.ctx), false);
  assert.equal(spendGet(h.ctx, { scope: "space" }).pausedBy, undefined);
  assert.equal(h.named("spend.resumed").length, 1);
  assert.deepEqual(assertEventsConform(h), []);
});

// ---- the meter

test("cap reached raises the Needs you card Raise once or Stop, stops the turn, and raising once lets work go on", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { dayMicros: 1000 } });
  const t1 = await next();

  assert.deepEqual(await use(h, t1, 600), {}, "under the cap nothing happens");
  assert.equal(h.calls("tasks.create").length, 0);
  assert.deepEqual(await use(h, t1, 500), { overLimit: "day" });
  await engine.idle(THREAD);
  assert.equal(engine.turns(THREAD)[0]?.state, "cancelled", "the turn that crossed the line was stopped");

  const card = h.calls("tasks.create")[0]?.input as Record<string, unknown>;
  assert.equal(h.calls("tasks.create").length, 1);
  assert.equal(card["kind"], "unblock");
  assert.equal(card["title"], "agt_intake hit its daily limit");
  assert.deepEqual(card["assigned"], { kind: "person", id: "usr_dana" }, "the card goes to the person who pays");
  assert.deepEqual((card["actions"] as Array<{ key: string; label: string }>).map((a) => a.label), ["Raise once", "Stop"]);
  assert.deepEqual(card["source"], { kind: "chat", id: THREAD });
  const limit = h.named("agent.limit_hit")[0]?.payload;
  assert.deepEqual(limit, { agentId: AGENT, threadId: THREAD, turnId: t1, limit: "day", used: 1100, cap: 1000, taskId: "tsk_card1" });
  assert.equal(spendGet(h.ctx, { scope: "agent", scopeId: AGENT }).todayMicros, 1100);

  // The turn keeps reporting while it winds down: one card only.
  assert.deepEqual(await use(h, t1, 10), { overLimit: "day" });
  assert.equal(h.calls("tasks.create").length, 1, "one card per scope, limit and day");

  // Raise once: the same size again for today. The card is closed, so the next hit opens a fresh one.
  assert.deepEqual(raiseLimit(h.ctx, { scope: "agent", scopeId: AGENT, limit: "day", mode: "once" }), { raised: true });
  assert.equal(h.rows("SELECT card_key FROM engine_limit_cards").length, 0);
  assert.equal(h.named("spend.raised")[0]?.payload["mode"], "once");
  hold.release(0);
  const t2 = await next();
  assert.deepEqual(await use(h, t2, 300), {}, "1410 of 2000: work goes on");
  assert.deepEqual(await use(h, t2, 700), { overLimit: "day" }, "2110 of 2000");
  assert.equal(h.calls("tasks.create").length, 2);
  assert.deepEqual(assertEventsConform(h), []);
  hold.release(1);
  await engine.idle(THREAD);
});

test("raise for good changes the cap: double by default, or the amount given", () => {
  const h = harness();
  capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { dayMicros: 1000, turnsPerDay: 4 } });
  raiseLimit(h.ctx, { scope: "agent", scopeId: AGENT, limit: "day", mode: "permanent" });
  assert.equal(spendGet(h.ctx, { scope: "agent", scopeId: AGENT }).caps.dayMicros, 2000);
  raiseLimit(h.ctx, { scope: "agent", scopeId: AGENT, limit: "turns", mode: "permanent", amountMicros: 10 });
  assert.equal(spendGet(h.ctx, { scope: "agent", scopeId: AGENT }).caps.turnsPerDay, 10);
  assert.throws(() => raiseLimit(h.ctx, { scope: "agent", scopeId: AGENT, limit: "month", mode: "permanent" }), (e) => codeOf(e) === "validation.precondition_failed", "no month cap to raise");
  assert.throws(() => raiseLimit(h.ctx, { scope: "agent", scopeId: AGENT, limit: "day", mode: "once", amountMicros: 0 }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(assertEventsConform(h), []);
});

test("the Space cap applies to everyone's work and says so on the card", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "space", caps: { monthMicros: 2000 } });
  const t1 = await next();
  assert.deepEqual(await use(h, t1, 2500), { overLimit: "month" });
  const card = h.calls("tasks.create")[0]?.input as Record<string, unknown>;
  assert.equal(card["title"], "The Space hit its monthly limit");
  const limit = h.named("agent.limit_hit")[0]?.payload;
  assert.equal(limit?.["limit"], "month");
  assert.equal(limit?.["cap"], 2000);
  assert.equal(spendGet(h.ctx, { scope: "space" }).monthMicros, 2500);
  assert.deepEqual(assertEventsConform(h), []);
  hold.release(0);
  await engine.idle(THREAD);
});

test("a person's own cap stops their turns, whichever agent runs them", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "person", scopeId: "usr_dana", caps: { dayMicros: 800 } });
  const t1 = await next();
  assert.deepEqual(await use(h, t1, 900), { overLimit: "day" });
  assert.equal((h.calls("tasks.create")[0]?.input as Record<string, unknown>)["title"], "You hit your daily limit");
  assert.equal(h.named("agent.limit_hit")[0]?.payload["agentId"], AGENT);
  hold.release(0);
  await engine.idle(THREAD);
});

test("a daily turn limit allows its count and stops the next turn", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { turnsPerDay: 1 } });
  const t1 = await next();
  assert.deepEqual(await use(h, t1, 5), {}, "the first turn of the day is within one");
  hold.release(0);
  await engine.idle(THREAD);
  const t2 = await next();
  assert.deepEqual(await use(h, t2, 5), { overLimit: "turns" });
  assert.equal(spendGet(h.ctx, { scope: "agent", scopeId: AGENT }).turnsToday, 2);
  hold.release(1);
  await engine.idle(THREAD);
});

test("a time limit per run counts minutes since the turn started", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { timeMinutesPerRun: 2 } });
  const t1 = await next();
  h.advance(60_000);
  assert.deepEqual(await use(h, t1, 1), {});
  h.advance(2 * 60_000);
  assert.deepEqual(await use(h, t1, 1), { overLimit: "time" });
  assert.equal(h.named("agent.limit_hit")[0]?.payload["used"], 3);
  hold.release(0);
  await engine.idle(THREAD);
});

test("when the tasks module is down the turn still stops and the hit is still recorded", async () => {
  const h = harness({ tasksFail: true });
  const { engine, hold, next } = await start(h);
  capsSet(h.ctx, { scope: "agent", scopeId: AGENT, caps: { run: 100 } });
  const t1 = await next();
  assert.deepEqual(await use(h, t1, 150), { overLimit: "run" });
  await engine.idle(THREAD);
  assert.equal(engine.turns(THREAD)[0]?.state, "cancelled");
  const limit = h.named("agent.limit_hit")[0]?.payload;
  assert.equal(limit?.["limit"], "run");
  assert.equal("taskId" in (limit ?? {}), false);
  assert.deepEqual(assertEventsConform(h), []);
  hold.release(0);
});

test("record_usage refuses a turn this host does not know and bad numbers", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  const t1 = await next();
  await assert.rejects(recordUsage(h.ctx, { turnId: "trn_nothere", tokensIn: 1, tokensOut: 1, costMicros: 1 }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(recordUsage(h.ctx, { turnId: t1, tokensIn: -1, tokensOut: 1, costMicros: 1 }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(await use(h, t1, 7), {}, "no caps set: metering only");
  assert.equal(spendGet(h.ctx, { scope: "space" }).todayMicros, 7);
  hold.release(0);
  await engine.idle(THREAD);
});

// ---- usage

test("usage groups by day, person, agent or model; a person without ai.spend sees only their own", () => {
  const h = harness();
  ensure(h.db);
  const DAY = 86_400_000;
  const put = (turn: string, agent: string, person: string, model: string, at: number, cost: number): void => {
    h.db.run("INSERT INTO engine_usage (turn_id, thread_id, agent_id, person_id, model, at, tokens_in, tokens_out, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", turn, THREAD, agent, person, model, at, 100, 10, cost);
  };
  put("trn_a", AGENT, "usr_dana", "claude-sonnet-5-5", 1_760_000_000_000, 500);
  put("trn_b", "agt_docs", "usr_dana", "gpt-5", 1_760_000_000_000 + 1000, 300);
  put("trn_c", AGENT, "usr_sam", "claude-sonnet-5-5", 1_760_000_000_000 + DAY, 200);

  const byAgent = usageQuery(h.ctx, { by: "agent" });
  assert.deepEqual(byAgent.rows.map((r) => [r.key, r.totals.turns, r.totals.costMicros]), [["agt_docs", 1, 300], ["agt_intake", 2, 700]]);
  assert.deepEqual(byAgent.totals, { turns: 3, tokensIn: 300, tokensOut: 30, costMicros: 1000 });
  assert.deepEqual(contractErrors("engine.usage.query", "out", byAgent), []);
  assert.deepEqual(usageQuery(h.ctx, { by: "day" }).rows.map((r) => [r.key, r.totals.costMicros]), [["2025-10-10", 200], ["2025-10-09", 800]]);
  assert.deepEqual(usageQuery(h.ctx, { by: "model" }).rows.map((r) => r.key), ["claude-sonnet-5-5", "gpt-5"]);
  assert.deepEqual(usageQuery(h.ctx, { by: "person", personId: "usr_sam" }).rows.map((r) => [r.key, r.totals.costMicros]), [["usr_sam", 200]]);
  assert.deepEqual(usageQuery(h.ctx, { by: "agent", from: 1_760_000_000_000 + DAY }).totals.costMicros, 200, "from limits the range");

  h.setManager(false);
  const mine = usageQuery(h.ctx, { by: "person" });
  assert.deepEqual(mine.rows.map((r) => [r.key, r.totals.costMicros]), [["usr_dana", 800]], "only my own");
  assert.deepEqual(usageQuery(h.ctx, { by: "person", personId: "usr_sam" }).rows.map((r) => r.key), ["usr_dana"], "asking for someone else still gives my own");
});

test("the handler table covers the spend capabilities", () => {
  for (const name of ["engine.spend.get", "engine.spend.caps.set", "engine.spend.pause_all", "engine.spend.resume_all", "engine.spend.raise", "engine.usage.query", "engine.turn.record_usage"]) {
    assert.equal(typeof handlers[name], "function", name);
  }
});


// ---- usage by Vault item (P-CC_36) ----

test("record_usage keeps the Vault item a turn ran on, usage.query filters by it, and a person still sees only their own turns", async () => {
  const h = harness();
  const { engine, hold, next } = await start(h);
  const t1 = await next();
  assert.deepEqual(await recordUsage(h.ctx, { turnId: t1, tokensIn: 10, tokensOut: 5, costMicros: 3, itemId: "vit_aaaaaaaaaaaa" }), {});
  assert.deepEqual(h.db.all("SELECT turn_id, item_id FROM engine_usage_item"), [{ turn_id: t1, item_id: "vit_aaaaaaaaaaaa" }]);
  await recordUsage(h.ctx, { turnId: t1, tokensIn: 1, tokensOut: 1, costMicros: 1, itemId: "vit_bbbbbbbbbbbb" });
  assert.deepEqual(h.db.all("SELECT item_id FROM engine_usage_item"), [{ item_id: "vit_aaaaaaaaaaaa" }], "the first key seen for a turn stays");
  h.db.run("INSERT INTO engine_usage (turn_id, thread_id, agent_id, person_id, model, at, tokens_in, tokens_out, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", "trn_other", THREAD, "agt_docs", "usr_sam", "gpt-5", 1_760_000_000_000, 7, 7, 1);
  const onKey = usageQuery(h.ctx, { by: "agent", itemId: "vit_aaaaaaaaaaaa" });
  assert.deepEqual(onKey.rows.map((r) => [r.key, r.totals.turns, r.totals.tokensIn + r.totals.tokensOut]), [[AGENT, 1, 17]], "only the turns on that key");
  assert.equal(usageQuery(h.ctx, { by: "agent", itemId: "vit_nokeyatall00" }).totals.turns, 0);
  assert.equal(usageQuery(h.ctx, { by: "agent" }).totals.turns, 2, "without the filter every turn counts");
  h.setManager(false);
  assert.deepEqual(usageQuery(h.ctx, { by: "person", itemId: "vit_aaaaaaaaaaaa" }).rows.map((r) => r.key).every((k) => k === h.ctx.principal.id), true, "a person sees only their own turns on the key");
  hold.release(0);
  await engine.idle(THREAD);
});
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
