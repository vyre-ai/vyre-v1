// agents: scheduled routines fire (owner report, rc.16: "Hi every minute" never ran; markRoutineRan had no caller). The periodic job agents.routines_due starts each due routine once, under its
// owner, with the key routine:<id>:<nextRunAt>; a second tick, or a restart that runs the same tick again, starts nothing more; after downtime a missed routine runs once, not once per missed time;
// a paused routine, a watcher and a paused agent's routine do not run. The job is periodic, so the host runs it only where the scheduled-work lease is held.
// @reads /modules/agents/migrations/0001_agents.sql
// @reads /modules/agents/migrations/0002_routine_watch.sql
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers, periodic } from "../impl.ts";
import { NOW, assertEventsConform, contractErrors, harness, openRaw } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const MIN = 60_000;
const svc = { kind: "service" as const, id: "svc_host" };

/** runs.start as the runs module answers it: one run per key, the same run for the same key. */
function runsWith(hn: Harness): { keys: string[]; runs: Map<string, string> } {
  const runs = new Map<string, string>();
  const keys: string[] = [];
  hn.world.answer("runs.start", (i: { idempotencyKey: string }) => {
    keys.push(i.idempotencyKey);
    if (!runs.has(i.idempotencyKey)) runs.set(i.idempotencyKey, `run_r${runs.size + 1}`);
    return { runId: runs.get(i.idempotencyKey)! };
  });
  return { keys, runs };
}
const tick = (hn: Harness): Promise<string[]> => periodic["agents.routines_due"].run(hn.as(svc));
async function withRoutine(hn: Harness, cron = "* * * * *", over: Record<string, unknown> = {}) {
  const agent = (await h["agents.create"]!(hn.ctx, { name: `Pinger${++n}`, role: "Says hi.", idempotencyKey: `c${n}` })).agent;
  const routine = (await h["agents.routine.save"]!(hn.ctx, { agentId: agent.agentId, title: "Hi every minute", cron, prompt: "Post Hi.", idempotencyKey: `r${n}`, ...over })).routine;
  hn.clear();
  return { agentId: agent.agentId as string, routine };
}

test("a due routine fires once, under its owner, and its next run moves on", async () => {
  const hn = harness();
  const runs = runsWith(hn);
  const { agentId, routine } = await withRoutine(hn);
  assert.equal(routine.nextRunAt, NOW - (NOW % MIN) + MIN, "due at the next minute");
  assert.deepEqual(await tick(hn), [], "not before its minute");
  hn.advance(MIN);
  assert.deepEqual(await tick(hn), ["run_r1"]);
  const started = hn.world.calls.filter((c) => c.cap === "runs.start");
  assert.equal(started.length, 1);
  assert.deepEqual(started[0]!.input, { idempotencyKey: `routine:${routine.routineId}:${routine.nextRunAt}`, kind: "routine", name: "Hi every minute", owner: routine.ownerId });
  assert.deepEqual(contractErrors("runs.start", "in", started[0]!.input), []);
  assert.deepEqual(hn.named("agent.routine_run_started").map((e) => e.payload), [{ agentId, routineId: routine.routineId, runId: "run_r1", ownerId: routine.ownerId, requestedBy: "schedule" }]);
  assert.deepEqual(assertEventsConform(hn), []);
  const after = (await h["agents.routines.list"]!(hn.ctx, { agentId })).routines[0];
  assert.deepEqual([after.lastRunAt, after.nextRunAt], [NOW + MIN, routine.nextRunAt + MIN]);
  assert.deepEqual(await tick(hn), [], "the same minute again starts nothing");
  hn.advance(MIN);
  assert.deepEqual(await tick(hn), ["run_r2"], "the next minute is its own run");
  assert.equal(runs.keys.length, 2);
});

test("a restart that runs the same tick again does not fire twice: the same minute is the same run", async () => {
  const raw = openRaw();
  const clock = { t: NOW };
  const first = harness({ raw, clock });
  const runs = runsWith(first);
  const { routine } = await withRoutine(first);
  clock.t += MIN;
  // the server stopped after the run started and before the routine was marked: its row still says the old time
  const key = `routine:${routine.routineId}:${routine.nextRunAt}`;
  first.world.handlers["runs.start"]!({ idempotencyKey: key }, { idempotencyKey: key });
  const second = harness({ raw, clock, files: first.world });
  assert.deepEqual(await tick(second), ["run_r1"], "the restarted server asks with the same key and gets the run that already started");
  assert.equal(runs.runs.size, 1, "one run for that minute");
  assert.deepEqual(await tick(second), [], "and it is marked now");
});

test("after downtime a missed routine runs once, now, never a burst; its next run counts from now", async () => {
  const hn = harness();
  runsWith(hn);
  const { agentId } = await withRoutine(hn);
  hn.advance(3 * 60 * MIN + 17_000);   // three hours off
  assert.deepEqual(await tick(hn), ["run_r1"], "one run for all the missed minutes");
  assert.deepEqual(await tick(hn), [], "no catching up");
  const r = (await h["agents.routines.list"]!(hn.ctx, { agentId })).routines[0];
  assert.equal(r.nextRunAt, hn.clock.t - (hn.clock.t % MIN) + MIN, "the next minute from now");
});

test("a paused routine, a watcher and a paused agent's routine do not fire", async () => {
  const hn = harness();
  const runs = runsWith(hn);
  await withRoutine(hn, "* * * * *", { enabled: false });
  await withRoutine(hn, undefined as unknown as string, { cron: undefined, kind: "watch", watch: { on: "message", channelId: "chn_leads" } });
  const paused = await withRoutine(hn);
  hn.db.run("UPDATE agents_agent SET paused = 1 WHERE id = ?", paused.agentId);
  hn.advance(2 * MIN);
  assert.deepEqual(await tick(hn), []);
  assert.equal(runs.keys.length, 0, "nothing started");
  const r = (await h["agents.routines.list"]!(hn.ctx, { agentId: paused.agentId })).routines[0];
  assert.ok(r.nextRunAt > hn.clock.t, "the paused agent's routine waits for its next time instead of piling up");
});

test("a routine an agent saved for its person says so (setBy): the panel reads it through the one credit resolver; one the person saved has none", async () => {
  const hn = harness();
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Helper", role: "Sets routines.", idempotencyKey: `c${++n}` })).agent;
  const viaAgent = hn.as({ kind: "agent", id: agent.agentId }, hn.ctx.principal.id);
  const set = (await h["agents.routine.save"]!(viaAgent, { agentId: agent.agentId, title: "Hi every minute", cron: "* * * * *", prompt: "Post Hi.", idempotencyKey: `r${++n}` })).routine;
  assert.deepEqual(set.setBy, { kind: "agent", id: agent.agentId });
  assert.equal(set.ownerId, hn.ctx.principal.id, "it is still the person's routine");
  assert.deepEqual(contractErrors("agents.routine.save", "out", { routine: set }), []);
  const mine = (await h["agents.routine.save"]!(hn.ctx, { agentId: agent.agentId, routineId: set.routineId, title: "Hi every minute", cron: "* * * * *", prompt: "Post Hi.", idempotencyKey: `r${++n}` })).routine;
  assert.equal(mine.setBy, undefined, "saved again by the person by hand: they set it");
});

test("the routine's Last run follows its last run: running when it starts, then how it ended; an older run ending changes nothing", async () => {
  const hn = harness();
  runsWith(hn);
  const { agentId } = await withRoutine(hn);
  hn.advance(MIN);
  await tick(hn);
  const list = async () => (await h["agents.routines.list"]!(hn.ctx, { agentId })).routines[0];
  assert.deepEqual((await list()).lastRun, { runId: "run_r1", status: "running" });
  assert.deepEqual(contractErrors("agents.routines.list", "out", { routines: [await list()] }), []);
  const outcome = (name: string, runId: string) => (consumers["agents.routine_outcome"].run as (c: Harness["ctx"], e: unknown) => string[])(hn.as(svc), { name, payload: { runId } });
  assert.equal(outcome("run.succeeded", "run_r1").length, 1);
  assert.deepEqual((await list()).lastRun, { runId: "run_r1", status: "succeeded" });
  hn.advance(MIN);
  await tick(hn);
  assert.deepEqual((await list()).lastRun, { runId: "run_r2", status: "running" });
  assert.deepEqual(outcome("run.failed", "run_r1"), [], "an older run is not the routine's last");
  assert.deepEqual((await list()).lastRun!.status, "running");
  outcome("run.failed", "run_r2");
  assert.deepEqual((await list()).lastRun, { runId: "run_r2", status: "failed" });
});
