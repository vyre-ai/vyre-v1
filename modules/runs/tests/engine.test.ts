// The run engine (spec 2.13, ARCH 4.7, 7.7): the durable step log, resume after a crash, idempotency by run:step:attempt, retries with backoff, waits, key fallback,
// stop at a safe point, the step cap and sandboxes (test mode, replay).
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, engine, newRun, MINUTE, HOUR } from "../fixtures/seed.ts";
import { backoffMs, drive, interrupted, recoverRuns } from "../handlers/engine.ts";
import type { Executor, PlanStep, RetryPolicy, StepCall, StepResult } from "../handlers/engine.ts";
import { allSteps, latestSteps, readExtra, readWait } from "../projections.ts";

const step = (id: string, over: Partial<PlanStep> = {}): PlanStep => ({ id, ...over });
const EXP: RetryPolicy = { max: 2, backoff: "exp", baseMs: 1000 };
const errorOf = (code: string, message = code, retryable = true): Error => Object.assign(new Error(message), { error: { code, message, retryable } });

async function started(h: Harness, over: Record<string, unknown> = {}): Promise<string> {
  return (await h.call("runs.start", newRun(over), engine)).runId as string;
}
const runOf = async (h: Harness, id: string): Promise<any> => (await h.call("runs.get", { runId: id }, engine)).run;   // eslint-disable-line @typescript-eslint/no-explicit-any
const names = (h: Harness): string[] => h.allEvents.map((e) => e.name);
const states = (h: Harness, id: string): string[] => allSteps(h.db, id).map((s) => `${s.step}#${s.attempt}:${s.state}`);
const sleepBy = (h: Harness, log: number[] = []) => async (ms: number): Promise<void> => { log.push(ms); h.advance(ms); };
/** Stand in for tasks.create and keep what it was asked to make. */
const tasksCreate = (h: Harness): { made: any[] } => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const made: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("tasks.create", (input) => { made.push(input); return { task: { id: `tsk_n${made.length}` } }; });
  return { made };
};

test("a plan runs to the end, each result reaches the next step, every attempt is in the step log", async () => {
  const h = harness();
  const id = await started(h);
  const seen: unknown[] = [];
  const exec: Executor = async (s, c) => { seen.push(c.outputs); return { output: { from: s.id } }; };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("a"), step("b"), step("c")], exec));
  assert.deepEqual(r, { status: "succeeded" });
  assert.deepEqual(seen, [{}, { a: { from: "a" } }, { a: { from: "a" }, b: { from: "b" } }]);
  assert.deepEqual(states(h, id), ["a#1:succeeded", "b#1:succeeded", "c#1:succeeded"]);
  const run = await runOf(h, id);
  assert.equal(run.status, "succeeded");
  assert.equal(run.summary, "3 steps done");
  assert.deepEqual(names(h), ["run.started", "run.succeeded"]);
  const rows = (await h.call("runs.steps", { runId: id }, engine)).steps;
  assert.deepEqual(rows.map((s: { step: string }) => s.step), ["a", "b", "c"]);
  assert.equal(rows[0].outputRef, `out:${id}:a:1`);
  assert.equal(rows[0].inputRef, `in:${id}:a:1`);
});

test("crash recovery: a Run that died mid-step resumes at that step and runs nothing twice", async () => {
  const h = harness();
  const id = await started(h);
  const ran: string[] = [];
  let entered!: () => void;
  const inB = new Promise<void>((res) => { entered = res; });
  // the first process: step a finishes, step b starts and the process dies (the promise never settles)
  const dying: Executor = async (s) => {
    ran.push(`${s.id}`);
    if (s.id === "b") { entered(); await new Promise<never>(() => undefined); }
    return { output: s.id };
  };
  void h.engineRun(engine, (ctx) => drive(ctx, id, [step("a"), step("b"), step("c")], dying));
  await inB;
  assert.deepEqual(states(h, id), ["a#1:succeeded", "b#1:running"]);
  assert.deepEqual(interrupted(h.db), [id]);

  // the next process: recoverRuns finds the Run and drives it from its log
  const calls: StepCall[] = [];
  const again: Executor = async (s, c) => { ran.push(`${s.id}*`); calls.push(c); return { output: `${s.id}2` }; };
  const out = await h.engineRun(engine, (ctx) => recoverRuns(ctx, () => ({ plan: [step("a"), step("b"), step("c")], exec: again })));
  assert.deepEqual(out, { [id]: { status: "succeeded" } });
  assert.deepEqual(ran, ["a", "b", "b*", "c*"], "a is not run again; b runs again; c runs once");
  assert.equal(calls[0]!.attempt, 1, "the recovered attempt is the same attempt");
  assert.equal(calls[0]!.key, `${id}:b:1`, "and carries the same idempotency key");
  assert.equal(calls[0]!.resumed, true);
  assert.deepEqual(calls[0]!.outputs, { a: "a" }, "the result of a comes from the log");
  assert.deepEqual(states(h, id), ["a#1:succeeded", "b#1:succeeded", "c#1:succeeded"]);
  assert.deepEqual(interrupted(h.db), []);
});

test("steps are idempotent by run:step:attempt: a retry is a new attempt with a new key, a replayed attempt keeps its key", async () => {
  const h = harness();
  const id = await started(h);
  const keys: string[] = [];
  let fails = 1;
  const exec: Executor = async (_s, c) => { keys.push(c.key); if (fails-- > 0) throw errorOf("provider.network"); return { output: c.key }; };
  await h.engineRun(engine, (ctx) => drive(ctx, id, [step("send", { retry: { max: 1, backoff: "none", baseMs: 0 } })], exec));
  assert.deepEqual(keys, [`${id}:send:1`, `${id}:send:2`]);
  assert.deepEqual(states(h, id), ["send#1:failed", "send#2:succeeded"]);
  // driving a finished Run again does nothing
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("send")], exec));
  assert.deepEqual(r, { status: "succeeded" });
  assert.equal(keys.length, 2);
  // the row for the same attempt is one row: writing it twice through the capability is a no-op
  await h.call("runs.record_step", { runId: id, step: "send", attempt: 2, state: "succeeded", outputRef: `out:${id}:send:2`, inputRef: `in:${id}:send:2` }, engine);
  assert.equal(allSteps(h.db, id).filter((s) => s.step === "send" && s.attempt === 2).length, 1);
});

test("retries back off: the delay grows, the wait is kept in the log, a Run that gives up fails and lands in Needs you", async () => {
  assert.equal(backoffMs({ max: 3, backoff: "none", baseMs: 500 }, 2), 0);
  assert.equal(backoffMs({ max: 3, backoff: "linear", baseMs: 500 }, 3), 1500);
  assert.equal(backoffMs(EXP, 1), 1000);
  assert.equal(backoffMs(EXP, 2), 2000);
  assert.equal(backoffMs(EXP, 3), 4000);
  assert.equal(backoffMs({ max: 20, backoff: "exp", baseMs: 60_000 }, 12), HOUR, "the delay stops at an hour");

  const h = harness();
  const { made } = tasksCreate(h);
  const id = await started(h);
  const slept: number[] = [];
  let n = 0;
  const exec: Executor = async () => { n += 1; throw errorOf("provider.overloaded", "The model is busy."); };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("ask", { retry: EXP }), step("after")], exec, { sleep: sleepBy(h, slept) }));
  assert.deepEqual(r, { status: "failed", failedStep: "ask" });
  assert.equal(n, 3, "one try and two retries");
  assert.deepEqual(slept, [1000, 2000]);
  assert.deepEqual(states(h, id), ["ask#1:failed", "ask#2:failed", "ask#3:failed"]);
  const failed = h.allEvents.find((e) => e.name === "run.failed")!;
  assert.equal(failed.payload.step, "ask");
  assert.equal(failed.payload.code, "provider.overloaded");
  assert.equal(failed.payload.owner, alice.id);
  assert.equal(made.length, 1, "the owner gets one Unblock task");
  assert.equal(made[0].kind, "unblock");
  assert.deepEqual(made[0].assigned, { kind: "person", id: alice.id });
  assert.deepEqual(made[0].source, { kind: "run", id });
});

test("without a sleeper, drive returns when the next attempt is due and the scheduler calls it again", async () => {
  const h = harness();
  const id = await started(h);
  let n = 0;
  const exec: Executor = async () => { n += 1; if (n < 2) throw errorOf("provider.network"); return {}; };
  const plan = [step("s", { retry: { max: 1, backoff: "linear", baseMs: 5 * MINUTE } })];
  const first = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.equal(first.status, "running");
  assert.equal(first.retryAt, h.now() + 5 * MINUTE);
  const early = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.equal(early.status, "running");
  assert.equal(n, 1, "not before its time");
  h.advance(5 * MINUTE);
  const done = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.equal(done.status, "succeeded");
  assert.equal(n, 2);
});

test("an error that cannot succeed on a retry fails the step at once", async () => {
  const h = harness();
  tasksCreate(h);
  const id = await started(h);
  let n = 0;
  const exec: Executor = async () => { n += 1; throw errorOf("permission.no_grant", "No access.", false); };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("x", { retry: { max: 5, backoff: "none", baseMs: 0 } })], exec));
  assert.equal(r.status, "failed");
  assert.equal(n, 1);
  assert.equal(readExtra(h.db, id).errorCode, "permission.no_grant");
});

test("stop is read before every step: the step in flight finishes, the next one never starts", async () => {
  const h = harness();
  const id = await started(h);
  const ran: string[] = [];
  const exec: Executor = async (s) => {
    ran.push(s.id);
    if (s.id === "a") await h.call("runs.stop", { runId: id, reason: "wrong list" }, alice);
    return { output: s.id };
  };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("a"), step("b")], exec));
  assert.deepEqual(r, { status: "stopped" });
  assert.deepEqual(ran, ["a"]);
  assert.equal((await runOf(h, id)).status, "stopped");
});

test("a step can park the Run: it waits, then continues the same attempt when resumed", async () => {
  const h = harness();
  const id = await started(h);
  const seen: boolean[] = [];
  const exec: Executor = async (s, c): Promise<StepResult> => {
    seen.push(c.resumed);
    if (s.id === "ok" && !c.resumed) return { wait: { reason: "approval", taskId: "tsk_gate1" } };
    return { output: s.id };
  };
  const plan = [step("draft"), step("ok"), step("send")];
  const first = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.deepEqual(first, { status: "waiting" });
  const run = await runOf(h, id);
  assert.equal(run.status, "waiting");
  assert.equal(run.waitReason, "approval");
  assert.equal(readWait(h.db, id)?.taskId, "tsk_gate1");
  assert.deepEqual(states(h, id), ["draft#1:succeeded", "ok#1:waiting"]);
  const again = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.deepEqual(again, { status: "waiting" }, "a waiting Run is not driven");

  await h.call("runs.resume", { runId: id, reason: "approval" }, engine);
  const last = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec));
  assert.deepEqual(last, { status: "succeeded" });
  assert.deepEqual(states(h, id), ["draft#1:succeeded", "ok#1:succeeded", "send#1:succeeded"]);
  assert.deepEqual(seen, [false, false, true, false], "ok continued as the same attempt");
  assert.deepEqual(names(h).filter((n) => n.startsWith("run.")), ["run.started", "run.waiting", "run.resumed", "run.succeeded"]);
});

test("a lost key falls to the backup key once; with none, the Run waits in Needs you and never fails silently", async () => {
  const h = harness();
  const { made } = tasksCreate(h);
  const id = await started(h, { keyUsed: "key_main" });
  const used: string[] = [];
  let lost = true;
  const exec: Executor = async (_s, c) => { used.push(`${c.attempt}`); if (lost) { lost = false; throw errorOf("provider.auth_failed", "The key was refused.", false); } return { output: "ok" }; };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("ai")], exec, { backupKey: "key_backup" }));
  assert.equal(r.status, "succeeded");
  const fb = h.allEvents.find((e) => e.name === "run.key_fallback")!;
  assert.equal(fb.payload.fromKey, "key_main");
  assert.equal(fb.payload.toKey, "key_backup");
  assert.equal((await runOf(h, id)).keyUsed, "key_backup");
  assert.deepEqual(used, ["1", "2"]);
  assert.equal(made.length, 0);

  const h2 = harness();
  const t2 = tasksCreate(h2);
  const id2 = await started(h2);
  const exec2: Executor = async () => { throw errorOf("provider.auth_failed", "The key was refused.", false); };
  const w = await h2.engineRun(engine, (ctx) => drive(ctx, id2, [step("ai")], exec2));
  assert.deepEqual(w, { status: "waiting" });
  const run = await runOf(h2, id2);
  assert.equal(run.status, "waiting");
  assert.equal(run.waitReason, "key");
  assert.equal(t2.made.length, 1);
  assert.equal(t2.made[0].kind, "unblock");
  assert.deepEqual(t2.made[0].assigned, { kind: "person", id: alice.id });
  assert.equal(readWait(h2.db, id2)?.taskId, "tsk_n1");
});

test("branches: a step names the next one, and a resumed Run follows the stored path", async () => {
  const h = harness();
  const id = await started(h);
  const ran: string[] = [];
  const exec: Executor = async (s) => { ran.push(s.id); return s.id === "check" ? { next: "big" } : s.id === "big" ? { next: null } : {}; };
  const plan = [step("check"), step("small"), step("big"), step("tail")];
  assert.equal((await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec))).status, "succeeded");
  assert.deepEqual(ran, ["check", "big"], "small was skipped and big ended the Run");
  assert.deepEqual(latestSteps(h.db, id).map((s) => s.step), ["check", "big"]);
});

test("a loop that never ends hits the step cap and fails the Run", async () => {
  const h = harness();
  tasksCreate(h);
  const id = await started(h);
  let n = 0;
  // each pass enters the step again as s#2, s#3, ... so every pass has its own rows
  const exec: Executor = async () => { n += 1; return { next: `s#${n + 1}` }; };
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("s")], exec, { maxSteps: 6 }));
  assert.equal(r.status, "failed");
  assert.equal(n, 6);
  assert.equal(readExtra(h.db, id).errorCode, "run.step_cap");
  assert.deepEqual(latestSteps(h.db, id).map((s) => s.step), ["s", "s#2", "s#3", "s#4", "s#5", "s#6"]);
});

test("a step that points back at a step already done is a cycle, not a loop", async () => {
  const h = harness();
  tasksCreate(h);
  const id = await started(h);
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("a"), step("b")], async (s) => ({ next: s.id === "a" ? "b" : "a" })));
  assert.equal(r.status, "failed");
  assert.equal(readExtra(h.db, id).errorCode, "run.cycle");
});

test("a plan that names a step it does not have fails the Run with a clear error", async () => {
  const h = harness();
  tasksCreate(h);
  const id = await started(h);
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, [step("a")], async () => ({ next: "zzz" })));
  assert.equal(r.status, "failed");
  assert.equal(readExtra(h.db, id).errorCode, "run.unknown_step");
});

test("test mode records outward steps from their sample and never runs them; reads and writes still run", async () => {
  const h = harness();
  const calls = tasksCreate(h);
  const id = await started(h, { kind: "automation_test" });
  const ran: string[] = [];
  const exec: Executor = async (s, c) => { ran.push(`${s.id}:${c.sandbox}`); return { output: s.id }; };
  const plan = [step("read", { effects: "read" }), step("write", { effects: "write" }), step("mail", { effects: "outward", sample: { sent: "sample" } })];
  assert.equal((await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec))).status, "succeeded");
  assert.deepEqual(ran, ["read:true", "write:true"]);
  assert.equal(allSteps(h.db, id)[2]!.outputJson, JSON.stringify({ sent: "sample" }));
  assert.equal(calls.made.length, 0);
});

test("replay re-runs a past Run in the sandbox: writes and outward steps come from what the original recorded", async () => {
  const h = harness();
  const orig = await started(h);
  const real: Executor = async (s) => ({ output: { real: s.id } });
  const plan = [step("find", { effects: "read" }), step("update", { effects: "write" }), step("mail", { effects: "outward", sample: "sample" })];
  await h.engineRun(engine, (ctx) => drive(ctx, orig, plan, real));
  const rep = (await h.call("runs.replay", { runId: orig, version: "same" }, engine)).runId as string;
  const ran: string[] = [];
  const exec: Executor = async (s) => { ran.push(s.id); return { output: { replayed: s.id } }; };
  assert.equal((await h.engineRun(engine, (ctx) => drive(ctx, rep, plan, exec))).status, "succeeded");
  assert.deepEqual(ran, ["find"], "only the read ran");
  const rows = allSteps(h.db, rep);
  assert.equal(rows[1]!.outputJson, JSON.stringify({ real: "update" }));
  assert.equal(rows[2]!.outputJson, JSON.stringify({ real: "mail" }));
});

test("drive refuses nothing for a Run that already finished and reports its status", async () => {
  const h = harness();
  const id = await started(h);
  await h.call("runs.finish", { runId: id, status: "succeeded" }, engine);
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, [step("a")], async () => ({}))), { status: "succeeded" });
  await assert.rejects(h.engineRun(engine, (ctx) => drive(ctx, "run_missing", [step("a")], async () => ({}))), (e) => codeOf(e) === "permission.not_found");
});
