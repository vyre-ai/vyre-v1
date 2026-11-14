// A routine's clock is a wake in the scheduler (P1 step 4, agents side). The wake follows the routine row in a fixed order (CONTRACTS-2026-11-13/P1-clock-wake.md, 9a): starting follows the wake, stopping
// leads it. agents.routine.fire starts a Run only when the routine still agrees with its fire; a reconcile repairs what a crash left apart and makes a wake for a routine saved before the table, at its stored time.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, periodic } from "../impl.ts";
import { NOW, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { routineBy } from "../projections.ts";
import { isSelfPaused } from "../routine-guard.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const svc = { kind: "service" as const, id: "svc_host" };
let n = 0;
const MIN = 60_000;

function runsWith(hn: Harness): string[] {
  const keys: string[] = [];
  hn.world.answer("runs.start", (i: { idempotencyKey: string }) => {
    keys.push(i.idempotencyKey);
    return { runId: `run_${keys.length}` };
  });
  return keys;
}
async function agentOf(hn: Harness): Promise<string> {
  return (await h["agents.create"]!(hn.ctx, { name: `Pinger${++n}`, role: "Says hi.", idempotencyKey: `c${n}` })).agent
    .agentId;
}
const save = (hn: Harness, agentId: string, over: Record<string, unknown> = {}, ctx: Harness["ctx"] = hn.ctx) =>
  h["agents.routine.save"]!(ctx, {
    agentId,
    title: "Digest",
    cron: "0 9 * * *",
    prompt: "Say hi.",
    idempotencyKey: `r${++n}`,
    ...over,
  });
const wakes = (hn: Harness) => [...hn.world.wakes.values()];
const order = (hn: Harness): string[] =>
  hn.world.calls
    .filter((c) => c.cap.startsWith("scheduler.") && c.cap !== "scheduler.can_hold" && c.cap !== "scheduler.get")
    .map((c) => c.cap);

test("saving a routine makes its one wake, in UTC, before the row exists; changing it reschedules the same wake", async () => {
  const hn = harness();
  const agentId = await agentOf(hn);
  let rowAtSchedule: unknown = "unset";
  const was = hn.world.handlers["scheduler.schedule"]!;
  hn.world.answer("scheduler.schedule", (i: any, o: any) => {
    rowAtSchedule = routineBy(hn.db, (i.owner as { id: string }).id);
    return was(i, o);
  });
  const r = (await save(hn, agentId)).routine;
  assert.equal(rowAtSchedule, null, "starting follows the wake: the wake was made first");
  assert.equal(wakes(hn).length, 1);
  assert.deepEqual([wakes(hn)[0]!.owner.id, wakes(hn)[0]!.when], [r.routineId, { cron: "0 9 * * *", tz: "UTC" }]);
  assert.equal(wakes(hn)[0]!.input["person"], r.ownerId);
  assert.equal(wakes(hn)[0]!.input["kind"], "routine");
  await save(hn, agentId, { routineId: r.routineId, cron: "0 10 * * *" });
  assert.equal(wakes(hn).length, 1, "the same wake");
  assert.equal(wakes(hn)[0]!.when.cron, "0 10 * * *");
  assert.equal(order(hn).filter((c) => c === "scheduler.schedule").length, 1);
});

test("turning a routine off or deleting it writes the row FIRST and the wake after; turning it on follows the wake", async () => {
  const hn = harness();
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId)).routine;
  const seen: Array<[string, unknown]> = [];
  for (const cap of ["scheduler.pause", "scheduler.cancel", "scheduler.resume"] as const) {
    const was = hn.world.handlers[cap]!;
    hn.world.answer(cap, (i: any, o: any) => {
      seen.push([cap, routineBy(hn.db, r.routineId)?.enabled]);
      return was(i, o);
    });
  }
  await save(hn, agentId, { routineId: r.routineId, enabled: false });
  assert.deepEqual(seen.at(-1), ["scheduler.pause", false], "the row said off before the wake was paused");
  assert.equal(wakes(hn)[0]!.active, false);
  await save(hn, agentId, { routineId: r.routineId, enabled: true });
  assert.equal(wakes(hn)[0]!.active, true);
  assert.equal(seen.at(-1)![0], "scheduler.resume");
  await h["agents.routine.delete"]!(hn.ctx, { agentId, routineId: r.routineId });
  assert.deepEqual(seen.at(-1), ["scheduler.cancel", undefined], "the row was gone before the wake was cancelled");
  assert.equal(wakes(hn)[0]!.cancelled, true);
});

test("a watcher has no wake; a person who names a routine that is not theirs, or another agent's, makes none and changes none", async () => {
  const hn = harness();
  const agentId = await agentOf(hn);
  const other = await agentOf(hn);
  await h["agents.routine.save"]!(hn.ctx, {
    agentId,
    title: "Watch",
    kind: "watch",
    watch: { on: "message", channelId: `chn_${"a".repeat(32)}` },
    prompt: "Greet.",
    idempotencyKey: "w1",
  }).catch(() => undefined);
  assert.equal(wakes(hn).length, 0, "a watcher runs on messages, not on a clock");
  const mine = (await save(hn, agentId)).routine;
  const before = wakes(hn).length;
  const stranger = hn.as({ kind: "person", id: "usr_stranger" });
  await assert.rejects(() => save(hn, agentId, { routineId: mine.routineId, cron: "0 1 * * *" }, stranger));
  await assert.rejects(
    () => save(hn, other, { routineId: mine.routineId, cron: "0 1 * * *" }),
    "a routine of another agent",
  );
  assert.equal(wakes(hn).length, before);
  assert.equal(wakes(hn)[0]!.when.cron, "0 9 * * *", "nothing of the wake came from what the stranger sent");
});

const fire = (hn: Harness, routineId: string, dueKey: string, ctx = hn.as(svc)) =>
  h["agents.routine.fire"]!(ctx, { routineId, dueKey });

test("agents.routine.fire starts the Run under the owner with the routine's key, once; only the server may ask", async () => {
  const hn = harness();
  const keys = runsWith(hn);
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "* * * * *" })).routine;
  const key = String(r.nextRunAt);
  hn.advance(MIN);
  for (const who of [
    hn.ctx,
    hn.as({ kind: "agent", id: agentId }),
    hn.as({ kind: "service", id: `svc_${"b".repeat(32)}` }),
  ])
    await assert.rejects(() => fire(hn, r.routineId, key, who), /server/);
  const out = await fire(hn, r.routineId, key);
  assert.deepEqual(out, { started: true, runId: "run_1" });
  assert.deepEqual(keys, [`routine:${r.routineId}:${r.nextRunAt}`]);
  const after = routineBy(hn.db, r.routineId)!;
  assert.equal(after.lastRunAt, NOW + MIN, "last run is when it ran");
  assert.ok(after.nextRunAt! > r.nextRunAt, "the mirror moved on");
  // the same fire asked again (a retry, a lost answer): the routine no longer agrees, so nothing starts
  assert.deepEqual(await fire(hn, r.routineId, key), {
    started: false,
    why: "The routine and its schedule do not agree on the time.",
  });
  assert.equal(keys.length, 1);
});

test("agents.routine.fire starts nothing for a routine that is gone, off, paused, self-paused, a watcher, out of step, or whose agent is paused", async () => {
  const hn = harness();
  const keys = runsWith(hn);
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "* * * * *" })).routine;
  const key = String(r.nextRunAt);
  hn.advance(MIN);
  assert.match((await fire(hn, "rtn_" + "0".repeat(32), key)).why, /gone/);
  assert.match(
    (await fire(hn, r.routineId, "12345")).why,
    /do not agree/,
    "a fire that is not the routine's next time",
  );
  hn.db.run("INSERT INTO agents_routine_selfpaused (routineId, reason, at) VALUES (?, 'x', 1)", r.routineId);
  assert.match((await fire(hn, r.routineId, key)).why, /paused itself/);
  hn.db.run("DELETE FROM agents_routine_selfpaused WHERE routineId = ?", r.routineId);
  hn.db.run("UPDATE agents_routine SET enabled = 0 WHERE id = ?", r.routineId);
  assert.match((await fire(hn, r.routineId, key)).why, /off/);
  hn.db.run("UPDATE agents_routine SET enabled = 1 WHERE id = ?", r.routineId);
  hn.db.run("UPDATE agents_agent SET paused = 1 WHERE id = ?", agentId);
  assert.match((await fire(hn, r.routineId, key)).why, /paused or gone/);
  assert.equal(keys.length, 0, "no Run was started by any of them");
});

test("after a hand-over the Run starts under the new owner, read from the routine row", async () => {
  const hn = harness();
  const started: Array<{ owner: string }> = [];
  hn.world.answer("runs.start", (i: any) => (started.push(i), { runId: "run_x" }));
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "* * * * *" })).routine;
  await h["agents.routine.delegate"]!(hn.ctx, {
    agentId,
    routineId: r.routineId,
    to: { kind: "person", id: "usr_maya" },
  });
  hn.advance(MIN);
  await fire(hn, r.routineId, String(routineBy(hn.db, r.routineId)!.nextRunAt));
  assert.equal(started[0]!.owner, "usr_maya");
});

test("the reconcile makes the wake of a routine saved before the table at its stored next time, exactly, and is idempotent", async () => {
  const hn = harness();
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "30 13 * * *" })).routine;
  // as a store made before the table has it: a routine row, no mapping, no wake
  hn.db.run("DELETE FROM agents_routine_wake WHERE routineId = ?", r.routineId);
  hn.world.wakes.clear();
  const stored = routineBy(hn.db, r.routineId)!.nextRunAt!;
  const run = () => periodic["agents.routines_wake_sync"].run(hn.as(svc));
  assert.deepEqual(await run(), [r.routineId]);
  assert.equal(wakes(hn).length, 1);
  assert.equal(wakes(hn)[0]!.nextAt, stored, "the first fire is the stored time, byte for byte");
  assert.deepEqual(await run(), [], "the second pass changes nothing");
  assert.equal(wakes(hn).length, 1);
});

test("the reconcile heals each way the routine and its wake can be left apart", async () => {
  const hn = harness();
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId)).routine;
  const run = () => periodic["agents.routines_wake_sync"].run(hn.as(svc));
  const w = () => wakes(hn)[0]!;
  w().active = false; // paused by a save that stopped after the row: the routine is on
  await run();
  assert.equal(w().active, true, "resumed");
  hn.db.run("UPDATE agents_routine SET enabled = 0 WHERE id = ?", r.routineId); // paused by the person, the wake change lost
  await run();
  assert.equal(w().active, false, "paused");
  hn.db.run("UPDATE agents_routine SET enabled = 1 WHERE id = ?", r.routineId);
  hn.db.run("UPDATE agents_routine SET cron = '0 4 * * *' WHERE id = ?", r.routineId); // the cron changed, the wake did not
  await run();
  assert.equal(w().when.cron, "0 4 * * *", "rescheduled");
  w().nextAt = 12345; // the mirror disagrees with the wake: the wake is the clock
  await run();
  assert.equal(routineBy(hn.db, r.routineId)!.nextRunAt, 12345);
  hn.db.run("DELETE FROM agents_routine WHERE id = ?", r.routineId); // deleted, the wake cancel lost
  await run();
  assert.equal(w().cancelled, true, "cancelled");
  assert.equal(hn.db.all("SELECT 1 FROM agents_routine_wake").length, 0);
});

test("a routine that pauses itself keeps its wake until the reconcile pauses it, and fire starts nothing meanwhile", async () => {
  const hn = harness();
  runsWith(hn);
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "* * * * *" })).routine;
  isSelfPaused(hn.db, r.routineId); // the table is made on first use
  hn.db.run("INSERT INTO agents_routine_selfpaused (routineId, reason, at) VALUES (?, 'x', 1)", r.routineId);
  hn.db.run("UPDATE agents_routine SET enabled = 0, nextRunAt = NULL WHERE id = ?", r.routineId);
  assert.equal(wakes(hn)[0]!.active, true);
  await periodic["agents.routines_wake_sync"].run(hn.as(svc));
  assert.equal(wakes(hn)[0]!.active, false);
  assert.equal(NOW > 0, true);
});

test("the reconcile leaves the mirror alone while a fire may still be tried, so a retried fire still starts its Run; a mirror left behind for a quarter of an hour follows the wake", async () => {
  const hn = harness();
  const keys = runsWith(hn);
  const agentId = await agentOf(hn);
  const r = (await save(hn, agentId, { cron: "* * * * *" })).routine;
  const due = routineBy(hn.db, r.routineId)!.nextRunAt!;
  const run = () => periodic["agents.routines_wake_sync"].run(hn.as(svc));
  hn.advance(MIN);
  // the wake made the fire and went on to the next minute; the fire has not started its Run yet (its first try failed, its lease is running)
  wakes(hn)[0]!.nextAt = due + MIN;
  await run();
  await run();
  assert.equal(routineBy(hn.db, r.routineId)!.nextRunAt, due, "the mirror still says the time the fire is for");
  hn.advance(MIN); // the lease is over: the fire is tried again, with its own time
  assert.equal(
    (await fire(hn, r.routineId, String(due))).started,
    true,
    "the retried fire still agrees with the routine",
  );
  assert.deepEqual(keys, [`routine:${r.routineId}:${due}`]);
  // a mirror that is far behind and has no fire left to wait for follows the wake
  hn.db.run("UPDATE agents_routine SET nextRunAt = ? WHERE id = ?", hn.clock.t - 20 * MIN, r.routineId);
  wakes(hn)[0]!.nextAt = hn.clock.t + MIN;
  await run();
  assert.equal(routineBy(hn.db, r.routineId)!.nextRunAt, hn.clock.t + MIN, "repaired from the wake");
});
