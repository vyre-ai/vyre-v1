// The sweep that closes a fire stuck in running, against the REAL runs module (not a stub that answers what the real one does not): a Run that was erased answers `permission.not_found` to the host, a finished one
// answers its status, a live one answers running. The sweep asks as the host service, which sees every Run, so for it (and only it) not found means gone.
import test from "node:test";
import assert from "node:assert/strict";
import { harness as runsHarness } from "../modules/runs/fixtures/db.ts";
import { newRun, engine } from "../modules/runs/fixtures/seed.ts";
import { harness as schedHarness } from "../modules/scheduler-api/fixtures/db.ts";
import { alice, host } from "../modules/scheduler-api/fixtures/seed.ts";
import { sweepFires, tickWakes } from "../modules/scheduler-api/impl.ts";
import { fireIdOf } from "../modules/scheduler-api/projections.ts";

const AGENT = `agt_${"a".repeat(32)}`;

test("a purged Run closes its fire, a finished one closes it done, a live one leaves it open: asked of the real runs module as the host", async () => {
  const runs = runsHarness();
  const live = (await runs.call("runs.start", newRun({ name: "live" }), engine)).runId as string;
  const finished = (await runs.call("runs.start", newRun({ name: "finished" }), engine)).runId as string;
  await runs.call("runs.finish", { runId: finished, status: "succeeded" }, engine);
  const erased = (await runs.call("runs.start", newRun({ name: "erased" }), engine)).runId as string;
  await runs.call("runs.finish", { runId: erased, status: "succeeded" }, engine);
  await runs.call("runs.erase", { runId: erased, idempotencyKey: "erase-1" }, engine);
  // what the real module says to the host about a Run that is gone
  const gone = await runs
    .call("runs.get", { runId: erased }, host)
    .catch((e: { error?: { code?: string } }) => e.error?.code);
  assert.equal(gone, "permission.not_found");

  const h = schedHarness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: { "runs.states": (i, who) => runs.call("runs.states", i, who) },
  });
  const ids: Record<string, string> = {};
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  const pairs = [
    ["live", live],
    ["finished", finished],
    ["erased", erased],
  ] as const;
  for (const [name] of pairs) {
    const made = await h.call(
      "scheduler.schedule",
      {
        owner: { kind: "agent_routine", id: `rtn_${name}` },
        cap: "agents.routine.fire",
        input: {},
        when: { cron: "*/5 * * * *", tz: "UTC" },
        kind: "routine",
        person: alice.id,
        agentId: AGENT,
      },
      host,
    );
    ids[name] = made.scheduleId;
  }
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  for (const [name, run] of pairs) {
    const c = await h.call("scheduler.claim", { scheduleId: ids[name], dueKey: key, host: "h" }, host);
    await h.call(
      "scheduler.report",
      { fireId: fireIdOf(ids[name]!, key), attempt: c.attempt, state: "running", runId: run },
      host,
    );
  }
  const stateOf = (name: string) =>
    (h.db.all("SELECT state FROM scheduler_api_fires WHERE schedule_id = ?", ids[name]!)[0] as { state: string }).state;
  const out = await h.consumer(host, async (ctx) => sweepFires(ctx));
  assert.equal(out.closed, 2);
  assert.deepEqual(["live", "finished", "erased"].map(stateOf), ["running", "done", "failed"]);
});

test("a caller that is not the host never closes a fire by a not-found: it may simply not see the Run", async () => {
  const h = schedHarness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: {
      "runs.states": () => {
        throw Object.assign(new Error("not available"), { error: { code: "permission.not_found" } });
      },
    },
  });
  const made = await h.call(
    "scheduler.schedule",
    {
      owner: { kind: "agent_routine", id: "rtn_x" },
      cap: "agents.routine.fire",
      input: {},
      when: { cron: "*/5 * * * *", tz: "UTC" },
      kind: "routine",
      person: alice.id,
      agentId: AGENT,
    },
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  const key = String(Date.UTC(2026, 0, 5, 9, 5));
  const c = await h.call("scheduler.claim", { scheduleId: made.scheduleId, dueKey: key, host: "h" }, host);
  await h.call(
    "scheduler.report",
    { fireId: fireIdOf(made.scheduleId, key), attempt: c.attempt, state: "running", runId: `run_${"7".repeat(32)}` },
    host,
  );
  const out = await h.consumer(alice, async (ctx) => sweepFires(ctx));
  assert.equal(out.closed, 0);
  assert.equal(
    (h.db.all("SELECT state FROM scheduler_api_fires WHERE schedule_id = ?", made.scheduleId)[0] as { state: string })
      .state,
    "running",
  );
});
