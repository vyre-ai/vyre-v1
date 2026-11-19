// sites.logs_read and sites.metrics over a real SQLite with the sites migrations (r42-sites-run, slice 4).
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
import { opsHandlers } from "../handlers/ops.ts";
import * as st from "../ops/store.ts";
import { MINUTE } from "../ops/metrics.ts";
import { resetOps } from "../ops/instance.ts";

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
  const ctx = {
    db,
    now: () => NOW,
    trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  } as unknown as Ctx;
  db.run(
    "INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at, limits) VALUES ('sit_a', 'Shop', 'app', 'usr_1', 'ready', 'svc_1', 1, 1, ?)",
    JSON.stringify({ cpus: 2, memoryMb: 1024 }),
  );
  db.run(
    "INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at) VALUES ('sit_b', 'Other', 'app', 'usr_1', 'ready', 'svc_1', 1, 1)",
  );
  return { db, ctx };
}
const call = (ctx: Ctx, cap: keyof typeof opsHandlers, input: unknown) =>
  (opsHandlers[cap] as (c: Ctx, i: unknown) => Promise<any>)(ctx, input); // eslint-disable-line @typescript-eslint/no-explicit-any
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

test("a log read returns lines, the cut note and the scopes, and a site never reads another's", async () => {
  const w = world();
  st.addLogs(w.db, "sit_a", "dpl_1", "app", [{ at: NOW - 5000, text: "listening\nError: db down" }]);
  st.addLogs(w.db, "sit_b", "dpl_9", "app", [{ at: NOW - 5000, text: "secret of b" }]);
  const r = await call(w.ctx, "sites.logs_read", { siteId: "sit_a" });
  assert.deepEqual(
    r.lines.map((l: { text: string }) => l.text),
    ["listening", "Error: db down"],
  );
  assert.equal(r.scopes[0].scope, "dpl_1");
  assert.equal(
    r.lines.some((l: { text: string }) => l.text.includes("secret")),
    false,
  );
  assert.equal((await call(w.ctx, "sites.logs_read", { siteId: "sit_a", scope: "dpl_9" })).lines.length, 0);
});

test("search, level and cursor", async () => {
  const w = world();
  st.addLogs(w.db, "sit_a", "dpl_1", "app", [{ at: 1, text: "a one\nb two\nError: c three" }]);
  assert.deepEqual(
    (await call(w.ctx, "sites.logs_read", { siteId: "sit_a", q: "two" })).lines.map((l: { text: string }) => l.text),
    ["b two"],
  );
  assert.deepEqual(
    (await call(w.ctx, "sites.logs_read", { siteId: "sit_a", level: "error" })).lines.map(
      (l: { text: string }) => l.text,
    ),
    ["Error: c three"],
  );
  const first = await call(w.ctx, "sites.logs_read", { siteId: "sit_a" });
  st.addLogs(w.db, "sit_a", "dpl_1", "app", [{ at: 2, text: "d four" }]);
  const more = await call(w.ctx, "sites.logs_read", { siteId: "sit_a", after: first.lastSeq });
  assert.deepEqual(
    more.lines.map((l: { text: string }) => l.text),
    ["d four"],
  );
});

test("a cut log says how much was left out", async () => {
  const w = world();
  for (let i = 0; i < 5; i++)
    st.addLogs(w.db, "sit_a", "dpl_1", "app", [{ at: i, text: `n${i}` }], {
      lineChars: 100,
      lines: 2,
      bytes: 1e6,
      scopes: 5,
    });
  const r = await call(w.ctx, "sites.logs_read", { siteId: "sit_a", scope: "dpl_1" });
  assert.equal(r.leftOut, "... 3 earlier lines left out");
  assert.equal(r.lines.length, 2);
});

test("a build log is read from the deployment, per deploy, with search", async () => {
  const w = world();
  w.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, at, log, commit_sha, created_by, updated_at) VALUES ('dpl_1', 'sit_a', 'production', 'ready', ?, ?, 'abcdef1234', 'usr_1', 1)",
    NOW - 9000,
    JSON.stringify(["==> Building", "npm ERR! missing", "==> Live"]),
  );
  w.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, at, log, created_by, updated_at) VALUES ('dpl_2', 'sit_a', 'production', 'failed', ?, ?, 'usr_1', 1)",
    NOW - 1000,
    JSON.stringify(["==> Building", "boom"]),
  );
  const latest = await call(w.ctx, "sites.logs_read", { siteId: "sit_a", source: "build" });
  assert.deepEqual(
    latest.lines.map((l: { text: string }) => l.text),
    ["==> Building", "boom"],
  );
  const older = await call(w.ctx, "sites.logs_read", { siteId: "sit_a", source: "build", scope: "dpl_1", q: "err" });
  assert.deepEqual(
    older.lines.map((l: { text: string; level: string }) => [l.text, l.level]),
    [["npm ERR! missing", "error"]],
  );
  assert.deepEqual(
    latest.scopes
      .filter((s: { source: string }) => s.source === "build")
      .map((s: { scope: string; title: string }) => [s.scope, s.title]),
    [
      ["dpl_2", "Deploy"],
      ["dpl_1", "Deploy abcdef1"],
    ],
  );
  const none = await call(w.ctx, "sites.logs_read", { siteId: "sit_b", source: "build" });
  assert.deepEqual(none.lines, []);
});

test("bad input is refused in one plain sentence", async () => {
  const w = world();
  assert.equal(await code(call(w.ctx, "sites.logs_read", { siteId: "sit_a", source: "nope" })), "validation.bad_input");
  assert.equal(await code(call(w.ctx, "sites.logs_read", { siteId: "sit_a", level: "loud" })), "validation.bad_input");
  assert.equal(await code(call(w.ctx, "sites.logs_read", { siteId: "sit_a", limit: 0 })), "validation.bad_input");
  assert.equal(await code(call(w.ctx, "sites.logs_read", { siteId: "sit_a", limit: 1001 })), "validation.bad_input");
  assert.equal(
    await code(call(w.ctx, "sites.logs_read", { siteId: "sit_a", q: "x".repeat(201) })),
    "validation.bad_input",
  );
  assert.equal(await code(call(w.ctx, "sites.logs_read", { siteId: "sit_zzz" })), "validation.not_found");
  assert.equal(await code(call(w.ctx, "sites.logs_read", {})), "validation.bad_input");
  assert.equal(await code(call(w.ctx, "sites.metrics", { siteId: "sit_a", window: "3d" })), "validation.bad_input");
});

test("metrics: the last hour with gaps left empty, and the Right now cards against the site's own limits", async () => {
  resetOps();
  const w = world();
  const m = Math.floor(NOW / MINUTE) * MINUTE;
  st.putUsage(w.db, "sit_a", m - MINUTE, { cpu: 50, memMb: 300 });
  st.putRequests(w.db, "sit_a", m - MINUTE, { requests: 20, errors: 2, p50: 30, p95: 120 });
  const r = await call(w.ctx, "sites.metrics", { siteId: "sit_a" });
  assert.equal(r.window, "1h");
  assert.equal(r.samples.length, 60);
  assert.equal(r.samples.at(-2)?.cpu, 50);
  assert.equal(r.samples.at(-1), null);
  assert.deepEqual(r.now, {
    cpu: { value: 50, of: 200 },
    mem: { valueMb: 300, ofMb: 1024 },
    requestsPerMin: 20,
    p95: 120,
    errorRate: 10,
  });
  assert.equal(r.measured, true);
  assert.equal(r.requests, true);
});

test("metrics: a site never measured says so, and a reading older than three minutes is not 'right now'", async () => {
  resetOps();
  const w = world();
  const empty = await call(w.ctx, "sites.metrics", { siteId: "sit_b" });
  assert.equal(empty.measured, false);
  assert.equal(empty.requests, false);
  assert.deepEqual(empty.now, {
    cpu: { value: 0, of: 100 },
    mem: { valueMb: 0, ofMb: 512 },
    requestsPerMin: 0,
    p95: 0,
    errorRate: 0,
  });
  st.putUsage(w.db, "sit_b", NOW - 10 * MINUTE, { cpu: 80, memMb: 200 });
  const old = await call(w.ctx, "sites.metrics", { siteId: "sit_b" });
  assert.equal(old.measured, true);
  assert.equal(old.now.cpu.value, 0);
});

test("metrics: six hours and a day come as at most sixty points", async () => {
  const w = world();
  for (const win of ["6h", "24h"])
    assert.equal((await call(w.ctx, "sites.metrics", { siteId: "sit_a", window: win })).samples.length, 60);
});
