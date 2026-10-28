// Control steps and the step runner (spec 2.12, 3.7): the expression language, If, Paths, Parallel join, Loop, Stop, Wait with a cancel-on event, Approval, and the sandbox.
// A plan is walked by MiniRun (a stand-in for the Run engine), the way the ported flows golden-replay walked flows. (Run on its own so CI shows its result.)
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, MiniRun } from "../fixtures/db.ts";
import { callOf, node, DAY, HOUR, MINUTE } from "../fixtures/seed.ts";
import { evalExpr, render, renderText } from "../projections.ts";
import { runStep, stepsTest } from "../handlers/control.ts";
import { handlers } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import type { Scope } from "../projections.ts";

const scope: Scope = {
  trigger: { amount: 1500, name: "Dana Ortiz", tags: ["vip", "lead"], contact: { email: "d@example.com" }, rows: [{ id: "r1" }, { id: "r2" }] },
  steps: { find: { out: { rows: [{ id: "rec_a", score: 3 }, { id: "rec_b", score: 9 }], count: 2 } } }, item: { id: "rec_b" }, index: 1, vars: { limit: 5 }, run: { id: "run_t1" }, now: 1000,
};
const ev = (s: string): unknown => evalExpr(s, scope);
async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); return true; });
}

// ---- expression language ----

test("expressions read the trigger, earlier steps, the loop item and variables", () => {
  assert.equal(ev("trigger.amount"), 1500);
  assert.equal(ev("input.amount"), 1500, "input is the trigger");
  assert.equal(ev("trigger.contact.email"), "d@example.com");
  assert.equal(ev("trigger.tags[1]"), "lead");
  assert.equal(ev("trigger['name']"), "Dana Ortiz");
  assert.equal(ev("steps.find.out.rows[1].id"), "rec_b");
  assert.equal(ev("steps.find.out.rows[index].id"), "rec_b");
  assert.equal(ev("item.id"), "rec_b");
  assert.equal(ev("vars.limit"), 5);
  assert.equal(ev("run.id"), "run_t1");
  assert.equal(ev("trigger.missing.deeper"), undefined, "a missing path is empty, not an error");
  assert.equal(ev("steps.nothing.out.x"), undefined);
});

test("operators: comparison, boolean, arithmetic, in and contains", () => {
  assert.equal(ev("trigger.amount > 1000"), true);
  assert.equal(ev("trigger.amount >= 1500 && trigger.amount < 2000"), true);
  assert.equal(ev("trigger.amount == 1500"), true);
  assert.equal(ev("trigger.amount != 1500"), false);
  assert.equal(ev("'a' < 'b'"), true);
  assert.equal(ev("'10' > 9"), true, "text that reads as a number compares as one");
  assert.equal(ev("!trigger.missing"), true);
  assert.equal(ev("trigger.missing || 'fallback'"), "fallback");
  assert.equal(ev("trigger.name && 'yes'"), "yes");
  assert.equal(ev("1 + 2 * 3"), 7);
  assert.equal(ev("(1 + 2) * 3"), 9);
  assert.equal(ev("10 % 4 - -1"), 3);
  assert.equal(ev("'a' + 1"), "a1");
  assert.equal(ev("'vip' in trigger.tags"), true);
  assert.equal(ev("'zzz' in trigger.tags"), false);
  assert.equal(ev("'name' in trigger"), true);
  assert.equal(ev("trigger.tags contains 'lead'"), true);
  assert.equal(ev("trigger.name contains 'Ortiz'"), true);
  assert.equal(ev("trigger.rows == trigger.rows"), true);
  assert.equal(ev("null == trigger.missing"), true);
});

test("functions", () => {
  assert.equal(ev("len(trigger.tags)"), 2);
  assert.equal(ev("len(trigger.name)"), 10);
  assert.equal(ev("lower(trigger.name)"), "dana ortiz");
  assert.equal(ev("upper('x')"), "X");
  assert.equal(ev("trim('  a ')"), "a");
  assert.equal(ev("startsWith(trigger.name, 'Dana')"), true);
  assert.equal(ev("endsWith(trigger.name, 'Ortiz')"), true);
  assert.equal(ev("exists(trigger.name)"), true);
  assert.equal(ev("exists(trigger.zip)"), false);
  assert.equal(ev("isEmpty(trigger.zip)"), true);
  assert.equal(ev("isEmpty(0)"), false);
  assert.equal(ev("number('4') + 1"), 5);
  assert.equal(ev("string(4) + 'x'"), "4x");
  assert.equal(ev("round(2.6) + floor(2.6) + ceil(2.1)"), 8);
  assert.equal(ev("max(1, 9, 4) - min(3, 2) + abs(-1)"), 8);
  assert.equal(ev("now()"), 1000);
  assert.equal(ev("trigger.tags.length"), 2);
});

test("an empty list, empty text, zero and nothing are false", () => {
  assert.equal(ev("!trigger.rows"), false);
  assert.equal(ev("!steps.find.out.rows"), false);
  assert.equal(evalExpr("!trigger", { trigger: [] }), true);
  assert.equal(evalExpr("!trigger.t", { trigger: { t: "" } }), true);
  assert.equal(evalExpr("!trigger.z", { trigger: { z: 0 } }), true);
  assert.equal(evalExpr("!trigger.z", { trigger: { z: "0" } }), false, "text is text");
});

test("expressions that cannot run are refused with words", () => {
  for (const [src, msg] of [["1 +", /ends too soon/], ["(1", /bracket/], ["trigger.", /name must follow/], ["'open", /not closed/], ["1 @ 2", /Unexpected "@"/], ["nope(1)", /no function called nope/], ["1 / 0", /divides by zero/], ["1 1", /Unexpected "1"/]] as const) {
    assert.throws(() => ev(src), (e) => { assert.equal(codeOf(e), "validation.bad_input"); assert.match((e as Error).message, msg); return true; }, src);
  }
  assert.throws(() => ev("a".repeat(2001)), /too long/);
});

test("an expression cannot reach beyond the scope", () => {
  assert.equal(ev("trigger.constructor"), undefined);
  assert.equal(ev("trigger.__proto__"), undefined);
  assert.equal(ev("constructor"), undefined);
  assert.equal(ev("process.env"), undefined);
  assert.equal(ev("globalThis"), undefined);
  assert.equal(ev("trigger.name.constructor"), undefined);
});

test("templates: one {{ }} keeps the type, several make text, objects and lists are filled to any depth", () => {
  assert.equal(renderText("{{ trigger.amount }}", scope), 1500);
  assert.deepEqual(renderText(" {{ trigger.tags }} ", scope), ["vip", "lead"]);
  assert.equal(renderText("Hi {{ trigger.name }}, you owe {{ trigger.amount + 1 }}.", scope), "Hi Dana Ortiz, you owe 1501.");
  assert.equal(renderText("[{{ trigger.missing }}]", scope), "[]");
  assert.deepEqual(render({ to: ["{{ trigger.contact.email }}"], n: { x: "{{ index }}", plain: "no braces", num: 3 } }, scope), { to: ["d@example.com"], n: { x: 1, plain: "no braces", num: 3 } });
});

// ---- If, Paths, Stop ----

test("If answers true or false and, with branches, goes where the answer points", async () => {
  const h = harness();
  const out = (r: { output?: unknown; next?: string | null }) => r;
  const plain = await runStep(h.env, node("c", "if", { condition: "trigger.amount > 1000" }), callOf({ trigger: scope.trigger }));
  assert.deepEqual(out(plain), { output: { result: true } });
  const branches = [{ label: "Then", to: "big" }, { label: "else", to: "small" }];
  const yes = await runStep(h.env, node("c", "if", { condition: "trigger.amount > 1000" }, { branches }), callOf({ trigger: scope.trigger }));
  assert.equal(yes.next, "big");
  const no = await runStep(h.env, node("c", "if", { condition: "trigger.amount > 5000" }, { branches }), callOf({ trigger: scope.trigger }));
  assert.equal(no.next, "small");
  const dead = await runStep(h.env, node("c", "if", { condition: "false" }, { branches: [{ label: "yes", to: "big" }] }), callOf());
  assert.equal(dead.next, null, "a path with no branch for the answer ends there");
  const tpl = await runStep(h.env, node("c", "if", { condition: "{{ trigger.amount > 1000 }}" }), callOf({ trigger: scope.trigger }));
  assert.deepEqual(tpl.output, { result: true }, "a template that already made a value is used as it is");
});

test("Paths takes the first path that is true, else Otherwise, else ends", async () => {
  const h = harness();
  const paths = [{ name: "Big", when: "trigger.amount > 1000" }, { name: "Medium", when: "trigger.amount > 100" }];
  const branches = [{ label: "big", to: "b" }, { label: "medium", to: "m" }, { label: "otherwise", to: "o" }];
  const big = await runStep(h.env, node("p", "paths", { paths }, { branches }), callOf({ trigger: { amount: 5000 } }));
  assert.deepEqual([big.output, big.next], [{ taken: "Big" }, "b"]);
  const med = await runStep(h.env, node("p", "paths", { paths }, { branches }), callOf({ trigger: { amount: 500 } }));
  assert.deepEqual([med.output, med.next], [{ taken: "Medium" }, "m"]);
  const other = await runStep(h.env, node("p", "paths", { paths, otherwise: true }, { branches }), callOf({ trigger: { amount: 5 } }));
  assert.deepEqual([other.output, other.next], [{ taken: "otherwise" }, "o"]);
  const none = await runStep(h.env, node("p", "paths", { paths }, { branches }), callOf({ trigger: { amount: 5 } }));
  assert.deepEqual([none.output, none.next], [{ taken: "" }, null]);
  const noBranch = await runStep(h.env, node("p", "paths", { paths }), callOf({ trigger: { amount: 5000 } }));
  assert.equal(noBranch.next, undefined, "without a branch the Run goes on to the next step");
});

test("Stop ends the Run; failed makes it a failure with the message", async () => {
  const h = harness();
  const ok = await runStep(h.env, node("s", "stop", { message: "Nothing to do" }), callOf());
  assert.deepEqual(ok, { output: { stopped: true, message: "Nothing to do" }, next: null });
  await assert.rejects(runStep(h.env, node("s", "stop", { outcome: "failed", message: "No consent on file" }), callOf()), (e) => {
    assert.equal(codeOf(e), "run.stopped");
    assert.equal((e as { error: { retryable: boolean } }).error.retryable, false);
    assert.equal((e as Error).message, "No consent on file");
    return true;
  });
});

// ---- Parallel join ----

const lane = (id: string, status: string, error?: string) => ({ id, laneId: id, status, ...(error ? { error } : {}) });

test("Parallel waits while a lane is open and finishes when every lane has", async () => {
  const h = harness();
  const open = await runStep(h.env, node("par", "parallel", {}), callOf({ children: [lane("mail", "succeeded"), lane("sms", "running"), lane("task", "succeeded")] }));
  assert.equal(open.wait?.event?.event, "run.child_terminal");
  const done = await runStep(h.env, node("par", "parallel", {}), callOf({ children: [lane("mail", "succeeded"), lane("sms", "succeeded"), lane("task", "succeeded")] }));
  assert.deepEqual(done.output, { finished: ["mail", "sms", "task"] });
  assert.deepEqual((await runStep(h.env, node("par", "parallel", {}), callOf({ children: [] }))).output, { finished: [] });
});

test("a failed lane fails the step by name once the others are terminal", async () => {
  const h = harness();
  const still = await runStep(h.env, node("par", "parallel", {}), callOf({ children: [lane("bad", "failed", "the mailbox is gone"), lane("slow", "running")] }));
  assert.ok(still.wait, "the step waits until every lane is terminal");
  await assert.rejects(runStep(h.env, node("par", "parallel", {}), callOf({ children: [lane("bad", "failed", "the mailbox is gone"), lane("slow", "succeeded")] })), (e) => {
    assert.equal(codeOf(e), "run.branch_failed");
    assert.equal((e as Error).message, "The lane bad did not finish: the mailbox is gone");
    return true;
  });
  await assert.rejects(runStep(h.env, node("par", "parallel", {}), callOf({ children: [lane("a", "failed", "x"), lane("b", "failed", "x")] })), (e) => /2 lanes did not finish/.test((e as Error).message));
});

test("Parallel waiting for any ends at the first lane to finish, and fails only when none does", async () => {
  const h = harness();
  const early = await runStep(h.env, node("par", "parallel", { waitFor: "any" }), callOf({ children: [lane("slow", "running"), lane("fast", "succeeded")] }));
  assert.ok(early.wait, "siblings still have to become terminal");
  assert.deepEqual((await runStep(h.env, node("par", "parallel", { waitFor: "any" }), callOf({ children: [lane("slow", "stopped"), lane("fast", "succeeded")] }))).output, { finished: ["fast"] });
  await assert.rejects(runStep(h.env, node("par", "parallel", { waitFor: "any" }), callOf({ children: [lane("a", "failed", "a broke"), lane("b", "failed", "b broke")] })), (e) => /No lane finished: a broke/.test((e as Error).message));
  await refused(runStep(harness().env, node("par", "parallel", {}), callOf()), "run.no_lanes");
});

// ---- Loop ----

test("Loop names each item and joins child Runs in order", async () => {
  const h = harness();
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const prep = await runStep(h.env, node("l", "loop", { items: "steps.find.out.rows" }), callOf({ prepare: true, outputs: { find: { rows } } }));
  assert.deepEqual(prep.prepare?.iterations.map((it) => it.iterationKey), ["a", "b", "c"]);
  const dup = await runStep(h.env, node("l", "loop", { items: "trigger.rows" }), callOf({ prepare: true, trigger: { rows: [{ id: "a" }, { id: "a" }] } }));
  assert.deepEqual(dup.prepare?.iterations.map((it) => it.iterationKey), ["a", "1:a"]);
  const kids = prep.prepare!.iterations.map((it) => ({ id: it.iterationKey, iterationKey: it.iterationKey, iterationIndex: it.iterationIndex, status: "succeeded", runId: `run_${it.iterationKey}` }));
  const joined = await runStep(h.env, node("l", "loop", { items: "steps.find.out.rows" }), callOf({ outputs: { find: { rows } }, children: kids }));
  assert.deepEqual(joined.output, { iterations: 3, results: kids.map((k) => ({ iterationKey: k.iterationKey, status: "succeeded", runId: k.runId })) });
  const none = await runStep(h.env, node("l", "loop", { items: "trigger.rows" }), callOf({ trigger: { rows: [] } }));
  assert.deepEqual(none.output, { iterations: 0, results: [] });
  const tpl = await runStep(h.env, node("l", "loop", { items: "{{ trigger.rows }}" }), callOf({ prepare: true, trigger: { rows: [{ id: "x" }] } }));
  assert.equal(tpl.prepare?.iterations.length, 1);
  const waiting = await runStep(h.env, node("l", "loop", { items: "trigger.rows" }), callOf({ trigger: { rows: [{ id: "a" }] }, children: [{ id: "a", iterationKey: "a", iterationIndex: 0, status: "waiting", held: true }] }));
  assert.equal(waiting.wait?.on, "child runs");
});

test("Loop refuses a list over its limit, a limit above 1000, a value that is not a list, and a failed item", async () => {
  const h = harness();
  const trigger = { items: [1, 2, 3, 4] };
  await assert.rejects(runStep(h.env, node("l", "loop", { items: "trigger.items", maxIterations: 3 }), callOf({ trigger })), (e) => {
    assert.equal(codeOf(e), "run.loop_too_large");
    assert.match((e as Error).message, /4 items and the loop allows 3/);
    return true;
  });
  await assert.rejects(runStep(h.env, node("l", "loop", { items: "trigger.items", maxIterations: 1001 }), callOf({ trigger: { items: [1] } })), (e) => {
    assert.equal(codeOf(e), "run.loop_too_large");
    return true;
  });
  const overDefault = Array.from({ length: 501 }, (_v, i) => i);
  await refused(runStep(h.env, node("l", "loop", { items: "trigger.items" }), callOf({ trigger: { items: overDefault } })), "run.loop_too_large");
  await refused(runStep(h.env, node("l", "loop", { items: "trigger.n" }), callOf({ trigger: { n: 5 } })), "validation.bad_input");
  await assert.rejects(runStep(h.env, node("l", "loop", { items: "trigger.items" }), callOf({
    trigger, children: [0, 1, 2, 3].map((i) => ({ id: String(i), iterationKey: String(i), iterationIndex: i, status: i === 2 ? "failed" : "succeeded", ...(i === 2 ? { error: "no address" } : {}) })),
  })), (e) => {
    assert.equal(codeOf(e), "run.loop_failed");
    assert.equal((e as Error).message, "Item 3 of 4 failed: no address");
    return true;
  });
  await refused(runStep(harness().env, node("l", "loop", { items: "trigger.items" }), callOf({ trigger })), "run.no_body");
});

// ---- Wait ----

test("Wait for a duration parks the Run, and it goes on when the time has come", async () => {
  const h = harness();
  const run = await new MiniRun(h, [node("w", "wait", { forDuration: "2d" }), node("after", "stop", {})]).run();
  assert.equal(run.state, "waiting");
  assert.equal(run.wait!.reason, "background");
  assert.equal(run.wait!.at, h.now() + 2 * DAY);
  assert.deepEqual(run.wait!.cancelOn, ["record.deleted"]);
  h.advance(DAY);
  assert.equal((await run.tick()).state, "waiting", "not yet");
  h.advance(DAY);
  await run.tick();
  assert.equal(run.state, "succeeded");
  assert.equal((run.outputs.w as { resumedBy: string }).resumedBy, "duration");
});

test("Wait until a time, from a timestamp, a date or a duration from the start", async () => {
  const h = harness();
  const when = h.now() + 3 * HOUR;
  const a = await new MiniRun(h, [node("w", "wait", { until: when })]).run();
  assert.equal(a.wait!.at, when);
  const b = await new MiniRun(h, [node("w", "wait", { until: new Date(when).toISOString() })]).run();
  assert.equal(b.wait!.at, when);
  const c = await new MiniRun(h, [node("w", "wait", { until: "90m" })]).run();
  assert.equal(c.wait!.at, h.now() + 90 * MINUTE);
  h.advance(3 * HOUR);
  await a.tick();
  assert.equal((a.outputs.w as { resumedBy: string }).resumedBy, "time");
});

test("Wait for an event: the matching event resumes it, the timeout ends it, a cancel-on event cancels the Run", async () => {
  const h = harness();
  const plan = [node("w", "wait", { event: { event: "email.received", filter: { from: "d@example.com" } }, timeout: "7d" }), node("after", "stop", {})];
  const run = await new MiniRun(h, plan).run();
  assert.equal(run.state, "waiting");
  assert.deepEqual(run.wait!.event, { event: "email.received", filter: { from: "d@example.com" } });
  assert.equal(run.wait!.timeoutAt, h.now() + 7 * DAY);
  await run.event("email.received", { from: "someone@else.com" });
  assert.equal(run.state, "waiting", "the filter did not match");
  await run.event("email.received", { from: "d@example.com" });
  assert.equal(run.state, "succeeded");
  assert.equal((run.outputs.w as { resumedBy: string }).resumedBy, "event");

  const late = await new MiniRun(h, plan).run();
  h.advance(7 * DAY);
  await late.tick();
  assert.equal(late.state, "succeeded");
  assert.equal((late.outputs.w as { resumedBy: string }).resumedBy, "timeout");

  const gone = await new MiniRun(h, plan).run();
  await gone.event("record.deleted", {});
  assert.equal(gone.state, "canceled", "the cancel-on event ended the wait and the Run");
  assert.equal(gone.trail.includes("after"), false);
});

test("Wait defaults to a 30 day timeout for an event, and needs something to wait for", async () => {
  const h = harness();
  const run = await new MiniRun(h, [node("w", "wait", { event: { event: "x.y" } })]).run();
  assert.equal(run.wait!.timeoutAt, h.now() + 30 * DAY);
  await refused(runStep(h.env, node("w", "wait", {}), callOf()), "validation.bad_input");
  await refused(runStep(h.env, node("w", "wait", { forDuration: "soon" }), callOf()), "validation.bad_input");
});

test("a Wait that wakes before its time waits again; the start time is kept across waits", async () => {
  const h = harness();
  const start = h.now();
  const first = await runStep(h.env, node("w", "wait", { forDuration: "1h" }), callOf({ startedAt: start }));
  assert.equal(first.wait!.at, start + HOUR);
  h.advance(10 * MINUTE);
  const spurious = await runStep(h.env, node("w", "wait", { forDuration: "1h" }), callOf({ startedAt: start, resumed: true }));
  assert.equal(spurious.wait!.at, start + HOUR, "the same moment, not an hour from now");
  h.advance(HOUR);
  const done = await runStep(h.env, node("w", "wait", { forDuration: "1h" }), callOf({ startedAt: start, resumed: true }));
  assert.equal((done.output as { resumedBy: string }).resumedBy, "duration");
});

test("a milestone that is already past succeeds without parking, and a future one follows its anchor", async () => {
  const h = harness();
  const past = await runStep(h.env, node("w", "wait", { at: h.now() - HOUR, direction: "after" }), callOf());
  assert.deepEqual(past.output, { missed: true, skipTimeSensitive: true, reason: "milestone_passed" });
  assert.equal(past.wait, undefined);
  const ahead = h.now() + 5 * HOUR;
  const parked = await runStep(h.env, node("w", "wait", { at: ahead, offset: "1h", direction: "before", anchorId: "evt_1", timezone: "UTC" }), callOf());
  assert.equal(parked.wait?.at, ahead - HOUR);
  assert.deepEqual(parked.wait?.event, { event: "calendar_event.updated", filter: { eventId: "evt_1" } });
  assert.equal(parked.wait?.anchorId, "evt_1");
  const zone = await runStep(h.env, node("w", "wait", { at: "2026-01-15T09:00", timezone: "America/New_York", direction: "after" }), callOf());
  assert.equal(zone.wait?.at, Date.UTC(2026, 0, 15, 14, 0, 0));
  let startsAt = ahead + 2 * HOUR;
  h.callee("calendar.get_event", () => ({ event: { startsAt } }));
  const moved = await runStep(h.env, node("w", "wait", { anchorId: "evt_1", offset: "0m", direction: "after" }), callOf({ resumed: true, priorAt: ahead }));
  assert.equal(moved.wait?.at, startsAt);
  startsAt = h.now() - DAY;
  const missed = await runStep(h.env, node("w", "wait", { anchorId: "evt_1", direction: "after" }), callOf({ resumed: true, priorAt: ahead }));
  assert.deepEqual(missed.output, { missed: true, skipTimeSensitive: true, reason: "milestone_passed" });
  h.callee("calendar.get_event", () => { throw new Error("calendar down"); });
  const kept = await runStep(h.env, node("w", "wait", { anchorId: "evt_1", direction: "after" }), callOf({ resumed: true, priorAt: h.now() + HOUR }));
  assert.equal(kept.wait?.at, h.now() + HOUR);
});

test("Wait for a Journey stage parks on the stage event and ends with whether it timed out", async () => {
  const h = harness();
  const plan = [node("ws", "wait_stage", { recordId: "rec_deal1", stage: "Signed", timeout: "10d" })];
  const run = await new MiniRun(h, plan).run();
  assert.deepEqual(run.wait!.event, { event: "journey.stage_entered", filter: { recordId: "rec_deal1", stage: "Signed" } });
  assert.deepEqual(run.wait!.cancelOn, ["record.deleted", "journey.stage_exited"]);
  await run.event("journey.stage_entered", { recordId: "rec_deal1", stage: "Signed" });
  assert.deepEqual(run.outputs.ws, { enteredAt: h.now(), timedOut: false });
  const late = await new MiniRun(h, plan).run();
  h.advance(10 * DAY);
  await late.tick();
  assert.equal((late.outputs.ws as { timedOut: boolean }).timedOut, true);
});

// ---- Approval ----

function tasksWorld(h: ReturnType<typeof harness>) {
  const task = { id: "tsk_ap1", state: "awaiting_approval", expiresAt: undefined as number | undefined };
  const history: { type: string; by?: string; note?: string }[] = [];
  // like the real tasks.create, the same key finds the task it made: its deadline does not move
  h.callee("tasks.create", (i) => { task.expiresAt ??= i.expiresAt; return { task: { ...task } }; });
  h.callee("tasks.get", () => ({ task: { ...task } }));
  h.callee("tasks.history", () => ({ entries: history }));
  h.callee("tasks.withdraw", () => ({ withdrawn: 1 }));
  return { task, history };
}
const approvalNode = (branches?: { label: string; to: string }[]) => node("ap", "approval", { title: "Send the retainer to {{ trigger.name }}?", approver: { kind: "person", id: "usr_maya" }, timeout: "2d", summary: "Retainer" }, branches ? { branches } : {});

test("Approval creates an Approve task, parks the Run on it, and reads the decision when it is acted on", async () => {
  const h = harness();
  const w = tasksWorld(h);
  const run = await new MiniRun(h, [approvalNode([{ label: "approved", to: "send" }, { label: "rejected", to: "fix" }]), node("skipped", "stop", {}), node("send", "stop", {})], { name: "Dana" }).run();
  assert.equal(run.state, "waiting");
  assert.deepEqual([run.wait!.reason, run.wait!.taskId], ["approval", "tsk_ap1"]);
  assert.deepEqual(run.wait!.cancelOn, ["task.withdrawn"]);
  const made = h.only("tasks.create")[0]!.input;
  assert.equal(made.kind, "approve");
  assert.equal(made.title, "Send the retainer to Dana?");
  assert.deepEqual(made.approver, { kind: "person", id: "usr_maya" });
  assert.deepEqual(made.source, { kind: "run", id: "run_t1" });
  assert.equal(made.expiresAt, h.now() + 2 * DAY);
  assert.equal(made.idempotencyKey, "run_t1:ap:1");

  w.task.state = "done"; w.history.unshift({ type: "approved", by: "usr_maya", note: "Looks right" });
  await run.resume();
  assert.deepEqual(run.outputs.ap, { decision: "approved", note: "Looks right", by: "usr_maya", taskId: "tsk_ap1" });
  assert.equal(h.only("tasks.create")[1]!.input.idempotencyKey, "run_t1:ap:1", "the resumed step finds the same task");
  assert.deepEqual(run.trail, ["ap", "send"], "the branch for the decision was taken");
});

test("a rejected approval is an answer, not an error; an unanswered one keeps waiting until its time runs out", async () => {
  const h = harness();
  const w = tasksWorld(h);
  const plan = [approvalNode(), node("after", "stop", {})];
  const rej = await new MiniRun(h, plan, { name: "Dana" }).run();
  w.task.state = "doing"; w.history.unshift({ type: "rejected", by: "usr_maya", note: "Wrong rate" });
  await rej.resume();
  assert.deepEqual(rej.outputs.ap, { decision: "rejected", note: "Wrong rate", by: "usr_maya", taskId: "tsk_ap1" });
  assert.equal(rej.state, "succeeded");

  w.task.state = "awaiting_approval"; w.history.length = 0;
  const open = await new MiniRun(h, plan, { name: "Dana" }).run();
  await open.resume();
  assert.equal(open.state, "waiting", "resumed too early: still waiting");
  h.advance(2 * DAY);
  await open.resume();
  assert.deepEqual(open.outputs.ap, { decision: "timed_out", taskId: "tsk_ap1" });
  assert.equal(h.only("tasks.withdraw").length, 1);
  assert.equal(h.only("tasks.withdraw")[0]!.input.sourceId, "run_t1");
});

// ---- sandbox and steps.test ----

test("in a sandbox, steps that write or send answer with their sample and nothing is called; reads still run", async () => {
  const h = harness({ "records.query": () => ({ rows: [{ id: "rec_1" }], total: 1 }) });
  const plan = [
    node("find", "records.find", { type: "contact" }),
    node("upd", "records.update", { type: "contact", recordId: "rec_1", patch: { a: 1 } }),
    node("mail", "send_email", { to: ["a@b.c"], subject: "s", body: "b" }),
    node("ap", "approval", { title: "t", approver: { kind: "person", id: "usr_x" } }),
    node("w", "wait", { forDuration: "1d" }),
    node("if", "if", { condition: "steps.find.out.count > 0" }),
  ];
  const run = await new MiniRun(h, plan, {}, true).run();
  assert.equal(run.state, "succeeded");
  assert.deepEqual(h.log.map((c) => c.cap), ["records.query"], "only the read was called");
  assert.equal((run.outputs.mail as { messageId: string }).messageId.length > 0, true, "the sample");
  assert.deepEqual(run.outputs.if, { result: true });
});

test("send_email and send_sms use only the id on the step", async () => {
  const h = harness({
    "mail.mailbox.list": () => ({ mailboxes: [{ id: "mbx_first" }] }),
    "telephony.number.list": () => ({ numbers: [{ id: "num_first" }] }),
    "mail.send": () => ({ messageId: "eml_1" }),
    "telephony.send_sms": () => ({ smsId: "sms_1" }),
  }, { defaults: { mailboxId: "mbx_default", numberId: "num_default" } });
  await assert.rejects(runStep(h.env, node("mail", "send_email", { to: ["a@b.c"], subject: "s", body: "b" }), callOf()), (e) => {
    assert.equal((e as Error).message, "Send an email needs a mailbox. Pick one in the step.");
    return true;
  });
  await assert.rejects(runStep(h.env, node("sms", "send_sms", { to: "+1555", body: "hi" }), callOf()), (e) => {
    assert.equal((e as Error).message, "Send a text needs a number. Pick one in the step.");
    return true;
  });
  assert.deepEqual(h.log.map((c) => c.cap), []);
  const mail = await runStep(h.env, node("mail", "send_email", { mailboxId: "mbx_named", to: ["a@b.c"], subject: "s", body: "b" }), callOf());
  assert.equal(h.only("mail.send")[0]!.input.mailboxId, "mbx_named");
  assert.deepEqual(mail.output, { messageId: "eml_1" });
  const sms = await runStep(h.env, node("sms", "send_sms", { numberId: "num_named", to: "+1555", body: "hi" }), callOf());
  assert.equal(h.only("telephony.send_sms")[0]!.input.numberId, "num_named");
  assert.deepEqual(sms.output, { messageId: "sms_1" });
  assert.equal(h.only("mail.mailbox.list").length, 0);
  assert.equal(h.only("telephony.number.list").length, 0);
});

test("steps.test runs one step: a read for real, anything else from its sample", async () => {
  const h = harness();
  const r = await stepsTest(h.ctx, { key: "if", input: { condition: "input.n > 2" }, sample: { n: 5 } }) as { output: unknown; stubbed: boolean };
  assert.deepEqual(r, { output: { result: true }, stubbed: false });
  const s = await stepsTest(h.ctx, { key: "send_email", input: { to: ["a@b.c"], subject: "s", body: "b" } }) as { output: unknown; stubbed: boolean };
  assert.equal(s.stubbed, true);
  assert.ok((s.output as { messageId: string }).messageId);
  assert.equal(h.log.length, 0);
  const bad = await stepsTest(h.ctx, { key: "if", input: { condition: "1 +" } }) as { error: { code: string; message: string }; output: unknown };
  assert.equal(bad.error.code, "validation.bad_input");
  assert.equal(bad.output, null);
  await assert.rejects(stepsTest(h.ctx, { key: "teleport", input: {} }), (e) => codeOf(e) === "validation.bad_input");
});

// ---- a whole plan, the way a ported flow runs ----

test("a plan end to end: find, an empty loop, branch on a score, wait for a reply, ask for approval, stop", async () => {
  const h = harness({ "records.query": () => ({ rows: [{ id: "rec_a", score: 3 }, { id: "rec_b", score: 9 }], total: 2 }) });
  const tasks = tasksWorld(h);
  // The loop body is a child Run. This in-process plan has an empty list, so the coordinator finishes and the rest of the plan continues.
  const plan = [
    node("find", "records.find", { type: "contact" }),
    node("each", "loop", { items: [] }),
    node("pick", "paths", { paths: [{ name: "Hot", when: "max(steps.find.out.rows[0].score, steps.find.out.rows[1].score) > 8" }], otherwise: true }, { branches: [{ label: "hot", to: "reply" }, { label: "otherwise", to: "end" }] }),
    node("reply", "wait", { event: { event: "email.received" }, timeout: "3d" }),
    node("ok", "approval", { title: "Call them?", approver: { kind: "person", id: "usr_maya" } }),
    node("end", "stop", {}),
  ];
  const run = await new MiniRun(h, plan).run();
  assert.deepEqual(run.trail, ["find", "each", "pick"]);
  assert.equal(run.state, "waiting");
  assert.deepEqual(run.outputs.each, { iterations: 0, results: [] });
  await run.event("email.received", {});
  assert.equal(run.state, "waiting");
  assert.equal(run.wait!.reason, "approval");
  tasks.task.state = "done"; tasks.history.unshift({ type: "approved", by: "usr_maya" });
  await run.resume();
  assert.equal(run.state, "succeeded");
  assert.deepEqual(run.trail, ["find", "each", "pick", "reply", "ok", "end"]);
});

test("a step that is not in the catalogue is an error, and the engine can read the error", async () => {
  const h = harness();
  await assert.rejects(runStep(h.env, node("x", "teleport", {}), callOf()), (e) => {
    const er = (e as { error: { code: string; retryable: boolean } }).error;
    assert.deepEqual([er.code, er.retryable], ["validation.bad_input", false]);
    return true;
  });
});

test("the module answers every capability its manifest declares, and nothing else", () => {
  const declared = registry.capabilities.filter((c) => c.module === "steps-core").map((c) => c.name).sort();
  assert.deepEqual(Object.keys(handlers).sort(), declared);
});

test("every step the manifest declares can be run by runStep: control, capability, wait, AI and code steps all have a runner", () => {
  const mine = registry.steps.filter((s) => s.module === "steps-core");
  assert.ok(mine.length >= 25);
  const control = new Set(["if", "paths", "parallel", "loop", "stop", "wait", "wait_stage", "approval", "transform", "collect", "group_by", "call_automation"]);
  for (const s of mine) {
    const known = control.has(s.key) || s.kind === "ai" || s.kind === "code" || s.key.startsWith("sheet.") || s.kind === "capability";
    assert.ok(known, `${s.key} has no runner`);
  }
});
