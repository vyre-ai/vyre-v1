// The supervisor: restart policy, backoff, giving up, manual restart, child-process units. And the scheduler: due jobs, no overlap, failures counted, daily times.
import test from "node:test";
import assert from "node:assert/strict";
import { Supervisor, processUnit } from "../src/supervisor/index.ts";
import type { RunningUnit, ServiceStatus, UnitExit } from "../src/supervisor/index.ts";
import { Scheduler, nextDaily } from "../src/scheduler/index.ts";

/** A unit the test can crash by hand. */
function fakeUnit() {
  let crash!: (x: UnitExit) => void;
  const exited = new Promise<UnitExit>((r) => { crash = r; });
  let stops = 0;
  const unit: RunningUnit = { exited, stop: () => { stops++; crash({ code: 0 }); return Promise.resolve(); } };
  return { unit, crash, stops: () => stops };
}

function rig(policy = { maxRestarts: 3, windowMs: 60_000, backoffMs: [10, 20] as readonly number[] }) {
  let t = 1_000_000;
  const reports: ServiceStatus[] = [];
  const waits: number[] = [];
  const units: ReturnType<typeof fakeUnit>[] = [];
  const sup = new Supervisor({ now: () => t, sleep: (ms) => { waits.push(ms); t += ms; return Promise.resolve(); }, report: (s) => reports.push(s) });
  sup.add({ name: "svc", policy, start: () => { const u = fakeUnit(); units.push(u); return Promise.resolve(u.unit); } });
  const settle = async (): Promise<void> => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  return { sup, reports, waits, units, settle, tick: (ms: number) => { t += ms; } };
}

test("a crashed service is restarted after the first backoff and counted", async () => {
  const r = rig();
  await r.sup.start("svc");
  assert.equal(r.sup.status("svc")[0]?.state, "healthy");
  r.units[0]!.crash({ code: 1 });
  await r.settle();
  const s = r.sup.status("svc")[0]!;
  assert.equal(s.phase, "running");
  assert.equal(s.restarts, 1);
  assert.deepEqual(r.waits, [10]);
  assert.equal(r.units.length, 2);
  assert.deepEqual(s.lastExit, { code: 1 });
  assert.ok(r.reports.some((x) => x.phase === "backoff" && x.state === "degraded"), "backoff is reported as degraded");
});

test("backoff grows along the list and the last value repeats", async () => {
  const r = rig({ maxRestarts: 10, windowMs: 60_000, backoffMs: [10, 20] });
  await r.sup.start("svc");
  for (let i = 0; i < 4; i++) { r.units[i]!.crash({ code: 1 }); await r.settle(); }
  assert.deepEqual(r.waits, [10, 20, 20, 20]);
  assert.equal(r.sup.status("svc")[0]?.restarts, 4);
});

test("more crashes than maxRestarts inside the window marks the service failed and stops restarting", async () => {
  const r = rig({ maxRestarts: 2, windowMs: 60_000, backoffMs: [1] });
  await r.sup.start("svc");
  for (let i = 0; i < 3; i++) { r.units[i]!.crash({ error: "boom" }); await r.settle(); }
  const s = r.sup.status("svc")[0]!;
  assert.equal(s.phase, "failed");
  assert.equal(s.state, "down");
  assert.equal(r.units.length, 3, "no fourth start");
  assert.equal(s.lastExit?.error, "boom");
});

test("crashes outside the window do not count", async () => {
  const r = rig({ maxRestarts: 1, windowMs: 1000, backoffMs: [1] });
  await r.sup.start("svc");
  r.units[0]!.crash({ code: 1 }); await r.settle();
  r.tick(5000);
  r.units[1]!.crash({ code: 1 }); await r.settle();
  assert.equal(r.sup.status("svc")[0]?.phase, "running", "the first crash aged out");
});

test("a start that throws goes through the same policy", async () => {
  let n = 0;
  const sup = new Supervisor({ sleep: () => Promise.resolve() });
  sup.add({ name: "flaky", policy: { maxRestarts: 5, windowMs: 60_000, backoffMs: [1] }, start: () => { n++; return n < 3 ? Promise.reject(new Error("port busy")) : Promise.resolve({ exited: new Promise<UnitExit>(() => {}), stop: () => Promise.resolve() }); } });
  await sup.start("flaky");
  for (let i = 0; i < 100; i++) await Promise.resolve();
  const s = sup.status("flaky")[0]!;
  assert.equal(s.phase, "running");
  assert.equal(s.restarts, 2);
  assert.equal(n, 3);
});

test("stop keeps a service stopped; restart stops, starts, counts and clears the crash history", async () => {
  const r = rig({ maxRestarts: 1, windowMs: 60_000, backoffMs: [1] });
  await r.sup.start("svc");
  await r.sup.stop("svc");
  await r.settle();
  assert.equal(r.sup.status("svc")[0]?.phase, "stopped");
  assert.equal(r.units.length, 1, "stopping is not a crash: no restart");
  assert.equal(r.units[0]!.stops(), 1);
  const s = await r.sup.restart("svc");
  assert.equal(s.phase, "running");
  assert.equal(s.restarts, 1);
  assert.equal(r.units.length, 2);
  // after a manual restart the history is clear, so one crash is within the allowance again
  r.units[1]!.crash({ code: 1 }); await r.settle();
  assert.equal(r.sup.status("svc")[0]?.phase, "running");
});

test("restarting a running service stops the old unit exactly once", async () => {
  const r = rig();
  await r.sup.start("svc");
  await r.sup.restart("svc");
  assert.equal(r.units[0]!.stops(), 1);
  assert.equal(r.units.length, 2);
  assert.equal(r.sup.status("svc")[0]?.restarts, 1);
});

test("unknown services are refused; stopAll stops in reverse order", async () => {
  const sup = new Supervisor();
  const order: string[] = [];
  for (const name of ["a", "b"]) sup.add({ name, start: () => Promise.resolve({ exited: new Promise<UnitExit>(() => {}), stop: () => { order.push(name); return Promise.resolve(); } }) });
  await sup.startAll();
  await assert.rejects(() => sup.start("nope"), /no such service/);
  assert.throws(() => sup.add({ name: "a", start: () => Promise.reject(new Error("x")) }), /already registered/);
  await sup.stopAll();
  assert.deepEqual(order, ["b", "a"]);
});

test("processUnit runs a real child, reports its exit, and stop() ends it", async () => {
  const start = processUnit(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const unit = await start();
  let ended = false;
  void unit.exited.then(() => { ended = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ended, false, "still running");
  await unit.stop();
  const x = await unit.exited;
  assert.ok(x.signal === "SIGTERM" || x.code !== undefined);
  const quick = await processUnit(process.execPath, ["-e", "process.exit(3)"])();
  assert.equal((await quick.exited).code, 3);
});

test("processUnit rejects when the program does not exist", async () => {
  await assert.rejects(() => processUnit("/no/such/program-vyre", [])());
});

// ---- scheduler

test("a job runs when due, not before, and again after its interval", async () => {
  let t = 0, runs = 0;
  const s = new Scheduler({ now: () => t });
  s.add({ name: "j", schedule: { everyMs: 1000 }, run: () => { runs++; } });
  await s.tick();
  assert.equal(runs, 0);
  t = 1000; await s.tick();
  assert.equal(runs, 1);
  t = 1500; await s.tick();
  assert.equal(runs, 1);
  t = 2000; await s.tick();
  assert.equal(runs, 2);
  assert.equal(s.lastTickAt, 2000);
  const st = s.status()[0]!;
  assert.equal(st.runs, 2);
  assert.equal(st.nextAt, 3000);
});

test("scheduler start runs immediate jobs once without waiting for a long interval", async () => {
  let immediate = 0, deferred = 0;
  const s = new Scheduler({ tickMs: 86_400_000 });
  s.add({ name: "immediate", schedule: { everyMs: 86_400_000, immediate: true }, run: () => { immediate++; } });
  s.add({ name: "deferred", schedule: { everyMs: 86_400_000 }, run: () => { deferred++; } });
  await s.start();
  assert.equal(immediate, 1);
  assert.equal(deferred, 0);
  await s.stop();
});

test("scheduler start waits for an immediate async job to finish", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let finished = false;
  const s = new Scheduler({ tickMs: 86_400_000 });
  s.add({ name: "gated", schedule: { everyMs: 86_400_000, immediate: true }, run: async () => { await gate; finished = true; } });
  const started = s.start();
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await started;
  assert.equal(finished, true);
  await s.stop();
});

test("immediate jobs run on the first tick", async () => {
  let runs = 0;
  const s = new Scheduler({ now: () => 5 });
  s.add({ name: "j", schedule: { everyMs: 60_000, immediate: true }, run: () => { runs++; } });
  await s.tick();
  assert.equal(runs, 1);
});

test("a job never overlaps itself: a tick while it runs is counted as skipped", async () => {
  let t = 0, runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const s = new Scheduler({ now: () => t });
  s.add({ name: "slow", schedule: { everyMs: 10 }, run: async () => { runs++; await gate; } });
  t = 10; const first = s.tick();
  await Promise.resolve();
  t = 20; await s.tick();
  assert.equal(runs, 1);
  assert.equal(s.status()[0]?.skipped, 1);
  assert.equal(s.status()[0]?.running, true);
  release(); await first;
  assert.equal(s.status()[0]?.running, false);
});

test("a failing job is counted and reported and the other jobs still run", async () => {
  let t = 0, ok = 0;
  const seen: { job: string; ok: boolean; error?: string }[] = [];
  const s = new Scheduler({ now: () => t, onRun: (r) => seen.push(r) });
  s.add({ name: "bad", schedule: { everyMs: 1 }, run: () => { throw new Error("disk full"); } });
  s.add({ name: "good", schedule: { everyMs: 1 }, run: () => { ok++; } });
  t = 1; await s.tick();
  assert.equal(ok, 1);
  const bad = s.status().find((j) => j.name === "bad")!;
  assert.equal(bad.failures, 1);
  assert.equal(bad.lastError, "disk full");
  assert.deepEqual(seen.map((x) => [x.job, x.ok]), [["bad", false], ["good", true]]);
  assert.equal(seen[0]?.error, "disk full");
});

test("daily jobs run at the next hh:mm and then every day", async () => {
  const noon = Date.UTC(2026, 9, 25, 12, 0, 0);
  assert.equal(nextDaily(noon, 4, 0, true), Date.UTC(2026, 9, 26, 4, 0, 0), "04:00 UTC has passed today, so tomorrow");
  assert.equal(nextDaily(noon, 18, 30, true), Date.UTC(2026, 9, 25, 18, 30, 0));
  assert.equal(nextDaily(Date.UTC(2026, 9, 25, 18, 30, 0), 18, 30, true), Date.UTC(2026, 9, 26, 18, 30, 0), "exactly at the time means the next one");
  let t = noon, runs = 0;
  const s = new Scheduler({ now: () => t });
  s.add({ name: "d", schedule: { daily: { hour: 18, minute: 30 }, utc: true }, run: () => { runs++; } });
  t = Date.UTC(2026, 9, 25, 18, 29, 59); await s.tick();
  assert.equal(runs, 0);
  t = Date.UTC(2026, 9, 25, 18, 30, 1); await s.tick();
  assert.equal(runs, 1);
  t = Date.UTC(2026, 9, 25, 23, 0, 0); await s.tick();
  assert.equal(runs, 1);
  t = Date.UTC(2026, 9, 26, 18, 30, 2); await s.tick();
  assert.equal(runs, 2);
});

test("start() ticks on a timer and stop() waits for running jobs; duplicate names and zero intervals are refused", async () => {
  const s = new Scheduler({ tickMs: 5 });
  let runs = 0;
  s.add({ name: "j", schedule: { everyMs: 1, immediate: true }, run: async () => { runs++; await new Promise((r) => setTimeout(r, 20)); } });
  assert.throws(() => s.add({ name: "j", schedule: { everyMs: 1 }, run: () => {} }), /already scheduled/);
  assert.throws(() => s.add({ name: "z", schedule: { everyMs: 0 }, run: () => {} }), /at least 1/);
  s.start();
  assert.notEqual(s.lastTickAt, null);
  await new Promise((r) => setTimeout(r, 40));
  await s.stop();
  assert.ok(runs >= 1);
  assert.equal(s.status()[0]?.running, false);
  const after = runs;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(runs, after, "stopped means stopped");
});
