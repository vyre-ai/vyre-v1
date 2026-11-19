// The three agent calls (sites.jobs, sites.services, sites.backups) reach the same rules as the app's calls (r42-sites-run).
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0002_promote_tables.sql
// @reads ../migrations/0003_routes.sql
// @reads ../migrations/0004_deploy.sql
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
// @reads ../migrations/0012_ops_locks.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { toolHandlers } from "../handlers/ops-tools.ts";
import { configureRoutes } from "../handlers/route.ts";
import * as st from "../ops/store.ts";

const NOW = Date.parse("2026-11-19T10:30:00Z");
function world(manage = true) {
  const raw = new DatabaseSync(":memory:");
  for (const f of [
    "0001_sites_core.sql",
    "0002_promote_tables.sql",
    "0003_routes.sql",
    "0004_deploy.sql",
    "0010_ops.sql",
    "0011_ops_runs.sql",
    "0012_ops_locks.sql",
  ])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  configureRoutes({ runner: { remove: async () => undefined } } as never);
  const asked: string[] = [];
  const ctx = {
    db,
    now: () => NOW,
    principal: { kind: "agent", id: "agt_1" },
    authorize: (a: { level: string }) => {
      asked.push(a.level);
      return { effect: a.level === "manage" && !manage ? "deny" : "allow" };
    },
    trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  } as unknown as Ctx;
  db.run(
    "INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at) VALUES ('sit_a', 'S', 'app', 'usr_1', 'ready', 'svc_1', 1, 1)",
  );
  return { db, ctx, asked };
}
const call = (ctx: Ctx, cap: keyof typeof toolHandlers, input: unknown) =>
  (toolHandlers[cap] as (c: Ctx, i: unknown) => Promise<any>)(ctx, input); // eslint-disable-line @typescript-eslint/no-explicit-any
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

test("sites.jobs: one call with an action creates, lists (jobs and workers), runs and removes", async () => {
  const w = world();
  const made = await call(w.ctx, "sites.jobs", {
    siteId: "sit_a",
    action: "create",
    name: "Sync",
    schedule: "@daily",
    command: "node a.js",
  });
  const id = made.job.jobId;
  const list = await call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "list" });
  assert.equal(list.jobs.length, 1);
  assert.deepEqual(list.services, []);
  const run = await call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "run", jobId: id });
  assert.equal(run.run.state, "queued");
  assert.equal((await call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "runs", jobId: id })).runs.length, 1);
  assert.equal(
    (await call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "cancel", runId: run.run.runId })).run.state,
    "canceled",
  );
  assert.deepEqual(await call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "delete", jobId: id }), {
    removed: true,
  });
});

test("a missing or unknown action is refused with the choices, and the rules of the underlying call still hold", async () => {
  const w = world();
  assert.equal(await code(call(w.ctx, "sites.jobs", { siteId: "sit_a" })), "validation.bad_input");
  assert.equal(await code(call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "explode" })), "validation.bad_input");
  assert.equal(
    await code(
      call(w.ctx, "sites.jobs", { siteId: "sit_a", action: "create", name: "x", schedule: "nope", command: "x" }),
    ),
    "validation.bad_input",
  );
  assert.equal(await code(call(w.ctx, "sites.jobs", { siteId: "sit_zzz", action: "list" })), "validation.not_found");
});

test("sites.services: add, list, restart, stop and remove", async () => {
  const w = world();
  const a = await call(w.ctx, "sites.services", {
    siteId: "sit_a",
    action: "add",
    name: "Queue",
    command: "node w.js",
  });
  const id = a.service.serviceId;
  assert.equal((await call(w.ctx, "sites.services", { siteId: "sit_a", action: "list" })).services.length, 1);
  assert.equal(
    (await call(w.ctx, "sites.services", { siteId: "sit_a", action: "restart", serviceId: id })).service.state,
    "starting",
  );
  assert.equal(
    (await call(w.ctx, "sites.services", { siteId: "sit_a", action: "stop", serviceId: id })).service.state,
    "stopped",
  );
  assert.deepEqual(await call(w.ctx, "sites.services", { siteId: "sit_a", action: "remove", serviceId: id }), {
    removed: true,
  });
});

test("sites.backups: list and pin work at edit level; restore and delete need manage on the site", async () => {
  const w = world(false);
  st.insertBackup(w.db, {
    id: "bkp_a",
    siteId: "sit_a",
    kind: "postgres",
    state: "ready",
    by: "person",
    at: NOW,
    fileId: "blb_1",
  });
  assert.equal((await call(w.ctx, "sites.backups", { siteId: "sit_a", action: "list" })).backups.length, 1);
  assert.equal(
    (await call(w.ctx, "sites.backups", { siteId: "sit_a", action: "pin", backupId: "bkp_a" })).backup.pinned,
    true,
  );
  assert.equal(
    await code(call(w.ctx, "sites.backups", { siteId: "sit_a", action: "restore", backupId: "bkp_a" })),
    "permission.no_grant",
  );
  assert.equal(
    await code(call(w.ctx, "sites.backups", { siteId: "sit_a", action: "delete", backupId: "bkp_a" })),
    "permission.no_grant",
  );
  const m = world(true);
  st.insertBackup(m.db, { id: "bkp_a", siteId: "sit_a", kind: "postgres", state: "failed", by: "person", at: NOW });
  assert.deepEqual(await call(m.ctx, "sites.backups", { siteId: "sit_a", action: "delete", backupId: "bkp_a" }), {
    removed: true,
  });
  assert.ok(m.asked.includes("manage"));
});
