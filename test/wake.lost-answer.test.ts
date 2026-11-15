// A lost answer is never a second Run (P1 contract 9c): the fire's key is the Run's key, and runs.start answers the same Run for the same key. A routine's fire that starts its Run and then loses the answer
// is claimed again after its lease and asks again: the same Run comes back, and the runs module holds one.
import test from "node:test";
import assert from "node:assert/strict";
import { harness as runsHarness } from "../modules/runs/fixtures/db.ts";
import { engine } from "../modules/runs/fixtures/seed.ts";
import { harness as schedHarness } from "../modules/scheduler-api/fixtures/db.ts";
import { alice, host, MINUTE } from "../modules/scheduler-api/fixtures/seed.ts";
import { fireWakes, tickWakes } from "../modules/scheduler-api/impl.ts";

test("the routine's capability starts the Run, loses its answer, and the retry finds the same Run: one Run for the fire", async () => {
  const runs = runsHarness();
  let lose = true;
  const h = schedHarness({
    now: Date.UTC(2026, 0, 5, 9, 1),
    calls: {
      "agents.routine.fire": async (i) => {
        // what agents.routine.fire does: start the Run with the routine's key
        const key = `routine:${i.routineId}:${i.dueKey}`;
        const started = await runs.call(
          "runs.start",
          { kind: "routine", name: "Digest", owner: alice.id, idempotencyKey: key },
          engine,
        );
        if (lose) {
          lose = false;
          throw new Error("the answer was lost");
        }
        return { started: true, runId: started.runId };
      },
    },
  });
  const made = await h.call(
    "scheduler.schedule",
    {
      owner: { kind: "agent_routine", id: "rtn_digest" },
      cap: "agents.routine.fire",
      input: {},
      when: { cron: "*/5 * * * *", tz: "UTC" },
      kind: "routine",
      person: alice.id,
      agentId: `agt_${"a".repeat(32)}`,
      maxAttempts: 3,
    },
    host,
  );
  h.setNow(Date.UTC(2026, 0, 5, 9, 5, 30));
  await h.consumer(host, async (ctx) => tickWakes(ctx));
  assert.deepEqual(
    await h.consumer(host, async (ctx) => fireWakes(ctx)),
    { started: 0, skipped: 0, failed: 1 },
    "the first try: the Run started, the answer was lost",
  );
  h.advance(3 * MINUTE);
  assert.deepEqual(
    await h.consumer(host, async (ctx) => fireWakes(ctx)),
    { started: 1, skipped: 0, failed: 0 },
    "the retry after the lease",
  );
  const count = (runs.db.all("SELECT COUNT(*) AS n FROM runs_items")[0] as { n: number }).n;
  assert.equal(count, 1, "one Run for the fire");
  const fire = h.db.all(
    "SELECT state, attempt, run_id FROM scheduler_api_fires WHERE schedule_id = ?",
    made.scheduleId,
  )[0] as Record<string, unknown>;
  assert.equal(fire["state"], "running");
  assert.equal(fire["attempt"], 2);
  assert.match(String(fire["run_id"]), /^run_/);
});
