// sites.ops, the one agent call for site operations, reaches the same rules as the app's calls (r42-sites-run).
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
import { ACTIONS, toolHandlers } from "../handlers/ops-tools.ts";
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
const ops = async (ctx: Ctx, input: unknown) =>
  ((await toolHandlers["sites.ops"](ctx, input)) as { result: any }).result; // eslint-disable-line @typescript-eslint/no-explicit-any
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

test("jobs: create, list (with workers), run, runs, cancel and delete through one call with an id", async () => {
  const w = world();
  const made = await ops(w.ctx, {
    siteId: "sit_a",
    action: "job_create",
    args: { name: "Sync", schedule: "@daily", command: "node a.js" },
  });
  const id = made.job.jobId;
  const list = await ops(w.ctx, { siteId: "sit_a", action: "jobs" });
  assert.equal(list.jobs.length, 1);
  assert.deepEqual(list.services, []);
  const run = await ops(w.ctx, { siteId: "sit_a", action: "job_run", id });
  assert.equal(run.run.state, "queued");
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "job_runs", id })).runs.length, 1);
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "job_cancel", id: run.run.runId })).run.state, "canceled");
  assert.deepEqual(await ops(w.ctx, { siteId: "sit_a", action: "job_delete", id }), { removed: true });
});

test("a missing or unknown action is refused with the choices, and the rules of the underlying call still hold", async () => {
  const w = world();
  assert.equal(await code(ops(w.ctx, { siteId: "sit_a" })), "validation.bad_input");
  assert.equal(await code(ops(w.ctx, { siteId: "sit_a", action: "explode" })), "validation.bad_input");
  assert.equal(
    await code(
      ops(w.ctx, { siteId: "sit_a", action: "job_create", args: { name: "x", schedule: "nope", command: "x" } }),
    ),
    "validation.bad_input",
  );
  assert.equal(await code(ops(w.ctx, { siteId: "sit_zzz", action: "jobs" })), "validation.not_found");
  assert.equal(await code(ops(w.ctx, { siteId: "sit_a", action: "job_run", id: "job_nope" })), "validation.not_found");
});

test("workers: add, restart, stop and remove", async () => {
  const w = world();
  const a = await ops(w.ctx, { siteId: "sit_a", action: "worker_add", args: { name: "Queue", command: "node w.js" } });
  const id = a.service.serviceId;
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "jobs" })).services.length, 1);
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "worker_restart", id })).service.state, "starting");
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "worker_stop", id })).service.state, "stopped");
  assert.deepEqual(await ops(w.ctx, { siteId: "sit_a", action: "worker_remove", id }), { removed: true });
});

test("logs and metrics are read through the same call", async () => {
  const w = world();
  st.addLogs(w.db, "sit_a", "dpl_1", "app", [{ at: NOW - 1000, text: "hello" }]);
  assert.deepEqual(
    (await ops(w.ctx, { siteId: "sit_a", action: "logs", args: { q: "hello" } })).lines.map(
      (l: { text: string }) => l.text,
    ),
    ["hello"],
  );
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "metrics", args: { window: "1h" } })).window, "1h");
});

test("backups: list and pin work at edit level; restore and delete need manage on the site", async () => {
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
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "backups" })).backups.length, 1);
  assert.equal((await ops(w.ctx, { siteId: "sit_a", action: "backup_pin", id: "bkp_a" })).backup.pinned, true);
  assert.equal(
    await code(ops(w.ctx, { siteId: "sit_a", action: "backup_restore", id: "bkp_a" })),
    "permission.no_grant",
  );
  assert.equal(
    await code(ops(w.ctx, { siteId: "sit_a", action: "backup_delete", id: "bkp_a" })),
    "permission.no_grant",
  );
  const m = world(true);
  st.insertBackup(m.db, { id: "bkp_a", siteId: "sit_a", kind: "postgres", state: "failed", by: "person", at: NOW });
  assert.deepEqual(await ops(m.ctx, { siteId: "sit_a", action: "backup_delete", id: "bkp_a" }), { removed: true });
  assert.ok(m.asked.includes("manage"));
});

test("every action the skill names exists", () => {
  for (const n of [
    "logs",
    "metrics",
    "jobs",
    "job_create",
    "job_update",
    "job_delete",
    "job_run",
    "job_cancel",
    "job_runs",
    "worker_add",
    "worker_restart",
    "worker_stop",
    "worker_remove",
    "backups",
    "backup_create",
    "backup_delete",
    "backup_pin",
    "backup_download",
    "backup_restore",
  ])
    assert.ok(ACTIONS[n], n);
});

test("a wrong first call is answered with the exact shape the action needs, so the next call goes through", async () => {
  const w = world();
  const msg = async (input: unknown): Promise<string> => {
    try {
      await toolHandlers["sites.ops"](w.ctx, input);
    } catch (e) {
      if (e instanceof VyreErr) return e.error.message;
    }
    return "";
  };
  // the arguments put at the top level, or named wrongly
  assert.equal(
    await msg({ siteId: "sit_a", action: "job_create" }),
    "job_create needs {action:'job_create', args:{name, schedule, command}} (schedule is cron, like '0 2 * * *'). Missing: name, schedule, command.",
  );
  assert.match(
    await msg({ siteId: "sit_a", action: "job_create", args: { name: "x", cmd: "node a.js", schedule: "@daily" } }),
    /Missing: command\./,
  );
  assert.equal(await msg({ siteId: "sit_a", action: "job_run" }), "job_run needs {action:'job_run', id:<job id>}.");
  assert.match(
    await msg({ siteId: "sit_a", action: "worker_add", args: { name: "q" } }),
    /worker_add needs .*Missing: command/,
  );
  assert.match(
    await msg({ siteId: "sit_a", action: "backup_restore" }),
    /backup_restore needs \{action:'backup_restore', id:<backup id>\}/,
  );
  assert.match(await msg({ siteId: "sit_a", action: "explode" }), /Pick one of: logs, metrics, jobs, job_create/);
  // and the call the hint describes goes through
  const made = await ops(w.ctx, {
    siteId: "sit_a",
    action: "job_create",
    args: { name: "x", command: "node a.js", schedule: "@daily" },
  });
  assert.equal(made.job.name, "x");
});

// ---- a live first call: the call an agent makes from the tool's own text goes through the real input validator and the real handler

import { validateInput, validateOutput } from "../../../generated/validators.ts";

test("live: an agent's first call to a logs action, as the tool and the skill describe it, passes the real validator and returns lines", async () => {
  const w = world();
  st.addLogs(w.db, "sit_a", "dpl_1", "app", [
    { at: NOW - 1000, text: "listening on 3000" },
    { at: NOW - 500, text: "Error: boom" },
  ]);
  const first = { siteId: "sit_a", action: "logs" };
  assert.deepEqual(validateInput("sites.ops", 1, first), [], "the bare first call is valid");
  const out = await toolHandlers["sites.ops"](w.ctx, first);
  assert.deepEqual(validateOutput("sites.ops", 1, out), [], "and its answer matches the contract");
  assert.deepEqual(
    (out as { result: { lines: { text: string }[] } }).result.lines.map((l) => l.text),
    ["listening on 3000", "Error: boom"],
  );
  // with the args the skill names
  const narrowed = { siteId: "sit_a", action: "logs", args: { q: "error", level: "error", limit: 5 } };
  assert.deepEqual(validateInput("sites.ops", 1, narrowed), []);
  assert.deepEqual(
    ((await toolHandlers["sites.ops"](w.ctx, narrowed)) as { result: { lines: { text: string }[] } }).result.lines.map(
      (l) => l.text,
    ),
    ["Error: boom"],
  );
});
