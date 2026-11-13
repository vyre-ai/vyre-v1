// A scheduled job that drives a Run and dies after its last try ends that Run failed, so its owner is told (lead, 12 Nov). Before, a dead connectors.sync_run left its Run queued for ever.
import test from "node:test";
import assert from "node:assert/strict";
import { endOfDeadJob } from "../src/daemon/dead-jobs.ts";
import { ScheduleQueue } from "../src/ctx/schedule.ts";
import type { ScheduledCall } from "../src/ctx/schedule.ts";

const job = (cap: string, input: unknown): ScheduledCall => ({
  id: "job_1",
  space: "spc_1",
  cap,
  input,
  principal: { kind: "person", id: "usr_maya" },
  tries: 4,
});

test("a dead sync job ends its Run failed with the reason, as the person who scheduled it; other jobs are left alone", () => {
  const end = endOfDeadJob(job("connectors.sync_run", { runId: "run_7" }), new Error("the app did not answer"));
  assert.ok(end);
  assert.equal(end.cap, "runs.finish");
  assert.deepEqual(end.principal, { kind: "person", id: "usr_maya" });
  const input = end.input as { runId: string; status: string; error: { message: string } };
  assert.equal(input.runId, "run_7");
  assert.equal(input.status, "failed");
  assert.match(input.error.message, /stopped after 5 tries: the app did not answer/);
  assert.equal(endOfDeadJob(job("gate.expire", { runId: "run_7" }), new Error("x")), null);
  assert.equal(endOfDeadJob(job("connectors.sync_run", {}), new Error("x")), null);
});

test("the queue reports the last failure as final, which is when the Run is ended", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(":memory:");
  const db = {
    run: (sql: string, ...a: unknown[]) => raw.prepare(sql).run(...(a as never[])),
    all: (sql: string, ...a: unknown[]) => raw.prepare(sql).all(...(a as never[])),
    exec: (sql: string) => raw.exec(sql),
  };
  let t = 1_000;
  const finals: boolean[] = [];
  const q = new ScheduleQueue({
    db: db as never,
    now: () => t,
    maxTries: 2,
    backoffMs: () => 0,
    run: async () => {
      throw new Error("down");
    },
    onError: (_c, _e, final) => {
      finals.push(final);
    },
  });
  await q.add({ space: "spc_1", principal: { kind: "person", id: "usr_maya" } }, t, "connectors.sync_run", {
    runId: "run_7",
  });
  await q.tick();
  t += 1;
  await q.tick();
  assert.deepEqual(finals, [false, true]);
});
