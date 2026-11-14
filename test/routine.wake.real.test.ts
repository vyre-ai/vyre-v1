// A routine on the real Wake table (P1 step 4): the REAL agents and scheduler-api modules and the real runs module, joined by calls, through save, the wake's own time, claim, fire and report. The unit tests of each
// module use a fake of the other; this one does not. It checks that a routine fires once at its stored time, that a first try that starts the Run and loses its answer is retried after the lease and finds the same
// Run (one Run, one event), that a reconcile between the two tries changes nothing, and that the wake and the routine row keep the same next time.
import test from "node:test";
import assert from "node:assert/strict";
import {
  consumers as agentConsumers,
  handlers as agentHandlers,
  periodic as agentPeriodic,
} from "../modules/agents/impl.ts";
import { NOW, harness as agentsHarness } from "../modules/agents/fixtures/harness.ts";
import { routineBy } from "../modules/agents/projections.ts";
import { noteRun, resumeSelfPaused } from "../modules/agents/routine-guard.ts";
import { nextRun } from "../modules/agents/projections.ts";
import { harness as runsHarness } from "../modules/runs/fixtures/db.ts";
import { engine } from "../modules/runs/fixtures/seed.ts";
import { harness as schedHarness } from "../modules/scheduler-api/fixtures/db.ts";
import { host, MINUTE } from "../modules/scheduler-api/fixtures/seed.ts";
import { fireWakes, sweepFires, tickWakes } from "../modules/scheduler-api/impl.ts";

const svc = { kind: "service" as const, id: "svc_host" };
const h = agentHandlers as unknown as Record<string, (ctx: any, input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

function world(loseFirstAnswer: boolean, skewMs = 0) {
  const runs = runsHarness();
  const hn = agentsHarness();
  let lose = loseFirstAnswer;
  const sched = schedHarness({
    now: NOW + skewMs,
    calls: {
      "agents.routine.fire": (i) =>
        h["agents.routine.fire"]!(hn.as(svc), i).then((r) => {
          if (lose && r.started) {
            lose = false;
            throw new Error("the answer was lost");
          }
          return r;
        }),
      "runs.states": (i) => runs.call("runs.states", i, engine),
    },
  });
  for (const cap of [
    "scheduler.schedule",
    "scheduler.reschedule",
    "scheduler.pause",
    "scheduler.resume",
    "scheduler.cancel",
    "scheduler.get",
    "scheduler.list",
    "scheduler.can_hold",
  ])
    hn.world.answer(cap, (input) => sched.call(cap, input, host));
  hn.world.answer("runs.start", (input) => runs.call("runs.start", input, engine));
  const advance = (ms: number): void => {
    hn.advance(ms);
    sched.setNow(hn.clock.t + skewMs);
  };
  const pass = async () => {
    await sched.consumer(host, async (ctx) => tickWakes(ctx));
    const fired = (await sched.consumer(host, async (ctx) => fireWakes(ctx))) as {
      started: number;
      skipped: number;
      failed: number;
    };
    await sched.consumer(host, async (ctx) => sweepFires(ctx));
    return fired;
  };
  const reconcile = () => agentPeriodic["agents.routines_wake_sync"].run(hn.as(svc));
  const runCount = (): number => (runs.db.all("SELECT COUNT(*) AS n FROM runs_items")[0] as { n: number }).n;
  return { hn, sched, advance, pass, reconcile, runCount };
}
async function saved(w: ReturnType<typeof world>) {
  const agentId = (await h["agents.create"]!(w.hn.ctx, { name: "Pinger", role: "Says hi.", idempotencyKey: "c1" }))
    .agent.agentId;
  return (
    await h["agents.routine.save"]!(w.hn.ctx, {
      agentId,
      title: "Digest",
      cron: "*/5 * * * *",
      prompt: "Say hi.",
      idempotencyKey: "r1",
    })
  ).routine;
}

test("a routine fires once at its time through the real wake table, and the wake and the row keep one next time", async () => {
  const w = world(false);
  const r = await saved(w);
  const due = routineBy(w.hn.db, r.routineId)!.nextRunAt!;
  const wake = w.sched.db.all("SELECT next_at FROM scheduler_api_schedules WHERE owner_id = ?", r.routineId)[0] as {
    next_at: number;
  };
  assert.equal(wake.next_at, due, "the wake and the row were made for the same time");
  w.advance(due - NOW + 30_000);
  assert.deepEqual(await w.pass(), { started: 1, skipped: 0, failed: 0 });
  assert.deepEqual(await w.pass(), { started: 0, skipped: 0, failed: 0 }, "a second pass starts nothing");
  assert.equal(w.runCount(), 1);
  const after = routineBy(w.hn.db, r.routineId)!;
  const next = w.sched.db.all("SELECT next_at FROM scheduler_api_schedules WHERE owner_id = ?", r.routineId)[0] as {
    next_at: number;
  };
  assert.equal(after.nextRunAt, next.next_at, "the mirror and the wake agree after the fire");
  assert.equal(w.hn.named("agent.routine_run_started").length, 1);
  const fire = w.sched.db.all("SELECT state, attempt FROM scheduler_api_fires")[0] as Record<string, unknown>;
  assert.deepEqual([fire["state"], fire["attempt"]], ["running", 1]);
});

test("a first try that starts the Run and loses its answer: a reconcile in between changes nothing, the retry after the lease finds the same Run, one Run and one event", async () => {
  const w = world(true);
  const r = await saved(w);
  const due = routineBy(w.hn.db, r.routineId)!.nextRunAt!;
  w.advance(due - NOW + 30_000);
  assert.equal((await w.pass()).failed, 1, "the first try: the Run started, the answer was lost");
  await w.reconcile();
  await w.reconcile();
  w.advance(3 * MINUTE);
  const retry = await w.pass();
  assert.equal(retry.started + retry.skipped, 1, "the retry after the lease is answered");
  assert.equal(w.runCount(), 1, "one Run for the time");
  assert.equal(w.hn.named("agent.routine_run_started").length, 1, "and told once");
});

test("a wake with no routine and no mapping (a crash between making the wake and writing its mapping, then a delete) ends at its first fire and never fires again", async () => {
  const w = world(false);
  const r = await saved(w);
  const due = routineBy(w.hn.db, r.routineId)!.nextRunAt!;
  w.hn.db.run("DELETE FROM agents_routine_wake WHERE routineId = ?", r.routineId);
  w.hn.db.run("DELETE FROM agents_routine WHERE id = ?", r.routineId);
  w.advance(due - NOW + 30_000);
  assert.deepEqual(await w.pass(), { started: 0, skipped: 1, failed: 0 }, "the one fire finds nothing");
  const wake = w.sched.db.all("SELECT canceled_at FROM scheduler_api_schedules WHERE owner_id = ?", r.routineId)[0] as {
    canceled_at: number | null;
  };
  assert.ok(wake.canceled_at, "and the wake is cancelled");
  w.advance(30 * MINUTE);
  assert.deepEqual(await w.pass(), { started: 0, skipped: 0, failed: 0 }, "nothing fires again");
  assert.equal(w.runCount(), 0);
});

/** An every-minute routine, 20 minutes, a pass every minute at the same second: how many Runs started and how many fires were skipped. */
// the two modules read the clock a moment apart (a pass, a call, a restart in between): the test makes that moment long, so a time the row works out for itself cannot match the wake's
const SKEW = 25_000;
async function twentyMinutes(
  w: ReturnType<typeof world>,
  offsetSeconds: number,
): Promise<{ runs: number; skipped: number }> {
  for (let i = 0; i < 20; i++) {
    w.advance(MINUTE);
    await w.pass();
    if (i % 2 === 1) await w.reconcile(); // the 30-second net runs meanwhile
  }
  void offsetSeconds;
  const skipped = (
    w.sched.db.all("SELECT COUNT(*) AS n FROM scheduler_api_fires WHERE state = 'skipped'")[0] as { n: number }
  ).n;
  return { runs: w.runCount(), skipped };
}
async function everyMinute(w: ReturnType<typeof world>) {
  const agentId = (await h["agents.create"]!(w.hn.ctx, { name: "Pinger", role: "Says hi.", idempotencyKey: "c1" }))
    .agent.agentId;
  return (
    await h["agents.routine.save"]!(w.hn.ctx, {
      agentId,
      title: "Every minute",
      cron: "* * * * *",
      prompt: "Say hi.",
      idempotencyKey: "r1",
    })
  ).routine;
}

for (const second of [0, 10, 20, 30, 40, 50, 59]) {
  test(`resumed at second ${second} of a minute, an every-minute routine starts 20 Runs in 20 minutes and no fire is skipped`, async () => {
    const w = world(false, SKEW);
    const r = await everyMinute(w);
    for (let i = 0; i < 3; i++) noteRun(w.hn.db, r.routineId, false, "provider.rate_limited", "limit", w.hn.clock.t); // it pauses itself
    await w.reconcile(); // the wake is paused with the row
    w.advance(5 * MINUTE + (second - (new Date(w.hn.clock.t).getUTCSeconds() % 60)) * 1000);
    assert.equal(Math.floor(w.hn.clock.t / 1000) % 60, second);
    await agentConsumers["agents.routine_resume"]!.run(w.hn.as(svc), { name: "vault.item_updated", payload: {} });
    const before = w.runCount();
    const out = await twentyMinutes(w, second);
    assert.deepEqual([out.runs - before, out.skipped], [20, 0]);
  });
}

for (const second of [0, 5, 30, 59]) {
  test(`saved at second ${second} of a minute, an every-minute routine starts 20 Runs in 20 minutes and no fire is skipped`, async () => {
    const w = world(false, SKEW);
    w.advance(second * 1000 - (Math.floor(w.hn.clock.t / 1000) % 60) * 1000);
    assert.equal(Math.floor(w.hn.clock.t / 1000) % 60, second);
    await everyMinute(w);
    const out = await twentyMinutes(w, second);
    assert.deepEqual([out.runs, out.skipped], [20, 0]);
  });
}

for (const [name, shift] of [
  ["behind the wake", -MINUTE],
  ["a long way behind the wake", -7 * MINUTE],
] as const) {
  test(`a routine edited by rc.27 after a rollback, its row ${name}, still starts 20 Runs in 20 minutes on roll-forward and no fire is skipped`, async () => {
    const w = world(false, SKEW);
    const r = await everyMinute(w);
    const wakeAt = (
      w.sched.db.all("SELECT next_at FROM scheduler_api_schedules WHERE owner_id = ?", r.routineId)[0] as {
        next_at: number;
      }
    ).next_at;
    // rc.27 edits the row with its own clock and does not know the wake: the row's time is no longer the wake's
    w.hn.db.run(
      "UPDATE agents_routine SET nextRunAt = ?, title = 'Edited under rc.27' WHERE id = ?",
      wakeAt + shift,
      r.routineId,
    );
    await w.reconcile();
    const out = await twentyMinutes(w, 0);
    assert.deepEqual([out.runs, out.skipped], [20, 0]);
  });
}

test("a routine whose row is AHEAD of its wake (rc.27 started that time): the fire for the earlier time is skipped once, the next time starts, and nothing is started twice", async () => {
  const w = world(false, SKEW);
  const r = await everyMinute(w);
  const wakeAt = (
    w.sched.db.all("SELECT next_at FROM scheduler_api_schedules WHERE owner_id = ?", r.routineId)[0] as {
      next_at: number;
    }
  ).next_at;
  w.hn.db.run("UPDATE agents_routine SET nextRunAt = ? WHERE id = ?", wakeAt + MINUTE, r.routineId);
  const out = await twentyMinutes(w, 0);
  assert.equal(out.skipped, 1);
  assert.equal(out.runs, 19);
  assert.equal(w.hn.named("agent.routine_run_started").length, 19, "told once per Run");
});

for (const second of [10, 30, 45, 59]) {
  test(`equal clocks: the row resumed at second ${second} and the wake resumed by the reconcile 25 s later (the gap r-clock found) skips no fire`, async () => {
    const w = world(false, 0);
    const r = await everyMinute(w);
    for (let i = 0; i < 3; i++) noteRun(w.hn.db, r.routineId, false, "provider.rate_limited", "limit", w.hn.clock.t);
    await w.reconcile(); // wake paused with the row
    w.advance(5 * MINUTE + (second - (Math.floor(w.hn.clock.t / 1000) % 60)) * 1000);
    // the row comes back on its own, with its own time; the wake is resumed only by the next reconcile
    resumeSelfPaused(w.hn.db, w.hn.clock.t, nextRun);
    w.advance(25_000);
    await w.reconcile();
    const out = await twentyMinutes(w, second);
    assert.equal(out.skipped, 0);
    assert.ok(out.runs >= 19, `${out.runs} Runs`);
  });
}
