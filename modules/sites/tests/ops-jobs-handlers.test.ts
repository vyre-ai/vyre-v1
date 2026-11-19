// sites.job_* and sites.service_* over a real SQLite (r42-sites-run, slice 5).
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0002_promote_tables.sql
// @reads ../migrations/0003_routes.sql
// @reads ../migrations/0004_deploy.sql
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { jobHandlers } from "../handlers/ops-jobs.ts";
import { configureRoutes } from "../handlers/route.ts";
import * as st from "../ops/store.ts";

const NOW = Date.parse("2026-11-19T10:30:00Z");
function world() {
  const raw = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0010_ops.sql",
    "0011_ops_runs.sql",
  ])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const removed: string[] = [];
  configureRoutes({ runner: { remove: async (c: string) => void removed.push(c) } } as never);
  const ctx = {
    db,
    now: () => NOW,
    principal: { kind: "person", id: "usr_1" },
    trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  } as unknown as Ctx;
  for (const id of ["sit_a", "sit_b"])
    db.run(
      "INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at) VALUES (?, 'S', 'app', 'usr_1', 'ready', 'svc_1', 1, 1)",
      id,
    );
  return { db, ctx, removed };
}
const call = (ctx: Ctx, cap: keyof typeof jobHandlers, input: unknown) =>
  (jobHandlers[cap] as (c: Ctx, i: unknown) => Promise<any>)(ctx, input); // eslint-disable-line @typescript-eslint/no-explicit-any
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}
const NEW = {
  siteId: "sit_a",
  name: "Nightly sync",
  schedule: "0 2 * * *",
  command: 'node scripts/sync.js --since "last week"',
};

test("a job is made with its words, its next run in its zone, and the schedule in words", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", { ...NEW, zone: "Asia/Karachi" });
  assert.equal(job.name, "Nightly sync");
  assert.equal(job.when, "Every day at 02:00");
  assert.equal(job.command, 'node scripts/sync.js --since "last week"');
  assert.equal(job.nextAt, Date.parse("2026-11-19T21:00:00Z")); // 02:00 on the 20th in Karachi
  assert.equal(job.timeoutSec, 600);
  assert.equal(job.enabled, true);
  assert.deepEqual(st.getJob(w.db, job.jobId)?.command, ["node", "scripts/sync.js", "--since", "last week"]);
  assert.equal((await call(w.ctx, "sites.jobs_list", { siteId: "sit_a" })).jobs.length, 1);
  assert.equal((await call(w.ctx, "sites.jobs_list", { siteId: "sit_b" })).jobs.length, 0);
});

test("a bad job is refused in one plain sentence", async () => {
  const w = world();
  for (const bad of [
    { schedule: "soon" },
    { command: "" },
    { command: 'echo "open' },
    { name: "  " },
    { timeoutSec: 1 },
    { zone: "Mars/Base" },
  ])
    assert.equal(
      await code(call(w.ctx, "sites.job_create", { ...NEW, ...bad })),
      "validation.bad_input",
      JSON.stringify(bad),
    );
  assert.equal(await code(call(w.ctx, "sites.job_create", { ...NEW, siteId: "sit_zzz" })), "validation.not_found");
});

test("a site has at most twenty jobs", async () => {
  const w = world();
  for (let i = 0; i < 20; i++) await call(w.ctx, "sites.job_create", { ...NEW, name: `Job ${i}` });
  assert.equal(await code(call(w.ctx, "sites.job_create", NEW)), "validation.precondition_failed");
});

test("update changes what is named, pausing and resuming do not run what was missed, and another site's job is not found", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", NEW);
  st.saveJob(w.db, { ...st.getJob(w.db, job.jobId)!, lastSlot: 5 });
  const paused = await call(w.ctx, "sites.job_update", { siteId: "sit_a", jobId: job.jobId, enabled: false });
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.nextAt, undefined);
  const back = await call(w.ctx, "sites.job_update", { siteId: "sit_a", jobId: job.jobId, enabled: true });
  assert.equal(back.job.enabled, true);
  assert.equal(st.getJob(w.db, job.jobId)?.lastSlot, NOW - (NOW % 60_000), "resuming starts from now");
  const renamed = await call(w.ctx, "sites.job_update", {
    siteId: "sit_a",
    jobId: job.jobId,
    name: "Stock",
    command: "node a.js",
    schedule: "@hourly",
  });
  assert.deepEqual([renamed.job.name, renamed.job.command, renamed.job.when], ["Stock", "node a.js", "Every hour"]);
  assert.equal(
    await code(call(w.ctx, "sites.job_update", { siteId: "sit_b", jobId: job.jobId, name: "x" })),
    "validation.not_found",
  );
  assert.equal(
    await code(call(w.ctx, "sites.job_update", { siteId: "sit_a", jobId: job.jobId, schedule: "nope" })),
    "validation.bad_input",
  );
});

test("Run now queues one run and refuses a second while it is open; the list shows the last run", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", NEW);
  const { run } = await call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId });
  assert.equal(run.state, "queued");
  assert.equal(run.by, "person");
  assert.equal(
    await code(call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId })),
    "validation.precondition_failed",
  );
  assert.equal((await call(w.ctx, "sites.jobs_list", { siteId: "sit_a" })).jobs[0].last.runId, run.runId);
});

test("cancel ends a queued run and a running one (its container goes), and a finished run cannot be cancelled", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", NEW);
  const { run } = await call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId });
  const c1 = await call(w.ctx, "sites.job_cancel", { siteId: "sit_a", runId: run.runId });
  assert.equal(c1.run.state, "canceled");
  const second = (await call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId })).run;
  st.saveRun(w.db, { ...st.getRun(w.db, second.runId)!, state: "running", startedAt: 1 }, "queued", "ctr_9");
  const c2 = await call(w.ctx, "sites.job_cancel", { siteId: "sit_a", runId: second.runId });
  assert.equal(c2.run.state, "canceled");
  assert.deepEqual(w.removed, ["ctr_9"]);
  // cancelling again is harmless (it says it ended the same way); a run that succeeded is refused
  const ok = (await call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId })).run;
  st.saveRun(w.db, { ...st.getRun(w.db, ok.runId)!, state: "running", startedAt: 1 }, "queued");
  st.saveRun(w.db, { ...st.getRun(w.db, ok.runId)!, state: "succeeded", endedAt: 2, exitCode: 0 }, "running");
  assert.equal(
    await code(call(w.ctx, "sites.job_cancel", { siteId: "sit_a", runId: ok.runId })),
    "validation.precondition_failed",
  );
  assert.equal(
    await code(call(w.ctx, "sites.job_cancel", { siteId: "sit_b", runId: run.runId })),
    "validation.not_found",
  );
});

test("runs are listed newest first, at most fifty", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", NEW);
  for (let i = 0; i < 3; i++)
    st.insertRun(w.db, "sit_a", {
      id: `r${i}`,
      jobId: job.jobId,
      state: "succeeded",
      slot: i,
      by: "schedule",
      queuedAt: i,
      endedAt: i + 1,
      exitCode: 0,
    });
  assert.deepEqual(
    (await call(w.ctx, "sites.job_runs", { siteId: "sit_a", jobId: job.jobId })).runs.map(
      (r: { runId: string }) => r.runId,
    ),
    ["r2", "r1", "r0"],
  );
  assert.equal(
    await code(call(w.ctx, "sites.job_runs", { siteId: "sit_a", jobId: job.jobId, limit: 51 })),
    "validation.bad_input",
  );
});

test("deleting a job stops what is going, and the job leaves the list", async () => {
  const w = world();
  const { job } = await call(w.ctx, "sites.job_create", NEW);
  const run = (await call(w.ctx, "sites.job_run", { siteId: "sit_a", jobId: job.jobId })).run;
  st.saveRun(w.db, { ...st.getRun(w.db, run.runId)!, state: "running", startedAt: 1 }, "queued", "ctr_1");
  assert.deepEqual(await call(w.ctx, "sites.job_delete", { siteId: "sit_a", jobId: job.jobId }), { removed: true });
  assert.deepEqual(w.removed, ["ctr_1"]);
  assert.equal(st.getRun(w.db, run.runId)?.state, "canceled");
  assert.equal((await call(w.ctx, "sites.jobs_list", { siteId: "sit_a" })).jobs.length, 0);
});

test("a worker is added and wanted at once; restart clears a crash loop; stop and remove take the container away", async () => {
  const w = world();
  const { service } = await call(w.ctx, "sites.service_add", {
    siteId: "sit_a",
    name: "Queue",
    command: "node worker.js",
  });
  assert.equal(service.state, "starting");
  assert.equal(service.command, "node worker.js");
  const id = service.serviceId;
  st.saveService(
    w.db,
    { ...st.getService(w.db, id)!, state: "failed", crashes: [1, 2, 3, 4, 5, 6, 7, 8], streak: 8, note: "x" },
    "ctr_old",
  );
  const re = await call(w.ctx, "sites.service_restart", { siteId: "sit_a", serviceId: id });
  assert.equal(re.service.state, "starting");
  assert.deepEqual(w.removed, ["ctr_old"]);
  assert.equal(st.getService(w.db, id)?.containerId, undefined);
  assert.deepEqual(st.getService(w.db, id)?.crashes, []);
  st.saveService(w.db, st.getService(w.db, id)!, "ctr_new");
  const stopped = await call(w.ctx, "sites.service_stop", { siteId: "sit_a", serviceId: id });
  assert.equal(stopped.service.state, "stopped");
  assert.deepEqual(w.removed, ["ctr_old", "ctr_new"]);
  assert.deepEqual(await call(w.ctx, "sites.service_remove", { siteId: "sit_a", serviceId: id }), { removed: true });
  assert.equal((await call(w.ctx, "sites.services_list", { siteId: "sit_a" })).services.length, 0);
  assert.equal(
    await code(call(w.ctx, "sites.service_stop", { siteId: "sit_b", serviceId: id })),
    "validation.not_found",
  );
});

test("a worker needs a command and a site has at most ten", async () => {
  const w = world();
  assert.equal(
    await code(call(w.ctx, "sites.service_add", { siteId: "sit_a", name: "Q", command: "" })),
    "validation.bad_input",
  );
  assert.equal(
    await code(call(w.ctx, "sites.service_add", { siteId: "sit_a", name: "Q", command: "x", kind: "web" })),
    "validation.bad_input",
  );
  for (let i = 0; i < 10; i++) await call(w.ctx, "sites.service_add", { siteId: "sit_a", name: `W${i}`, command: "x" });
  assert.equal(
    await code(call(w.ctx, "sites.service_add", { siteId: "sit_a", name: "W", command: "x" })),
    "validation.precondition_failed",
  );
});
