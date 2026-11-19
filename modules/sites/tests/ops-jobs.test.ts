// Scheduled jobs: every transition of a run, the tick (overlap, catch-up, pause), the caps, recovery after a restart, history pruning (r42-sites-run, slice 5).
import test from "node:test";
import assert from "node:assert/strict";
import { CATCH_UP_MS, ENDED, KEEP_RUNS, NOTE, QUEUE_MAX_MS, RUN_CAPS, checkJob, isEnded, prune, recover, resume, runNow, startable, step, tick } from "../ops/jobs.ts";
import type { Job, Run, RunEvent, RunState } from "../ops/jobs.ts";
import { validZone } from "../ops/cron.ts";

const at = (iso: string): number => Date.parse(iso);
const job = (o: Partial<Job> = {}): Job => ({ id: "j1", siteId: "s1", name: "Nightly", schedule: "*/5 * * * *", command: ["node", "job.js"], zone: "UTC", enabled: true, timeoutSec: 60, lastSlot: at("2026-11-19T10:00:00Z"), ...o });
const run = (state: RunState, o: Partial<Run> = {}): Run => ({ id: "r1", jobId: "j1", state, slot: 1, by: "schedule", queuedAt: 1000, ...o });

const EVENTS: RunEvent[] = [
  { t: "start", at: 5 },
  { t: "finish", at: 5, code: 0 },
  { t: "finish", at: 5, code: 3 },
  { t: "timeout", at: 5 },
  { t: "cancel", at: 5 },
  { t: "lost", at: 5 },
  { t: "expire", at: 5 },
];
const name = (e: RunEvent): string => (e.t === "finish" ? `finish(${e.code})` : e.t);
// the expected state after each event, for every state a run can be in; "-" means refused, "=" means accepted with no change
const TABLE: Record<RunState, Record<string, string>> = {
  queued: { start: "running", "finish(0)": "-", "finish(3)": "-", timeout: "-", cancel: "canceled", lost: "=", expire: "skipped" },
  running: { start: "=", "finish(0)": "succeeded", "finish(3)": "failed", timeout: "timed_out", cancel: "canceled", lost: "interrupted", expire: "-" },
  succeeded: { start: "-", "finish(0)": "=", "finish(3)": "-", timeout: "-", cancel: "-", lost: "-", expire: "-" },
  failed: { start: "-", "finish(0)": "-", "finish(3)": "=", timeout: "-", cancel: "-", lost: "-", expire: "-" },
  timed_out: { start: "-", "finish(0)": "-", "finish(3)": "-", timeout: "=", cancel: "-", lost: "-", expire: "-" },
  canceled: { start: "-", "finish(0)": "-", "finish(3)": "-", timeout: "-", cancel: "=", lost: "-", expire: "-" },
  skipped: { start: "-", "finish(0)": "-", "finish(3)": "-", timeout: "-", cancel: "-", lost: "-", expire: "=" },
  interrupted: { start: "-", "finish(0)": "-", "finish(3)": "-", timeout: "-", cancel: "-", lost: "=", expire: "-" },
};

for (const [from, row] of Object.entries(TABLE) as [RunState, Record<string, string>][])
  for (const ev of EVENTS)
    test(`run ${from} + ${name(ev)}`, () => {
      const r = step(run(from), ev, { timeoutSec: 60 });
      const want = row[name(ev)];
      if (want === "-") assert.equal(r.ok, false);
      else {
        assert.equal(r.ok, true);
        if (r.ok) {
          if (want === "=") assert.equal(r.run.state, from);
          else assert.equal(r.run.state, want);
          assert.equal(r.same, want === "=");
        }
      }
    });

test("the ended states are exactly the six that end", () => {
  assert.deepEqual([...ENDED].sort(), ["canceled", "failed", "interrupted", "skipped", "succeeded", "timed_out"]);
  assert.equal(isEnded("running"), false);
});

test("an ended run keeps its record: times, exit code and a plain note", () => {
  const f = step(run("running", { startedAt: 2 }), { t: "finish", at: 9, code: 7 }, { timeoutSec: 60 });
  assert.equal(f.ok && f.run.endedAt, 9);
  assert.equal(f.ok && f.run.exitCode, 7);
  assert.equal(f.ok && f.run.note, NOTE.failed(7));
  const t = step(run("running"), { t: "timeout", at: 9 }, { timeoutSec: 90 });
  assert.equal(t.ok && t.run.note, "It ran longer than 90 seconds and was stopped.");
  const ok = step(run("running"), { t: "finish", at: 9, code: 0 }, { timeoutSec: 60 });
  assert.equal(ok.ok && ok.run.note, undefined);
});

test("the tick starts a run when a slot passed, once, and moves past it", () => {
  const j = job();
  const out = tick(j, [], at("2026-11-19T10:05:20Z"));
  assert.deepEqual(out.create, { state: "queued", slot: at("2026-11-19T10:05:00Z") });
  assert.equal(out.job.lastSlot, at("2026-11-19T10:05:00Z"));
  assert.equal(out.nextAt, at("2026-11-19T10:10:00Z"));
  const again = tick(out.job, [], at("2026-11-19T10:05:50Z"));
  assert.equal(again.create, null);
});

test("overlapping cron runs: a slot that comes while the last run goes is recorded as skipped, never run twice", () => {
  const j = job();
  const going = [run("running", { slot: at("2026-11-19T10:05:00Z") })];
  const out = tick(j, going, at("2026-11-19T10:10:01Z"));
  assert.deepEqual(out.create, { state: "skipped", slot: at("2026-11-19T10:10:00Z"), note: NOTE.skipped });
  assert.equal(out.job.lastSlot, at("2026-11-19T10:10:00Z"));
  // a queued run counts as going too
  assert.equal(tick(j, [run("queued")], at("2026-11-19T10:10:01Z")).create?.state, "skipped");
  // an ended one does not
  assert.equal(tick(j, [run("failed")], at("2026-11-19T10:10:01Z")).create?.state, "queued");
  // another job's run does not
  assert.equal(tick(j, [run("running", { jobId: "other" })], at("2026-11-19T10:10:01Z")).create?.state, "queued");
});

test("after downtime the latest missed slot runs once, not every one", () => {
  const j = job({ lastSlot: at("2026-11-19T10:00:00Z") });
  const out = tick(j, [], at("2026-11-19T10:42:00Z")); // 8 slots passed
  assert.equal(out.create?.slot, at("2026-11-19T10:40:00Z"));
  assert.equal(tick(out.job, [], at("2026-11-19T10:42:30Z")).create, null);
});

test("after a long stop the slot older than the catch-up window is dropped", () => {
  const j = job({ schedule: "0 3 * * *", lastSlot: at("2026-11-17T03:00:00Z") });
  const out = tick(j, [], at("2026-11-19T10:00:00Z")); // the 03:00 of the 18th and 19th both passed more than an hour ago
  assert.equal(out.create, null);
  assert.ok(CATCH_UP_MS === 3_600_000);
  const near = tick(j, [], at("2026-11-19T03:20:00Z"));
  assert.equal(near.create?.slot, at("2026-11-19T03:00:00Z"));
});

test("a job never ticked starts from now; a paused job makes nothing, and resuming does not run what was missed", () => {
  const fresh = tick(job({ lastSlot: 0 }), [], at("2026-11-19T10:07:30Z"));
  assert.equal(fresh.create, null);
  assert.equal(fresh.job.lastSlot, at("2026-11-19T10:07:00Z"));
  const paused = tick(job({ enabled: false }), [], at("2026-11-19T11:00:00Z"));
  assert.equal(paused.create, null);
  assert.equal(paused.nextAt, null);
  const back = resume(job({ enabled: false }), at("2026-11-19T11:00:10Z"));
  assert.equal(back.enabled, true);
  assert.equal(tick(back, [], at("2026-11-19T11:00:40Z")).create, null);
});

test("a schedule that cannot be read makes nothing", () => {
  assert.equal(tick(job({ schedule: "nope" }), [], at("2026-11-19T11:00:00Z")).create, null);
});

test("Run now is refused while a run goes", () => {
  assert.equal(runNow(job(), [run("running")], 5).ok, false);
  assert.equal(runNow(job(), [run("queued")], 5).ok, false);
  assert.deepEqual(runNow(job(), [run("succeeded")], 5), { ok: true, slot: 5 });
});

test("caps: two per site and four on the server, oldest first, and a full site does not block another", () => {
  const q = (id: string, siteId: string, queuedAt: number) => ({ run: run("queued", { id, queuedAt }), siteId });
  assert.deepEqual(startable([q("a", "s1", 1), q("b", "s1", 2), q("c", "s1", 3)], [], RUN_CAPS), ["a", "b"]);
  assert.deepEqual(startable([q("a", "s1", 1), q("b", "s2", 2)], [{ siteId: "s1" }, { siteId: "s1" }], RUN_CAPS), ["b"]);
  const four = [{ siteId: "x" }, { siteId: "y" }, { siteId: "z" }, { siteId: "w" }];
  assert.deepEqual(startable([q("a", "s1", 1)], four, RUN_CAPS), []);
  assert.deepEqual(startable([q("late", "s1", 9), q("early", "s2", 1)], [{ siteId: "x" }, { siteId: "y" }, { siteId: "z" }], RUN_CAPS), ["early"]);
});

test("restart mid-job: a running run is lost, a stale queued run expires, a fresh queued run waits", () => {
  const now = 10 * QUEUE_MAX_MS;
  const out = recover(
    [run("running", { id: "a" }), run("queued", { id: "b", queuedAt: now - QUEUE_MAX_MS - 1 }), run("queued", { id: "c", queuedAt: now - 1000 }), run("succeeded", { id: "d" })],
    now,
  );
  assert.deepEqual(out, [
    { id: "a", ev: { t: "lost", at: now } },
    { id: "b", ev: { t: "expire", at: now } },
  ]);
  // and the events do what the table says
  const lost = step(run("running"), out[0]!.ev, { timeoutSec: 60 });
  assert.equal(lost.ok && lost.run.state, "interrupted");
  assert.equal(lost.ok && lost.run.note, NOTE.interrupted);
  const again = step(lost.ok ? lost.run : run("running"), out[0]!.ev, { timeoutSec: 60 });
  assert.equal(again.ok && again.same, true); // recovering twice is harmless
});

test("history keeps the newest fifty ended runs and never deletes one that is not ended", () => {
  const runs: Run[] = [];
  for (let i = 0; i < KEEP_RUNS + 5; i++) runs.push(run("succeeded", { id: `r${i}`, queuedAt: i }));
  runs.push(run("running", { id: "live", queuedAt: -100 }));
  const gone = prune(runs);
  assert.equal(gone.length, 5);
  assert.deepEqual([...gone].sort(), ["r0", "r1", "r2", "r3", "r4"]);
  assert.equal(gone.includes("live"), false);
});

test("a job a person wrote is checked in plain words", () => {
  const ok = { schedule: "0 * * * *", command: ["node", "x.js"], timeoutSec: 60, zone: "UTC" };
  assert.equal(checkJob(ok, validZone), null);
  assert.match(checkJob({ ...ok, schedule: "x" }, validZone) ?? "", /five parts/);
  assert.equal(checkJob({ ...ok, command: [] }, validZone), "Give the command to run.");
  assert.equal(checkJob({ ...ok, command: ["a", ""] }, validZone), "Give the command to run.");
  assert.match(checkJob({ ...ok, timeoutSec: 1 }, validZone) ?? "", /between 5 seconds/);
  assert.match(checkJob({ ...ok, zone: "Mars/Base" }, validZone) ?? "", /time zone/);
});
