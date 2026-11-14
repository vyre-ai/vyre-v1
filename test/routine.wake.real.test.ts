// A routine on the real Wake table (P1 step 4): the REAL agents and scheduler-api modules and the real runs module, joined by calls, through save, the wake's own time, claim, fire and report. The unit tests of each
// module use a fake of the other; this one does not. It checks that a routine fires once at its stored time, that a first try that starts the Run and loses its answer is retried after the lease and finds the same
// Run (one Run, one event), that a reconcile between the two tries changes nothing, and that the wake and the routine row keep the same next time.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers as agentHandlers, periodic as agentPeriodic } from "../modules/agents/impl.ts";
import { NOW, harness as agentsHarness } from "../modules/agents/fixtures/harness.ts";
import { routineBy } from "../modules/agents/projections.ts";
import { harness as runsHarness } from "../modules/runs/fixtures/db.ts";
import { engine } from "../modules/runs/fixtures/seed.ts";
import { harness as schedHarness } from "../modules/scheduler-api/fixtures/db.ts";
import { host, MINUTE } from "../modules/scheduler-api/fixtures/seed.ts";
import { fireWakes, sweepFires, tickWakes } from "../modules/scheduler-api/impl.ts";

const svc = { kind: "service" as const, id: "svc_host" };
const h = agentHandlers as unknown as Record<string, (ctx: any, input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

function world(loseFirstAnswer: boolean) {
  const runs = runsHarness();
  const hn = agentsHarness();
  let lose = loseFirstAnswer;
  const sched = schedHarness({
    now: NOW,
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
    "scheduler.can_hold",
  ])
    hn.world.answer(cap, (input) => sched.call(cap, input, host));
  hn.world.answer("runs.start", (input) => runs.call("runs.start", input, engine));
  const advance = (ms: number): void => {
    hn.advance(ms);
    sched.setNow(hn.clock.t);
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
