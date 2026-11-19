// The collector: log lines from a container into the store without repeats, CPU and memory once a minute, request counts and lines, and what happens when Docker fails (r42-sites-run, slice 4).
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Collector, REQUEST_LINES_PER_ROUND, each, targets } from "../ops/collect.ts";
import type { CollectRunner } from "../ops/collect.ts";
import { MINUTE } from "../ops/metrics.ts";
import * as st from "../ops/store.ts";
import type { OpsDb } from "../ops/store.ts";

function mem(): OpsDb {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE sites_site (id TEXT PRIMARY KEY, container_id TEXT, current_deployment TEXT, deleted_at INTEGER);",
  );
  for (const f of ["0010_ops.sql", "0011_ops_runs.sql"]) db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  return {
    all: (q, ...a) => db.prepare(q).all(...(a as never[])),
    run: (q, ...a) => ({ changes: Number(db.prepare(q).run(...(a as never[])).changes) }),
  };
}
const site = (db: OpsDb, id: string, ctr: string | null, dep: string | null = "dpl_1"): void => void db.run("INSERT INTO sites_site (id, container_id, current_deployment) VALUES (?, ?, ?)", id, ctr, dep);
const T0 = Date.parse("2026-11-19T10:00:00Z");

function world(o: { logs?: () => string[]; stats?: () => unknown } = {}) {
  const db = mem();
  let now = T0;
  const calls = { logs: 0, stats: 0 };
  const runner: CollectRunner = {
    logsSince: async () => {
      calls.logs++;
      return o.logs ? o.logs() : [];
    },
    stats: async () => {
      calls.stats++;
      return (o.stats ? o.stats() : null) as never;
    },
  };
  const c = new Collector({ db, runner: () => runner, now: () => now, siteOfHost: (h) => (h === "shop.sites.test" ? "s1" : null) });
  return { db, c, calls, at: (ms: number) => void (now = ms), advance: (ms: number) => void (now += ms) };
}

test("targets lists a site's app, its running workers and its running jobs, and nothing for a site that is stopped or gone", () => {
  const w = world();
  site(w.db, "s1", "ctr_a", "dpl_9");
  site(w.db, "s2", null);
  w.db.run("INSERT INTO sites_site (id, container_id, deleted_at) VALUES ('s3', 'ctr_gone', 5)");
  st.insertService(w.db, { id: "v1", siteId: "s1", name: "q", kind: "worker", command: ["x"], at: 1 });
  st.saveService(w.db, { id: "v1", siteId: "s1", name: "q", kind: "worker", state: "running", streak: 0, crashes: [] }, "ctr_w");
  st.insertService(w.db, { id: "v2", siteId: "s1", name: "r", kind: "worker", command: ["x"], at: 1 });
  st.saveService(w.db, { id: "v2", siteId: "s1", name: "r", kind: "worker", state: "backoff", streak: 1, crashes: [1] }, "ctr_dead");
  st.insertRun(w.db, "s1", { id: "run1", jobId: "j1", state: "queued", slot: 1, by: "schedule", queuedAt: 1 });
  st.saveRun(w.db, { id: "run1", jobId: "j1", state: "running", slot: 1, by: "schedule", queuedAt: 1, startedAt: 2 }, "queued", "ctr_j");
  assert.deepEqual(
    targets(w.db).map((t) => [t.scope, t.source, t.containerId, t.counts]),
    [["dpl_9", "app", "ctr_a", true], ["v1", "app", "ctr_w", true], ["run1", "jobs", "ctr_j", false]],
  );
});

test("a tick stores the container's lines under the deployment, once each, and keeps the cursor", async () => {
  const lines = ["2026-11-19T10:00:00.100000000Z hello", "2026-11-19T10:00:00.200000000Z Error: boom"];
  const w = world({ logs: () => lines });
  site(w.db, "s1", "ctr_a");
  await w.c.tick();
  w.advance(2000);
  await w.c.tick(); // Docker sends the same lines again
  const r = st.readLogs(w.db, "s1", { scope: "dpl_1" });
  assert.deepEqual(r.lines.map((l) => [l.text, l.level, l.source]), [["hello", "info", "app"], ["Error: boom", "error", "app"]]);
  assert.equal(st.getCursor(w.db, "s1", "dpl_1")?.ns, "2026-11-19T10:00:00.200000000Z");
});

test("a server restart resumes from the stored cursor and does not store a line twice", async () => {
  const lines = ["2026-11-19T10:00:00.100000000Z hello", "2026-11-19T10:00:00.200000000Z world"];
  const w = world({ logs: () => lines });
  site(w.db, "s1", "ctr_a");
  await w.c.tick();
  const again = new Collector({ db: w.db, runner: () => ({ logsSince: async () => lines, stats: async () => null }), now: () => T0 + 5000, siteOfHost: () => null });
  await again.tick();
  assert.equal(st.readLogs(w.db, "s1").lines.length, 2);
});

test("a container that cannot be read changes nothing and the next round tries again", async () => {
  let fail = true;
  const w = world({
    logs: () => {
      if (fail) throw new Error("engine down");
      return ["2026-11-19T10:00:00.100000000Z back"];
    },
  });
  site(w.db, "s1", "ctr_a");
  await w.c.tick();
  assert.equal(st.readLogs(w.db, "s1").lines.length, 0);
  assert.equal(st.getCursor(w.db, "s1", "dpl_1"), undefined);
  fail = false;
  w.advance(2000);
  await w.c.tick();
  assert.deepEqual(st.readLogs(w.db, "s1").lines.map((l) => l.text), ["back"]);
});

test("a container is read at most once every second and a half, and drain reads at once", async () => {
  const w = world({ logs: () => [] });
  site(w.db, "s1", "ctr_a");
  await w.c.tick();
  w.advance(500);
  await w.c.tick();
  assert.equal(w.calls.logs, 1);
  await w.c.drain(targets(w.db)[0]!);
  assert.equal(w.calls.logs, 2);
  w.advance(2000);
  await w.c.tick();
  assert.equal(w.calls.logs, 3);
});

test("a tick that starts while another runs returns at once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const w = world();
  site(w.db, "s1", "ctr_a");
  const slow = new Collector({
    db: w.db,
    runner: () => ({ logsSince: async () => (await gate, []), stats: async () => null }),
    now: () => T0,
    siteOfHost: () => null,
  });
  const first = slow.tick();
  await slow.tick();
  release();
  await first;
});

test("CPU and memory are written once a minute, summed over the app and its workers", async () => {
  const stats = { cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 4000, online_cpus: 1 }, precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 3000 }, memory_stats: { usage: 100 * 1024 * 1024, limit: 512 * 1024 * 1024 } };
  const w = world({ stats: () => stats });
  site(w.db, "s1", "ctr_a");
  st.insertService(w.db, { id: "v1", siteId: "s1", name: "q", kind: "worker", command: ["x"], at: 1 });
  st.saveService(w.db, { id: "v1", siteId: "s1", name: "q", kind: "worker", state: "running", streak: 0, crashes: [] }, "ctr_w");
  await w.c.tick();
  const m = Math.floor(T0 / MINUTE) * MINUTE;
  assert.deepEqual(st.readSamples(w.db, "s1", m, m).map((x) => [x.cpu, x.memMb]), [[200, 200]]);
  const before = w.calls.stats;
  w.advance(20_000);
  await w.c.tick();
  assert.equal(w.calls.stats, before, "not again within the minute");
  w.advance(MINUTE);
  await w.c.tick();
  assert.equal(st.readSamples(w.db, "s1", 0, 1e13).length, 2);
});

test("a site with no reading writes no sample", async () => {
  const w = world({ stats: () => null });
  site(w.db, "s1", "ctr_a");
  await w.c.tick();
  assert.equal(st.readSamples(w.db, "s1", 0, 1e13).length, 0);
});

const line = (host: string, ts: number, status = 200, duration = 0.01): string =>
  JSON.stringify({ ts: ts / 1000, status, duration, request: { host, method: "GET", uri: "/x?token=1" } });

test("access lines of a site's host are counted and listed without their query; other hosts are ignored", async () => {
  const w = world();
  site(w.db, "s1", "ctr_a");
  w.c.access(line("shop.sites.test", T0 + 1000, 200, 0.02));
  w.c.access(line("shop.sites.test", T0 + 2000, 500, 0.04));
  w.c.access(line("other.example.com", T0 + 2000));
  w.c.access("garbage");
  w.advance(MINUTE + 1000);
  await w.c.tick(); // the minute is over: counts are written, the lines are listed
  const m = Math.floor(T0 / MINUTE) * MINUTE;
  const [s] = st.readSamples(w.db, "s1", m, m);
  assert.deepEqual([s?.requests, s?.errors, s?.p95], [2, 1, 40]);
  assert.deepEqual(st.readLogs(w.db, "s1", { source: "requests" }).lines.map((l) => l.text), ["GET /x 200 20ms", "GET /x 500 40ms"]);
  assert.equal(st.readLogs(w.db, "s2", {}).lines.length, 0);
});

test("a flood of requests lists the first lines of a round, says how many it did not list, and counts every one", async () => {
  const w = world();
  site(w.db, "s1", "ctr_a");
  for (let i = 0; i < REQUEST_LINES_PER_ROUND + 7; i++) w.c.access(line("shop.sites.test", T0 + 100));
  w.advance(MINUTE + 1000);
  await w.c.tick();
  const lines = st.readLogs(w.db, "s1", { source: "requests", limit: 1000 }).lines;
  assert.equal(lines.length, REQUEST_LINES_PER_ROUND + 1);
  assert.equal(lines.at(-1)?.text, "... 7 more requests not listed");
  const m = Math.floor(T0 / MINUTE) * MINUTE;
  assert.equal(st.readSamples(w.db, "s1", m, m)[0]?.requests, REQUEST_LINES_PER_ROUND + 7);
});

test("each runs everything, a few at a time, and one that throws does not stop the others", async () => {
  let live = 0;
  let peak = 0;
  const done: number[] = [];
  await each([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    if (x === 4) throw new Error("no");
    done.push(x);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 5, 6, 7]);
});
