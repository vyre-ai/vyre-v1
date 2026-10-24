// Schedules (spec 2.12): create, change, pause, cancel, fire as the host tick does, and the if-missed rule after downtime. A fake clock drives everything; nothing sleeps.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, host, newSchedule, owner, NOW, MINUTE, HOUR, DAY } from "../fixtures/seed.ts";
import { dueSchedules, tick } from "../impl.ts";

const runId = (n: number): string => `run_${n.toString(16).padStart(32, "0")}`;
const names = (h: Harness): string[] => h.allEvents.map((e) => e.name);
const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);
/** The automations.fire stand-in: starts a Run per distinct idempotency key, the way a real capability would. */
function runner(h: Harness): { started: string[] } {
  const started: string[] = [];
  const byKey = new Map<string, string>();
  h.callee("automations.fire", (input) => {
    const key = h.calls[h.calls.length - 1]!.opts?.idempotencyKey ?? "";
    let id = byKey.get(key);
    if (!id) { id = runId(started.length + 1); byKey.set(key, id); started.push(id); }
    void input;
    return { runId: id };
  });
  return { started };
}
const every = (over: Record<string, unknown> = {}): Record<string, unknown> => newSchedule({ when: { cron: "0 9 * * *", tz: "UTC" }, ...over });

test("schedule: a cron schedule gets its next fire time, an event, and is read back by get and list", async () => {
  const h = harness();
  const r = await h.call("scheduler.schedule", newSchedule(), alice);
  assert.equal(r.nextAt, utc(2025, 10, 10, 4, 0), "Friday 09:00 in Karachi is 04:00 UTC");
  assert.deepEqual(names(h), ["schedule.created"]);
  assert.deepEqual(h.allEvents[0]!.payload, { scheduleId: r.scheduleId, owner, nextAt: r.nextAt });
  const got = (await h.call("scheduler.get", { scheduleId: r.scheduleId }, alice)).schedule;
  assert.equal(got.principal, alice.id);
  assert.equal(got.ifMissed, "run_once", "the default is run once");
  assert.equal(got.active, true);
  assert.equal(got.cap, "automations.fire");
  const l = await h.call("scheduler.list", {}, alice);
  assert.equal(l.total, 1);
  assert.equal(l.schedules[0].id, r.scheduleId);
});

test("schedule: a one-shot time, the same idempotency key returns the same schedule, a time in the past fires on the next tick", async () => {
  const h = harness();
  const at = NOW + 2 * HOUR;
  const a = await h.call("scheduler.schedule", newSchedule({ when: { at }, idempotencyKey: "k1" }), alice);
  const b = await h.call("scheduler.schedule", newSchedule({ when: { at }, idempotencyKey: "k1" }), alice);
  assert.equal(a.scheduleId, b.scheduleId);
  assert.equal(a.nextAt, at);
  assert.equal((await h.call("scheduler.list", {}, alice)).total, 1);
  const past = await h.call("scheduler.schedule", newSchedule({ when: { at: NOW - HOUR } }), alice);
  assert.equal(past.nextAt, NOW - HOUR);
  assert.equal(dueSchedules(h.db, h.now()).length, 1);
});

test("schedule: refuses a bad cron, a bad zone, a bad capability name and a schedule that never fires", async () => {
  const h = harness();
  const bad = async (over: Record<string, unknown>, reason: string): Promise<void> => {
    await assert.rejects(h.call("scheduler.schedule", newSchedule(over), alice), (e) => { assert.equal(codeOf(e), "validation.bad_input"); assert.equal(reasonOf(e), reason); return true; });
  };
  await bad({ when: { cron: "61 * * * *", tz: "UTC" } }, "bad_cron");
  await bad({ when: { cron: "* * * *", tz: "UTC" } }, "bad_cron");
  await bad({ when: { cron: "0 9 * * *", tz: "Mars/Olympus" } }, "bad_tz");
  await bad({ cap: "not a capability" }, "bad_cap");
  await bad({ when: { cron: "0 0 31 2 *", tz: "UTC" } }, "never_fires");
  assert.equal(h.allEvents.length, 0);
});

test("schedule: runs as the caller, or as someone the caller acts for; a person cannot schedule as another person", async () => {
  const h = harness();
  const agent = { id: "agt_bot", kind: "agent" as const, actingFor: alice.id };
  assert.equal((await h.call("scheduler.get", { scheduleId: (await h.call("scheduler.schedule", newSchedule(), agent)).scheduleId }, alice)).schedule.principal, alice.id);
  await assert.rejects(h.call("scheduler.schedule", newSchedule({ principal: bob.id }), alice), (e) => codeOf(e) === "permission.not_found");
  const asHost = await h.call("scheduler.schedule", newSchedule({ principal: bob.id }), host);
  assert.equal((await h.call("scheduler.get", { scheduleId: asHost.scheduleId }, bob)).schedule.principal, bob.id);
});

test("list: filters by owner and active; each person sees their own, the host sees all", async () => {
  const h = harness();
  const a = await h.call("scheduler.schedule", newSchedule(), alice);
  const b = await h.call("scheduler.schedule", newSchedule({ owner: { kind: "journey", id: "jrn_x" } }), alice);
  await h.call("scheduler.schedule", newSchedule(), bob);
  await h.call("scheduler.pause", { scheduleId: b.scheduleId, reason: "Journey paused" }, alice);
  assert.equal((await h.call("scheduler.list", {}, alice)).total, 2);
  assert.equal((await h.call("scheduler.list", {}, host)).total, 3);
  assert.deepEqual((await h.call("scheduler.list", { owner }, alice)).schedules.map((s: any) => s.id), [a.scheduleId]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual((await h.call("scheduler.list", { active: false }, alice)).schedules.map((s: any) => s.id), [b.scheduleId]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  const pages = await h.call("scheduler.list", { limit: 1 }, host);
  assert.equal(pages.schedules.length, 1);
  assert.equal(pages.next, "1");
  assert.equal((await h.call("scheduler.list", { limit: 1, cursor: pages.next }, host)).schedules.length, 1);
});

test("get, cancel, pause and reschedule are hidden from someone who is not the principal", async () => {
  const h = harness();
  const { scheduleId } = await h.call("scheduler.schedule", newSchedule(), alice);
  for (const [cap, input] of [["scheduler.get", { scheduleId }], ["scheduler.cancel", { scheduleId }], ["scheduler.pause", { scheduleId, reason: "x" }], ["scheduler.reschedule", { scheduleId, ifMissed: "skip" }], ["scheduler.run_now", { scheduleId }]] as const) {
    await assert.rejects(h.call(cap, input, bob), (e) => codeOf(e) === "permission.not_found", cap);
  }
  await assert.rejects(h.call("scheduler.get", { scheduleId: "sch_" + "0".repeat(32) }, alice), (e) => codeOf(e) === "validation.not_found");
});

test("pause stops it firing and shows the reason; resume goes on from now without making up what passed", async () => {
  const h = harness();
  runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);   // 09:00 UTC daily
  const paused = (await h.call("scheduler.pause", { scheduleId, reason: "Vendor outage" }, alice)).schedule;
  assert.equal(paused.active, false);
  assert.equal(paused.pausedReason, "Vendor outage");
  assert.deepEqual(h.allEvents.at(-1)!.payload, { scheduleId, owner, reason: "Vendor outage" });
  const before = h.allEvents.length;
  await h.call("scheduler.pause", { scheduleId, reason: "again" }, alice);
  assert.equal(h.allEvents.length, before, "pausing twice is one pause");
  assert.deepEqual(await h.call("scheduler.fire", { scheduleId, scheduledFor: utc(2025, 10, 10, 9) }, host), {}, "a paused schedule does not fire");
  h.setNow(utc(2025, 10, 12, 10));
  const resumed = (await h.call("scheduler.resume", { scheduleId }, alice)).schedule;
  assert.equal(resumed.active, true);
  assert.equal(resumed.pausedReason, undefined);
  assert.equal(resumed.nextAt, utc(2025, 10, 13, 9));
  assert.equal(names(h).at(-1), "schedule.resumed");
});

test("reschedule changes the time and the if-missed rule", async () => {
  const h = harness();
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);
  const r = (await h.call("scheduler.reschedule", { scheduleId, when: { cron: "30 18 * * *", tz: "UTC" }, ifMissed: "skip" }, alice)).schedule;
  assert.equal(r.ifMissed, "skip");
  assert.equal(r.nextAt, utc(2025, 10, 9, 18, 30));
  assert.deepEqual(r.when, { cron: "30 18 * * *", tz: "UTC" });
  await assert.rejects(h.call("scheduler.reschedule", { scheduleId, when: { cron: "nope", tz: "UTC" } }, alice), (e) => reasonOf(e) === "bad_cron");
});

test("cancel removes it from lists and gets, emits once and never fires", async () => {
  const h = harness();
  runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);
  assert.deepEqual(await h.call("scheduler.cancel", { scheduleId }, alice), { canceled: true });
  assert.deepEqual(h.allEvents.at(-1)!.payload, { scheduleId, owner, by: alice.id });
  assert.equal((await h.call("scheduler.list", {}, alice)).total, 0);
  await assert.rejects(h.call("scheduler.get", { scheduleId }, alice), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(h.call("scheduler.cancel", { scheduleId }, alice), (e) => codeOf(e) === "validation.not_found");
  h.advance(2 * DAY);
  assert.deepEqual(await h.consumer(host, (ctx) => tick(ctx)), { fired: [], failed: [] });
});

test("fire: makes the call with the schedule's input and a key per time, records the Run, moves to the next time", async () => {
  const h = harness();
  const { started } = runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", every({ input: { automationId: "aut_a1b2c3", note: "daily" } }), alice);
  const t = utc(2025, 10, 10, 9);
  h.setNow(t + 5_000);
  const out = await h.call("scheduler.fire", { scheduleId, scheduledFor: t }, host);
  assert.deepEqual(out, { runId: started[0] });
  assert.deepEqual(h.calls.at(-1), { cap: "automations.fire", input: { automationId: "aut_a1b2c3", note: "daily" }, opts: { idempotencyKey: `sch:${scheduleId}:${t}` } });
  const fired = h.allEvents.at(-1)!;
  assert.equal(fired.name, "schedule.fired");
  assert.deepEqual(fired.payload, { scheduleId, owner, runId: started[0], scheduledFor: t, late: false });
  const s = (await h.call("scheduler.get", { scheduleId }, alice)).schedule;
  assert.equal(s.nextAt, utc(2025, 10, 11, 9));
  assert.equal(s.lastFiredAt, t + 5_000);
  // the same time again does nothing and gives the same Run
  const calls = h.calls.length;
  assert.deepEqual(await h.call("scheduler.fire", { scheduleId, scheduledFor: t }, host), { runId: started[0] });
  assert.equal(h.calls.length, calls);
  assert.equal(h.allEvents.filter((e) => e.name === "schedule.fired").length, 1);
});

test("fire: a fire more than a minute behind is marked late; a capability that starts no Run still fires", async () => {
  const h = harness();
  h.callee("automations.fire", () => ({}));
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);
  const t = utc(2025, 10, 10, 9);
  h.setNow(t + 3 * MINUTE);
  assert.deepEqual(await h.call("scheduler.fire", { scheduleId, scheduledFor: t }, host), {});
  assert.equal(h.allEvents.at(-1)!.payload.late, true);
  assert.equal("runId" in h.allEvents.at(-1)!.payload, false);
});

test("fire: only the principal or the host may fire; a call that fails leaves the schedule due for the next try", async () => {
  const h = harness();
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);
  const t = utc(2025, 10, 10, 9);
  h.setNow(t);
  await assert.rejects(h.call("scheduler.fire", { scheduleId, scheduledFor: t }, bob), (e) => codeOf(e) === "permission.not_found");
  let down = true;
  h.callee("automations.fire", () => { if (down) throw Object.assign(new Error("down"), { error: { code: "provider.unavailable" } }); return { runId: runId(1) }; });
  await assert.rejects(h.call("scheduler.fire", { scheduleId, scheduledFor: t }, alice));
  assert.equal(h.allEvents.length, 1, "only schedule.created: nothing fired");
  assert.equal(dueSchedules(h.db, h.now()).length, 1, "still due");
  down = false;
  assert.deepEqual(await h.call("scheduler.fire", { scheduleId, scheduledFor: t }, alice), { runId: runId(1) });
  assert.equal(dueSchedules(h.db, h.now()).length, 0);
});

test("a one-shot ends after its fire", async () => {
  const h = harness();
  const { started } = runner(h);
  const at = NOW + HOUR;
  const { scheduleId } = await h.call("scheduler.schedule", newSchedule({ when: { at } }), alice);
  h.setNow(at);
  assert.deepEqual(await h.consumer(host, (ctx) => tick(ctx)), { fired: [scheduleId], failed: [] });
  const s = (await h.call("scheduler.get", { scheduleId }, alice)).schedule;
  assert.equal(s.active, false);
  assert.equal(s.nextAt, undefined);
  assert.equal(started.length, 1);
  h.advance(DAY);
  assert.deepEqual(await h.consumer(host, (ctx) => tick(ctx)), { fired: [], failed: [] });
});

test("tick: fires what is due, oldest first, and one failing call does not stop the others", async () => {
  const h = harness();
  const order: string[] = [];
  h.callee("automations.fire", (i) => { order.push(i.automationId); if (i.automationId === "aut_bad") throw new Error("boom"); return { runId: runId(order.length) }; });
  const mk = (id: string, when: Record<string, unknown>) => h.call("scheduler.schedule", newSchedule({ input: { automationId: id }, when }), alice);
  const late = await mk("aut_late", { at: NOW + 20 * MINUTE });
  const bad = await mk("aut_bad", { at: NOW + 10 * MINUTE });
  const early = await mk("aut_early", { at: NOW + 5 * MINUTE });
  await mk("aut_future", { at: NOW + DAY });
  h.advance(30 * MINUTE);
  const r = await h.consumer(host, (ctx) => tick(ctx));
  assert.deepEqual(order, ["aut_early", "aut_bad", "aut_late"]);
  assert.deepEqual(r.fired, [early.scheduleId, late.scheduleId]);
  assert.deepEqual(r.failed.map((f) => f.scheduleId), [bad.scheduleId]);
});

test("run_now fires once now without moving the cron", async () => {
  const h = harness();
  const { started } = runner(h);
  const { scheduleId, nextAt } = await h.call("scheduler.schedule", every(), alice);
  const r = await h.call("scheduler.run_now", { scheduleId }, alice);
  assert.deepEqual(r, { runId: started[0] });
  const s = (await h.call("scheduler.get", { scheduleId }, alice)).schedule;
  assert.equal(s.nextAt, nextAt);
  assert.equal(s.lastFiredAt, NOW);
  assert.equal(h.allEvents.at(-1)!.name, "schedule.fired");
  // a capability that starts no Run has no run to hand back, unless the invoke pipeline made one for this call
  h.callee("automations.fire", () => ({}));
  await assert.rejects(h.call("scheduler.run_now", { scheduleId }, alice), (e) => reasonOf(e) === "no_run");
  assert.deepEqual(await h.call("scheduler.run_now", { scheduleId }, alice, runId(9)), { runId: runId(9) });
});

// ---- if missed ----

test("catch_up: a schedule missed while the server was down runs once on restart, however many times it was missed", async () => {
  const h = harness();
  const { started } = runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", newSchedule({ when: { cron: "*/10 * * * *", tz: "UTC" } }), alice);   // 09:00, 09:10, ...
  const since = h.now();
  h.advance(42 * MINUTE);   // 09:35:20: the times 09:00, 09:10, 09:20, 09:30 passed
  const r = await h.call("scheduler.catch_up", { since }, host);
  assert.deepEqual(r, { ranOnce: 1, skipped: 0 });
  assert.equal(started.length, 1);
  assert.equal(h.calls.at(-1)!.opts!.idempotencyKey, `sch:${scheduleId}:${utc(2025, 10, 9, 9, 30)}`, "it runs for the latest missed time");
  assert.deepEqual(names(h).slice(-2), ["schedule.missed", "schedule.fired"]);
  assert.deepEqual(h.allEvents.at(-2)!.payload, { scheduleId, owner, scheduledFor: utc(2025, 10, 9, 9, 30), handling: "ran_once", note: "3 earlier times were skipped too." });
  assert.equal(h.allEvents.at(-1)!.payload.late, true);
  assert.equal((await h.call("scheduler.get", { scheduleId }, alice)).schedule.nextAt, utc(2025, 10, 9, 9, 40));
  // the tick after it finds nothing more to do, and a second catch_up changes nothing
  assert.deepEqual(await h.consumer(host, (ctx) => tick(ctx)), { fired: [], failed: [] });
  assert.deepEqual(await h.call("scheduler.catch_up", { since }, host), { ranOnce: 0, skipped: 0 });
  assert.equal(started.length, 1);
});

test("catch_up: missed by more than the window it is skipped with a note for the owner's digest; the window is a setting", async () => {
  const h = harness();
  const { started } = runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);   // 09:00 UTC
  const since = h.now();
  h.setNow(utc(2025, 10, 9, 12, 3));      // 3 hours after 09:00
  assert.deepEqual(await h.call("scheduler.catch_up", { since }, host), { ranOnce: 0, skipped: 1 });
  assert.equal(started.length, 0);
  const miss = (await h.call("scheduler.missed", { since }, alice)).missed;
  assert.deepEqual(miss, [{ scheduleId, owner, scheduledFor: utc(2025, 10, 9, 9), handling: "skipped" }]);
  assert.match(h.allEvents.at(-1)!.payload.note as string, /Skipped: it was due 183 minutes ago, longer than the 60 minute window/);
  assert.equal((await h.call("scheduler.get", { scheduleId }, alice)).schedule.nextAt, utc(2025, 10, 10, 9), "the schedule goes on");

  const h2 = harness();
  const r2 = runner(h2);
  h2.policy("scheduler.missed_window_minutes", 240);
  await h2.call("scheduler.schedule", every(), alice);
  const since2 = h2.now();
  h2.setNow(utc(2025, 10, 9, 12, 3));
  assert.deepEqual(await h2.call("scheduler.catch_up", { since: since2 }, host), { ranOnce: 1, skipped: 0 });
  assert.equal(r2.started.length, 1);
});

test("catch_up: a window of 0 never runs a missed time; the rule 'skip' never runs one even inside the window", async () => {
  const h = harness();
  const { started } = runner(h);
  h.policy("scheduler.missed_window_minutes", 0);
  await h.call("scheduler.schedule", every(), alice);
  const since = h.now();
  h.setNow(utc(2025, 10, 9, 9, 1));
  assert.deepEqual(await h.call("scheduler.catch_up", { since }, host), { ranOnce: 0, skipped: 1 });

  const h2 = harness();
  const r2 = runner(h2);
  const s = await h2.call("scheduler.schedule", every({ ifMissed: "skip" }), alice);
  const since2 = h2.now();
  h2.setNow(utc(2025, 10, 9, 9, 5));
  assert.deepEqual(await h2.call("scheduler.catch_up", { since: since2 }, host), { ranOnce: 0, skipped: 1 });
  assert.match(h2.allEvents.at(-1)!.payload.note as string, /Skipped by its if-missed rule/);
  assert.equal(r2.started.length + started.length, 0);
  assert.equal((await h2.call("scheduler.get", { scheduleId: s.scheduleId }, alice)).schedule.nextAt, utc(2025, 10, 10, 9));
});

test("catch_up: a one-shot that was missed runs once inside the window or is skipped, and ends either way; paused schedules are left alone", async () => {
  const h = harness();
  const { started } = runner(h);
  const near = await h.call("scheduler.schedule", newSchedule({ when: { at: NOW + 10 * MINUTE } }), alice);
  const far = await h.call("scheduler.schedule", newSchedule({ when: { at: NOW + 20 * MINUTE }, input: { automationId: "aut_far" } }), alice);
  const asleep = await h.call("scheduler.schedule", newSchedule({ when: { at: NOW + 30 * MINUTE } }), alice);
  await h.call("scheduler.pause", { scheduleId: asleep.scheduleId, reason: "On hold" }, alice);
  const since = h.now();
  h.setNow(NOW + 20 * MINUTE + 61 * MINUTE + 1);   // `near` is 71 minutes late, `far` just over an hour
  assert.deepEqual(await h.call("scheduler.catch_up", { since }, host), { ranOnce: 0, skipped: 2 });
  for (const id of [near.scheduleId, far.scheduleId]) assert.equal((await h.call("scheduler.get", { scheduleId: id }, alice)).schedule.active, false);
  assert.equal((await h.call("scheduler.get", { scheduleId: asleep.scheduleId }, alice)).schedule.pausedReason, "On hold");
  assert.equal(started.length, 0);

  const h2 = harness();
  const r2 = runner(h2);
  const one = await h2.call("scheduler.schedule", newSchedule({ when: { at: NOW + 10 * MINUTE } }), alice);
  const since2 = h2.now();
  h2.advance(30 * MINUTE);
  assert.deepEqual(await h2.call("scheduler.catch_up", { since: since2 }, host), { ranOnce: 1, skipped: 0 });
  assert.equal(r2.started.length, 1);
  assert.equal((await h2.call("scheduler.get", { scheduleId: one.scheduleId }, alice)).schedule.active, false);
});

test("catch_up: a time that was already fired is not run again; times before `since` are not counted", async () => {
  const h = harness();
  const { started } = runner(h);
  const { scheduleId } = await h.call("scheduler.schedule", every(), alice);
  const t = utc(2025, 10, 9, 9);
  h.setNow(t + 30 * MINUTE);
  await h.call("scheduler.fire", { scheduleId, scheduledFor: t }, host);   // fired by the tick, then the next row is 10 Oct
  assert.deepEqual(await h.call("scheduler.catch_up", { since: NOW }, host), { ranOnce: 0, skipped: 0 });
  assert.equal(started.length, 1);
  const h2 = harness();
  runner(h2);
  await h2.call("scheduler.schedule", every(), alice);
  h2.setNow(utc(2025, 10, 9, 9, 20));
  assert.deepEqual(await h2.call("scheduler.catch_up", { since: utc(2025, 10, 9, 9, 10) }, host), { ranOnce: 0, skipped: 0 }, "everything missed is before since");
});

test("missed lists what catch_up did, for the owner and the host only", async () => {
  const h = harness();
  runner(h);
  await h.call("scheduler.schedule", every(), alice);
  await h.call("scheduler.schedule", every({ owner: { kind: "journey", id: "jrn_1" } }), bob);
  const since = h.now();
  h.setNow(utc(2025, 10, 9, 9, 10));
  await h.call("scheduler.catch_up", { since }, host);
  assert.equal((await h.call("scheduler.missed", { since }, alice)).missed.length, 1);
  assert.equal((await h.call("scheduler.missed", { since }, bob)).missed.length, 1);
  assert.equal((await h.call("scheduler.missed", { since }, host)).missed.length, 2);
  assert.equal((await h.call("scheduler.missed", { since: h.now() + 1 }, host)).missed.length, 0);
});

test("status: healthy when nothing is late, degraded then down as the tick falls behind; counts due schedules and open waits", async () => {
  const h = harness();
  assert.deepEqual(await h.call("scheduler.status", {}, host), { state: "healthy", tickLagMs: 0, dueNow: 0, openWaits: 0 });
  await h.call("scheduler.schedule", newSchedule({ when: { at: NOW + MINUTE } }), alice);
  h.advance(MINUTE + 30_000);
  const a = await h.call("scheduler.status", {}, host);
  assert.deepEqual([a.state, a.tickLagMs, a.dueNow], ["healthy", 30_000, 1]);
  h.advance(3 * MINUTE);
  assert.equal((await h.call("scheduler.status", {}, host)).state, "degraded");
  h.advance(HOUR);
  const d = await h.call("scheduler.status", {}, host);
  assert.equal(d.state, "down");
  assert.match(d.detail, /1 schedule is due/);
});
