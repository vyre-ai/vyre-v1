// A host job whose promise never settles used to hold its own slot for ever ("a job never overlaps itself"): every later run was skipped and nothing said why (rc.26, 17 Nov).
import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler/index.ts";

test("a job that never settles is ended with a reason at its limit and runs again", async () => {
  let t = 1_000;
  let calls = 0;
  const seen: { ok: boolean; error?: string }[] = [];
  const s = new Scheduler({
    now: () => t,
    onRun: (r) => seen.push({ ok: r.ok, ...(r.error ? { error: r.error } : {}) }),
  });
  s.add({
    name: "stuck",
    schedule: { everyMs: 10, immediate: true },
    abandonAfterMs: 30,
    run: () => {
      calls++;
      return calls === 1 ? new Promise<void>(() => undefined) : Promise.resolve();
    },
  });
  await Promise.race([
    s.tick(),
    new Promise((_, no) => setTimeout(() => no(new Error("the tick never came back")), 3000).unref()),
  ]);
  assert.equal(seen[0]?.ok, false);
  assert.match(seen[0]?.error ?? "", /did not finish within 30 ms/);
  assert.equal(s.status()[0]!.running, false, "the slot is free");
  t += 10;
  await s.tick();
  assert.equal(calls, 2, "the job started again by itself");
  assert.equal(seen[1]?.ok, true);
});

test("the scheduler probe names a scheduled job that is late and says why", async () => {
  const { schedulerTick, SCHEDULE_LATE_MS } = await import("../src/platform/probes.ts");
  const now = 10_000_000;
  assert.equal(schedulerTick(now - 1000, now, []).state, "healthy");
  const brief = [{ cap: "connectors.sync_run", why: "due" as const, since: now - SCHEDULE_LATE_MS + 1000 }];
  assert.equal(schedulerTick(now - 1000, now, brief).state, "healthy", "a job that has waited a little is not late");
  const late = schedulerTick(now - 1000, now, [
    { cap: "connectors.sync_run", why: "due", since: now - 16 * 60_000 },
    { cap: "mail.sync", why: "retrying", since: now - 6 * 60_000, error: "boom" },
  ]);
  assert.equal(late.state, "degraded");
  assert.match(
    late.detail ?? "",
    /2 scheduled jobs are late\. The oldest, connectors\.sync_run, has waited 16 min: it has not started\./,
  );
  const retry = schedulerTick(now - 1000, now, [
    { cap: "mail.sync", why: "retrying", since: now - 6 * 60_000, error: "boom" },
  ]);
  assert.match(retry.detail ?? "", /it failed \(boom\) and waits to try again/);
});
