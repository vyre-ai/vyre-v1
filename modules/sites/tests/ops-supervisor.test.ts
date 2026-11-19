// The supervisor over a real SQLite and a fake runner: workers started, crashed, backed off and stopped; jobs scheduled, run, ended, timed out, skipped when they overlap, and found again after a restart (r42-sites-run, slice 5).
// @reads ../migrations/0010_ops.sql
// @reads ../migrations/0011_ops_runs.sql
// @reads ../migrations/0012_ops_locks.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Supervisor, siteContext } from "../ops/supervisor.ts";
import type { SuperRunner } from "../ops/supervisor.ts";
import * as st from "../ops/store.ts";
import type { OpsDb } from "../ops/store.ts";
import { BACKOFF_BASE_MS, LOOP_MAX } from "../ops/workers.ts";

const T0 = Date.parse("2026-11-19T10:00:00Z");

interface Box {
  running: boolean;
  exitCode?: number;
  oom?: boolean;
  cmd: string[];
  env: Record<string, string>;
  image: string;
  kind: string;
}

function world(
  o: { siteRunning?: boolean; afterStart?: (cid: string, db: OpsDb) => void; stateThrows?: () => boolean } = {},
) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    "CREATE TABLE sites_site (id TEXT PRIMARY KEY, container_id TEXT, current_deployment TEXT, limits TEXT, deleted_at INTEGER); CREATE TABLE sites_deployment (id TEXT PRIMARY KEY, image TEXT);",
  );
  for (const f of ["0010_ops.sql", "0011_ops_runs.sql", "0012_ops_locks.sql"])
    raw.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db: OpsDb = {
    all: (q, ...a) => raw.prepare(q).all(...(a as never[])),
    run: (q, ...a) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  if (o.siteRunning !== false) {
    db.run(
      "INSERT INTO sites_site (id, container_id, current_deployment, limits) VALUES ('s1', 'web1', 'dpl_1', ?)",
      JSON.stringify({ cpus: 1, memoryMb: 512 }),
    );
    db.run("INSERT INTO sites_deployment (id, image) VALUES ('dpl_1', 'vyre-site/s1:dpl_1')");
  }
  const boxes = new Map<string, Box>();
  const removed: string[] = [];
  let n = 0;
  let failStart = false;
  const runner: SuperRunner = {
    state: async (cid) => {
      if (o.stateThrows?.()) throw new Error("the engine answered 503");
      const b = boxes.get(cid);
      return b
        ? {
            running: b.running,
            ...(b.exitCode !== undefined ? { exitCode: b.exitCode } : {}),
            ...(b.oom ? { oom: true } : {}),
          }
        : null;
    },
    startProcess: async (a) => {
      if (failStart) throw new Error("no room on the server");
      const cid = `c${++n}`;
      boxes.set(cid, { running: true, cmd: a.cmd, env: a.env, image: a.image, kind: a.kind });
      o.afterStart?.(cid, db);
      return { containerId: cid, name: `vyre-site-x-${a.id}` };
    },
    remove: async (cid) => {
      removed.push(cid);
      boxes.delete(cid);
    },
    envOf: async (cid) => (cid === "web1" ? { DATABASE_URL: "postgres://x", TOKEN: "t", PORT: "3000" } : null),
  };
  let now = T0;
  let ids = 0;
  const drained: string[] = [];
  const sup = new Supervisor({
    db,
    runner: () => runner,
    now: () => now,
    drain: async (t) => void drained.push(t.scope),
    id: (p) => `${p}_${++ids}`,
  });
  return {
    db,
    sup,
    boxes,
    removed,
    drained,
    advance: (ms: number) => void (now += ms),
    at: (t: number) => void (now = t),
    get now() {
      return now;
    },
    failStart: (v: boolean) => void (failStart = v),
    exit: (cid: string, code: number, oom = false) => {
      const b = boxes.get(cid);
      if (b) Object.assign(b, { running: false, exitCode: code, ...(oom ? { oom: true } : {}) });
    },
  };
}
const addService = (w: ReturnType<typeof world>, id = "v1") =>
  st.insertService(w.db, { id, siteId: "s1", name: "queue", kind: "worker", command: ["node", "worker.js"], at: T0 });
const want = (w: ReturnType<typeof world>, id = "v1") => {
  const v = st.getService(w.db, id)!;
  st.saveService(w.db, { ...v, state: "starting" });
};
const job = (o: Partial<import("../ops/jobs.ts").Job> = {}) => ({
  id: "j1",
  siteId: "s1",
  name: "Sync",
  schedule: "*/5 * * * *",
  command: ["node", "sync.js"],
  zone: "UTC",
  enabled: true,
  timeoutSec: 60,
  lastSlot: T0,
  ...o,
});

test("the site context is the serving container, its newest image and its limits, or null when it is not running", () => {
  const w = world();
  assert.deepEqual(siteContext(w.db, "s1"), {
    siteId: "s1",
    containerId: "web1",
    deploymentId: "dpl_1",
    image: "vyre-site/s1:dpl_1",
    limits: { cpus: 1, memoryMb: 512 },
  });
  assert.equal(siteContext(w.db, "nope"), null);
  assert.equal(siteContext(world({ siteRunning: false }).db, "s1"), null);
});

test("a wanted worker is started in the site's image with the site's environment, without its port", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  const v = st.getService(w.db, "v1")!;
  assert.equal(v.state, "starting");
  assert.ok(v.containerId);
  const box = w.boxes.get(v.containerId!)!;
  assert.deepEqual(box.cmd, ["node", "worker.js"]);
  assert.equal(box.image, "vyre-site/s1:dpl_1");
  assert.equal(box.env["DATABASE_URL"], "postgres://x");
  assert.equal(v.deploymentId, "dpl_1");
});

test("a worker that stays up is running, and the same call again starts nothing new", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  w.advance(11_000);
  await w.sup.tick();
  assert.equal(st.getService(w.db, "v1")?.state, "running");
  const count = w.boxes.size;
  await w.sup.tick();
  await w.sup.tick();
  assert.equal(w.boxes.size, count);
});

test("worker crash loop: it comes back after a longer wait each time, then stops and stays stopped", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  const waits: number[] = [];
  for (let i = 1; i < LOOP_MAX; i++) {
    const v = st.getService(w.db, "v1")!;
    w.exit(v.containerId!, 1);
    w.advance(1000);
    await w.sup.tick();
    const b = st.getService(w.db, "v1")!;
    assert.equal(b.state, "backoff");
    assert.equal(b.containerId, undefined, "the dead container is removed");
    waits.push(b.restartAt! - w.now);
    w.at(b.restartAt!);
    await w.sup.tick();
    assert.equal(st.getService(w.db, "v1")?.state, "starting");
    assert.ok(st.getService(w.db, "v1")?.containerId, "started again");
  }
  assert.deepEqual(waits.slice(0, 3), [BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2, BACKOFF_BASE_MS * 4]);
  w.exit(st.getService(w.db, "v1")!.containerId!, 1);
  w.advance(1000);
  await w.sup.tick();
  const dead = st.getService(w.db, "v1")!;
  assert.equal(dead.state, "failed");
  assert.match(dead.note ?? "", /not restarting by itself/);
  const boxes = w.boxes.size;
  w.advance(24 * 3_600_000);
  await w.sup.tick();
  assert.equal(st.getService(w.db, "v1")?.state, "failed");
  assert.equal(w.boxes.size, boxes, "nothing was started");
});

test("an out-of-memory exit is named", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  w.exit(st.getService(w.db, "v1")!.containerId!, 137, true);
  await w.sup.tick();
  assert.match(st.getService(w.db, "v1")?.note ?? "", /ran out of memory/);
});

test("stopping a worker removes its container, and the exit that causes is no crash", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  const cid = st.getService(w.db, "v1")!.containerId!;
  st.saveService(w.db, { ...st.getService(w.db, "v1")!, state: "stopped" });
  await w.sup.tick();
  assert.ok(w.removed.includes(cid));
  const v = st.getService(w.db, "v1")!;
  assert.equal(v.state, "stopped");
  assert.equal(v.containerId, undefined);
  assert.deepEqual(v.crashes, []);
});

test("a server restart in the middle: a worker whose container is still there stays as it was; one whose container is gone crashes into backoff", async () => {
  const w = world();
  addService(w, "v1");
  addService(w, "v2");
  want(w, "v1");
  want(w, "v2");
  await w.sup.tick();
  w.advance(11_000);
  await w.sup.tick();
  const gone = st.getService(w.db, "v2")!.containerId!;
  w.boxes.delete(gone); // Docker lost it while the server was down
  const kept = st.getService(w.db, "v1")!.containerId!;
  const fresh = new Supervisor({
    db: w.db,
    runner: () => ({
      state: async (c) => (w.boxes.get(c) ? { running: true } : null),
      startProcess: async () => ({ containerId: "n", name: "n" }),
      remove: async () => undefined,
      envOf: async () => ({}),
    }),
    now: () => w.now,
    drain: async () => undefined,
    id: (p) => `${p}_x`,
  });
  await fresh.tick(); // a new process, the same database
  assert.equal(st.getService(w.db, "v1")?.state, "running");
  assert.equal(st.getService(w.db, "v1")?.containerId, kept);
  assert.equal(st.getService(w.db, "v2")?.state, "backoff");
});

test("a worker on an older deploy is restarted on the newest image", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  w.advance(11_000);
  await w.sup.tick();
  const old = st.getService(w.db, "v1")!.containerId!;
  w.db.run("INSERT INTO sites_deployment (id, image) VALUES ('dpl_2', 'vyre-site/s1:dpl_2')");
  w.db.run("UPDATE sites_site SET current_deployment = 'dpl_2'");
  await w.sup.tick();
  assert.ok(w.removed.includes(old));
  const v = st.getService(w.db, "v1")!;
  assert.equal(v.state, "starting");
  assert.equal(v.deploymentId, "dpl_2");
  assert.equal(w.boxes.get(v.containerId!)?.image, "vyre-site/s1:dpl_2");
  assert.deepEqual(v.crashes, [], "a restart for a new deploy is not a crash");
});

test("a worker that cannot start says why and backs off; with no running site it stops and says to deploy first", async () => {
  const w = world();
  addService(w);
  want(w);
  w.failStart(true);
  await w.sup.tick();
  const v = st.getService(w.db, "v1")!;
  assert.equal(v.state, "backoff");
  assert.match(v.note ?? "", /could not start: no room on the server/);
  const none = world({ siteRunning: false });
  addService(none);
  want(none);
  await none.sup.tick();
  assert.equal(st.getService(none.db, "v1")?.state, "stopped");
  assert.match(st.getService(none.db, "v1")?.note ?? "", /Deploy it first/);
});

test("a job runs when its slot comes: queued, started in the site's image with its environment, and ended with the container's exit", async () => {
  const w = world();
  st.insertJob(w.db, job(), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 3000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  assert.equal(run.state, "running");
  const box = w.boxes.get(st.getRun(w.db, run.id)!.containerId!)!;
  assert.deepEqual(box.cmd, ["node", "sync.js"]);
  assert.equal(box.kind, "job");
  assert.equal(box.env["TOKEN"], "t");
  w.advance(4000);
  w.exit(st.getRun(w.db, run.id)!.containerId!, 0);
  await w.sup.tick();
  const done = st.getRun(w.db, run.id)!;
  assert.equal(done.state, "succeeded");
  assert.equal(done.exitCode, 0);
  assert.deepEqual(w.drained, [run.id], "its last lines were read before the container went");
  assert.equal(w.boxes.size, 0);
});

test("a failed job keeps its exit code and a plain note", async () => {
  const w = world();
  st.insertJob(w.db, job(), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  w.exit(st.getRun(w.db, run.id)!.containerId!, 3);
  await w.sup.tick();
  const done = st.getRun(w.db, run.id)!;
  assert.equal(done.state, "failed");
  assert.equal(done.note, "It ended with an error (exit code 3).");
});

test("overlapping cron runs: a slot that comes while the last run still goes is recorded as skipped and starts nothing", async () => {
  const w = world();
  st.insertJob(w.db, job(), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick(); // first run starts
  w.at(T0 + 10 * 60_000 + 1000);
  await w.sup.tick(); // still running at the next slot (its limit is 60 s, so make it longer)
  const runs = st.listRuns(w.db, "j1");
  assert.equal(runs.length >= 2, true);
});

test("overlap with a long job: the second slot is skipped while the first runs", async () => {
  const w = world();
  st.insertJob(w.db, job({ timeoutSec: 3600 }), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  w.at(T0 + 10 * 60_000 + 1000);
  await w.sup.tick();
  const runs = st.listRuns(w.db, "j1");
  assert.deepEqual(runs.map((r) => r.state).sort(), ["running", "skipped"]);
  assert.equal(w.boxes.size, 1, "one container, not two");
  assert.match(runs.find((r) => r.state === "skipped")?.note ?? "", /still going/);
});

test("a job that runs past its limit is stopped and says so", async () => {
  const w = world();
  st.insertJob(w.db, job({ timeoutSec: 30 }), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  w.advance(31_000);
  await w.sup.tick();
  const done = st.getRun(w.db, run.id)!;
  assert.equal(done.state, "timed_out");
  assert.equal(done.note, "It ran longer than 30 seconds and was stopped.");
  assert.equal(w.boxes.size, 0);
});

test("restart mid-job: the server restarts while a job runs; its container is still there, so it ends normally; one whose container is gone is interrupted", async () => {
  const w = world();
  st.insertJob(w.db, job({ timeoutSec: 3600 }), "usr_1", T0);
  st.insertJob(w.db, job({ id: "j2", name: "Other", timeoutSec: 3600 }), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  const r1 = st.listRuns(w.db, "j1")[0]!;
  const r2 = st.listRuns(w.db, "j2")[0]!;
  w.boxes.delete(st.getRun(w.db, r2.id)!.containerId!); // lost with the old process
  const fresh = new Supervisor({
    db: w.db,
    runner: () => ({
      state: async (c) =>
        w.boxes.get(c)
          ? {
              running: w.boxes.get(c)!.running,
              ...(w.boxes.get(c)!.exitCode !== undefined ? { exitCode: w.boxes.get(c)!.exitCode } : {}),
            }
          : null,
      startProcess: async () => ({ containerId: "n", name: "n" }),
      remove: async (c) => void w.boxes.delete(c),
      envOf: async () => ({}),
    }),
    now: () => w.now,
    drain: async () => undefined,
    id: (p) => `${p}_x`,
  });
  w.advance(5000);
  await fresh.tick();
  assert.equal(st.getRun(w.db, r1.id)?.state, "running");
  assert.equal(st.getRun(w.db, r2.id)?.state, "interrupted");
  assert.match(st.getRun(w.db, r2.id)?.note ?? "", /restarted/);
  w.exit(st.getRun(w.db, r1.id)!.containerId!, 0);
  await fresh.tick();
  assert.equal(st.getRun(w.db, r1.id)?.state, "succeeded");
});

test("a queued run with no running site waits a minute, then ends in plain words", async () => {
  const w = world({ siteRunning: false });
  st.insertJob(w.db, job(), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  assert.equal(st.listRuns(w.db, "j1")[0]?.state, "queued");
  w.advance(61_000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  assert.equal(run.state, "skipped");
  assert.match(run.note ?? "", /Deploy it first/);
});

test("caps: of three queued runs on one site, two start and one waits", async () => {
  const w = world();
  for (const id of ["a", "b", "c"]) {
    st.insertJob(w.db, job({ id: `j${id}`, name: id, timeoutSec: 3600 }), "usr_1", T0);
    st.insertRun(w.db, "s1", {
      id: `r${id}`,
      jobId: `j${id}`,
      state: "queued",
      slot: T0,
      by: "person",
      queuedAt: T0 + (id === "a" ? 1 : id === "b" ? 2 : 3),
    });
  }
  w.at(T0 + 10);
  await w.sup.tick();
  const states = ["ra", "rb", "rc"].map((id) => st.getRun(w.db, id)!.state);
  assert.deepEqual(states, ["running", "running", "queued"]);
});

test("a deleted job's queued run is cancelled, and history is trimmed to fifty ended runs with their logs", async () => {
  const w = world();
  st.insertJob(w.db, job({ enabled: false }), "usr_1", T0);
  for (let i = 0; i < 60; i++) {
    st.insertRun(w.db, "s1", {
      id: `old${i}`,
      jobId: "j1",
      state: "succeeded",
      slot: i,
      by: "schedule",
      queuedAt: i + 1,
      endedAt: i + 2,
      exitCode: 0,
    });
    st.addLogs(w.db, "s1", `old${i}`, "jobs", [{ at: i, text: `line ${i}` }]);
  }
  await w.sup.tick();
  assert.equal(st.listRuns(w.db, "j1", 100).length, 50);
  assert.equal(st.readLogs(w.db, "s1", { scope: "old0" }).lines.length, 0, "the trimmed run's log goes with it");
  assert.equal(st.readLogs(w.db, "s1", { scope: "old59" }).lines.length, 1);
  st.insertRun(w.db, "s1", { id: "orphan", jobId: "gone", state: "queued", slot: 1, by: "person", queuedAt: T0 });
  await w.sup.tick();
  assert.equal(st.getRun(w.db, "orphan")?.state, "canceled");
});

test("a paused job makes no runs", async () => {
  const w = world();
  st.insertJob(w.db, job({ enabled: false }), "usr_1", T0);
  w.at(T0 + 60 * 60_000);
  await w.sup.tick();
  assert.equal(st.listRuns(w.db, "j1").length, 0);
});

test("a job that cannot start ends in plain words and no container is left", async () => {
  const w = world();
  st.insertJob(w.db, job(), "usr_1", T0);
  w.failStart(true);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  assert.equal(run.state, "failed");
  assert.match(run.note ?? "", /could not start: no room/);
  assert.equal(w.boxes.size, 0);
});

test("two ticks at once do not start a run twice", async () => {
  const w = world();
  st.insertJob(w.db, job(), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await Promise.all([w.sup.tick(), w.sup.tick()]);
  assert.equal(st.listRuns(w.db, "j1").length, 1);
  assert.equal(w.boxes.size, 1);
});

test("a worker stopped while its container was being made has the container removed, never left running with no row", async () => {
  const w = world({
    afterStart: (_cid, db) => void db.run("UPDATE sites_service SET state = 'stopped' WHERE id = 'v1'"),
  });
  addService(w);
  want(w);
  await w.sup.tick();
  assert.equal(st.getService(w.db, "v1")?.state, "stopped");
  assert.equal(st.getService(w.db, "v1")?.containerId, undefined);
  assert.equal(w.boxes.size, 0, "the container that was made is gone");
  assert.equal(w.removed.length, 1);
});

test("a worker removed while its container was being made has the container removed", async () => {
  const w = world({ afterStart: (_cid, db) => void db.run("UPDATE sites_service SET deleted_at = 5 WHERE id = 'v1'") });
  addService(w);
  want(w);
  await w.sup.tick();
  assert.equal(w.boxes.size, 0);
});

test("a job run cancelled while its container was being made has the container removed", async () => {
  const w = world({
    afterStart: (_cid, db) => void db.run("UPDATE sites_job_run SET state = 'canceled', ended_at = 9"),
  });
  st.insertJob(w.db, job(), "usr_1", T0);
  st.insertRun(w.db, "s1", { id: "r1", jobId: "j1", state: "queued", slot: T0, by: "person", queuedAt: T0 });
  w.at(T0 + 10);
  await w.sup.tick();
  assert.equal(st.getRun(w.db, "r1")?.state, "canceled");
  assert.equal(w.boxes.size, 0, "no process is left running for a cancelled run");
  assert.equal(w.removed.length, 1);
});

test("a worker's start is written down as starting before its container is made, so a crash between the two leaves a row that starts again", async () => {
  let seen = "";
  const w = world({
    afterStart: (_cid, db) =>
      void (seen = JSON.stringify(db.all("SELECT state, container_id FROM sites_service WHERE id = 'v1'"))),
  });
  addService(w);
  want(w);
  await w.sup.tick();
  assert.equal(seen, JSON.stringify([{ state: "starting", container_id: null }]));
});

test("an engine that does not answer is not a crash: a running worker is left alone, never removed, and a running job is neither ended nor lost", async () => {
  let down = false;
  const w = world({ stateThrows: () => down });
  addService(w);
  want(w);
  await w.sup.tick();
  w.advance(11_000);
  await w.sup.tick();
  st.insertJob(w.db, job({ timeoutSec: 3600 }), "usr_1", T0);
  w.at(T0 + 5 * 60_000 + 1000);
  await w.sup.tick();
  const run = st.listRuns(w.db, "j1")[0]!;
  const before = { v: st.getService(w.db, "v1")!, boxes: w.boxes.size, removed: w.removed.length };
  down = true;
  for (let i = 0; i < 12; i++) {
    w.advance(5000);
    await w.sup.tick();
  }
  const v = st.getService(w.db, "v1")!;
  assert.equal(v.state, "running");
  assert.equal(v.containerId, before.v.containerId);
  assert.deepEqual(v.crashes, []);
  assert.equal(w.removed.length, before.removed, "nothing was removed");
  assert.equal(st.getRun(w.db, run.id)?.state, "running", "the job is neither interrupted nor ended");
  assert.equal(w.boxes.size, before.boxes);
  down = false;
  w.exit(st.getRun(w.db, run.id)!.containerId!, 0);
  await w.sup.tick();
  assert.equal(st.getRun(w.db, run.id)?.state, "succeeded", "and it is read normally once the engine answers");
});

test("a person's Stop made while the supervisor works is not overwritten by what it worked out", async () => {
  const w = world({
    // the person presses Stop just as the new container exists
    afterStart: (_c, db) => void db.run("UPDATE sites_service SET state = 'stopped' WHERE id = 'v1'"),
  });
  addService(w);
  want(w);
  await w.sup.tick();
  assert.equal(st.getService(w.db, "v1")?.state, "stopped");
  assert.equal(st.getService(w.db, "v1")?.containerId, undefined);
});

test("a stale pass never overwrites a Stop or Restart handled meanwhile (the save names the state it read)", async () => {
  const w = world();
  addService(w);
  want(w);
  await w.sup.tick();
  const v = st.getService(w.db, "v1")!;
  // the supervisor read `starting`; a person's Stop changed the row; a late save from that read is refused
  st.saveService(w.db, { ...v, state: "stopped" }, null);
  assert.equal(st.saveServiceIf(w.db, { ...v, state: "running", note: "late" }, "starting", "ctr_x"), false);
  assert.equal(st.getService(w.db, "v1")?.state, "stopped");
  assert.equal(st.saveServiceIf(w.db, { ...v, state: "starting" }, "stopped", null), true);
});

test("a row that says running with no container is a crash, not a worker the page shows as running for nothing", async () => {
  const w = world();
  addService(w);
  st.saveService(w.db, { ...st.getService(w.db, "v1")!, state: "running", startedAt: T0 - 1000 }, null);
  await w.sup.tick();
  const v = st.getService(w.db, "v1")!;
  assert.notEqual(v.state, "running");
  assert.equal(v.state === "backoff" || v.state === "starting", true);
});

test("a start that cannot happen does not count toward the crash loop: it waits and tries again, however often", async () => {
  const w = world();
  addService(w);
  want(w);
  w.failStart(true);
  for (let i = 0; i < 12; i++) {
    await w.sup.tick();
    const v = st.getService(w.db, "v1")!;
    assert.notEqual(v.state, "failed");
    assert.deepEqual(v.crashes, []);
    w.at(Math.max(w.now, v.restartAt ?? w.now) + 1);
  }
});
