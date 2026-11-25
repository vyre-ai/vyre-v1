// A job that does work "once per start" must remember that per Space, not per database handle: a scheduled job gets a new handle on every run, so a memory kept per handle never hit and the job did its
// first-run work at every tick (24 Nov 2026: the project folder sweep did 40 whole-view rebuilds every ten minutes on a Meier-sized Space; state.verify recounted every row every six hours). Real daemon,
// real scheduler and hook runner, a clock the test moves.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { boot, call, seededDir } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { sweepStats } from "../modules/projects/handlers/folders.ts";
import { verifyPasses } from "../modules/state/impl.ts";

let t = Date.now();
let d: Daemon;
before(async () => {
  d = await boot(seededDir(), null, { now: () => t });
});
after(async () => {
  await d?.stop();
});

test("the project folder sweep and the state check run in full once after a start, not at every tick", { timeout: 120_000 }, async () => {
  // the start-up runs of both jobs have happened
  await d.scheduler.tick();
  const full = sweepStats.full;
  const deep = verifyPasses.deep;
  assert.ok(full >= 1, "the sweep ran once at the start");
  assert.ok(deep >= 1, "the state check ran deep once at the start");
  // a project made since, then the ten-minute and six-hour ticks come round
  const made = await call(d, "projects.create", { type: "project", title: "Late", idempotencyKey: "hops-late" });
  assert.equal(made.status, 200, JSON.stringify(made.data).slice(0, 200));
  const asked = sweepStats.asked;
  t += 11 * 60_000;
  await d.scheduler.tick();
  t += 11 * 60_000;
  await d.scheduler.tick();
  assert.ok(sweepStats.asked > asked, "the ten-minute tick came round and asked whether there is work");
  assert.equal(sweepStats.full, full, "the sweep did not run in full again: it asked first and found nothing to do");
  t += 6 * 60 * 60_000;
  await d.scheduler.tick();
  assert.ok(verifyPasses.recent >= 1, "the six-hour check ran");
  assert.equal(verifyPasses.deep, deep, "the six-hour check did not recount every row again");
});
