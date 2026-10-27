// Pure schedule ticks: next five, daylight saving, missed policies, overflow dedup, claimed ticks, spacing and overlap.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyScheduleChoice, canonicalSchedule, clampBackfill, compilePreset, nextOccurrences, planSchedule, scheduleRequestKey, summarizeCron, tickId,
} from "./index.ts";
import type { AutomationSchedule, PlanContext } from "./index.ts";
import {
  SCHEDULE_FIRE_CAPABILITY, deliverScheduleNeedsYou, loadOpenScheduleKeys, scheduleRequestKey as hostRequestKey, startScheduledTicks,
} from "../../../host/src/seams/automation-schedule.ts";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => Date.UTC(y, mo - 1, d, h, mi, s);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const AUTOMATION = "aut_sched01";
const OWNER = "usr_owner";
const SHARED = "usr_shared";

function schedule(over: Partial<AutomationSchedule> & Pick<AutomationSchedule, "missed">): AutomationSchedule {
  return {
    automationId: AUTOMATION,
    cron: "0 * * * *",
    timezone: "UTC",
    lookbackMs: 30 * DAY,
    cap: 10,
    spacingMs: 0,
    overlap: "queue",
    ...over,
  };
}

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return { now: utc(2026, 1, 5, 14, 30), cursor: utc(2026, 1, 5, 9, 0), ownerId: OWNER, sharedRecipientIds: [SHARED], onTimeMs: 60_000, ...over };
}

const DUE = [10, 11, 12, 13, 14].map((h) => utc(2026, 1, 5, h, 0));

test("next five runs in a named time zone, and a preset stores the same cron", () => {
  const preset = compilePreset({ kind: "weekdays", hour: 9, minute: 0 });
  assert.equal(preset.ok, true);
  if (!preset.ok) return;
  assert.equal(preset.cron, "0 9 * * 1-5");
  assert.equal(summarizeCron(preset.cron), "Weekdays at 09:00");
  const advanced = canonicalSchedule({ automationId: AUTOMATION, timezone: "Asia/Karachi", missed: "skip", cron: "0 9 * * 1-5" });
  const friendly = canonicalSchedule({ automationId: AUTOMATION, timezone: "Asia/Karachi", missed: "skip", preset: { kind: "weekdays", hour: 9, minute: 0 } });
  assert.equal(advanced.ok && friendly.ok && advanced.schedule.cron, friendly.ok ? friendly.schedule.cron : "");
  const after = utc(2025, 10, 10, 12, 0); // Friday afternoon UTC, after 09:00 in Karachi
  const next = nextOccurrences(preset.cron, "Asia/Karachi", after, 5);
  assert.ok(!("error" in next));
  if ("error" in next) return;
  assert.equal(next.timezone, "Asia/Karachi");
  assert.deepEqual(next.times, [
    utc(2025, 10, 13, 4, 0),
    utc(2025, 10, 14, 4, 0),
    utc(2025, 10, 15, 4, 0),
    utc(2025, 10, 16, 4, 0),
    utc(2025, 10, 17, 4, 0),
  ]);
  assert.deepEqual(nextOccurrences("nope", "UTC", after), { error: "bad_cron" });
  assert.deepEqual(nextOccurrences("* * * * *", "Nowhere/Land", after), { error: "bad_timezone" });
});

test("daylight saving: spring-forward skips a missing local time, fall-back fires the first pass only", () => {
  const spring = nextOccurrences("30 2 * * *", "America/New_York", utc(2026, 3, 7, 8, 0), 5);
  assert.ok(!("error" in spring));
  if ("error" in spring) return;
  assert.deepEqual(spring.times, [
    utc(2026, 3, 9, 6, 30),
    utc(2026, 3, 10, 6, 30),
    utc(2026, 3, 11, 6, 30),
    utc(2026, 3, 12, 6, 30),
    utc(2026, 3, 13, 6, 30),
  ]);
  const across = nextOccurrences("0 9 * * *", "America/New_York", utc(2026, 3, 7, 12, 0), 5);
  assert.ok(!("error" in across));
  if ("error" in across) return;
  assert.deepEqual(across.times, [
    utc(2026, 3, 7, 14, 0),
    utc(2026, 3, 8, 13, 0),
    utc(2026, 3, 9, 13, 0),
    utc(2026, 3, 10, 13, 0),
    utc(2026, 3, 11, 13, 0),
  ]);
  const back = nextOccurrences("30 1 * * *", "America/New_York", utc(2026, 11, 1, 0, 0), 5);
  assert.ok(!("error" in back));
  if ("error" in back) return;
  assert.deepEqual(back.times, [
    utc(2026, 11, 1, 5, 30),
    utc(2026, 11, 2, 6, 30),
    utc(2026, 11, 3, 6, 30),
    utc(2026, 11, 4, 6, 30),
    utc(2026, 11, 5, 6, 30),
  ]);
});

test("skip drops a late gap, run once starts the latest, backfill starts each tick oldest first", () => {
  const base = ctx();
  const skipped = planSchedule(schedule({ missed: "skip" }), base);
  const once = planSchedule(schedule({ missed: "run_once" }), base);
  const each = planSchedule(schedule({ missed: "backfill_each_tick" }), base);
  assert.equal(skipped.ok && once.ok && each.ok, true);
  if (!skipped.ok || !once.ok || !each.ok) return;
  assert.deepEqual(skipped.plan.ticks, []);
  assert.equal(skipped.plan.cursor, DUE[4]);
  assert.deepEqual(once.plan.ticks.map((t) => t.fireAt), [DUE[4]]);
  assert.equal(once.plan.ticks[0]!.tickId, tickId(AUTOMATION, DUE[4]!));
  assert.deepEqual(each.plan.ticks.map((t) => t.fireAt), DUE);
  assert.equal(each.plan.paused, false);

  const onTime = ctx({ now: utc(2026, 1, 5, 14, 0, 30), cursor: utc(2026, 1, 5, 13, 0) });
  for (const missed of ["skip", "run_once", "backfill_each_tick"] as const) {
    const plan = planSchedule(schedule({ missed }), onTime);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.plan.ticks.map((t) => t.fireAt), [utc(2026, 1, 5, 14, 0)], missed);
  }

  const looked = planSchedule(schedule({ missed: "backfill_each_tick", lookbackMs: HOUR }), ctx({ cursor: utc(2026, 1, 1, 0, 0) }));
  assert.equal(looked.ok, true);
  if (!looked.ok) return;
  assert.deepEqual(looked.plan.ticks.map((t) => t.fireAt), [DUE[4]]);
});

test("a backlog over the cap pauses the schedule and returns one request key", () => {
  const first = planSchedule(schedule({ missed: "backfill_each_tick", cap: 3 }), ctx());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const key = scheduleRequestKey(AUTOMATION);
  assert.equal(key, `automation-schedule:${AUTOMATION}`);
  assert.equal(key, hostRequestKey(AUTOMATION));
  assert.equal(first.plan.paused, true);
  assert.equal(first.plan.pausedReason, "backfill_over_cap");
  assert.deepEqual(first.plan.ticks, []);
  assert.equal(first.plan.backlogCount, 5);
  assert.deepEqual(first.plan.backlog, DUE);
  assert.equal(first.plan.deduped, false);
  const request = first.plan.request;
  assert.ok(request);
  if (!request) return;
  assert.equal(request.dedupKey, key);
  assert.equal(request.handler, "applyScheduleChoice");
  assert.equal(request.task.kind, "unblock");
  assert.equal(request.task.source.id, key);
  assert.equal(request.task.idempotencyKey, key);
  assert.equal(request.task.assigned.id, OWNER);
  assert.deepEqual(request.followers, [SHARED]);
  assert.deepEqual(request.preview, DUE);
  assert.equal(request.backlogCount, 5);
  assert.deepEqual(request.notifications.map((n) => n.collapseKey), [key, key]);
  for (const choice of ["run_latest_n", "skip_backlog_and_resume", "change_limits", "keep_paused"]) {
    assert.ok(request.choices.some((c) => c.key === choice), choice);
  }

  const second = planSchedule(schedule({ missed: "backfill_each_tick", cap: 3 }), ctx({ openRequestKeys: new Set([key]) }));
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.plan.request, undefined);
  assert.equal(second.plan.deduped, true);
  assert.equal(second.plan.paused, true);
  assert.deepEqual(second.plan.ticks, []);

  const fits = planSchedule(schedule({ missed: "backfill_each_tick", cap: 5 }), ctx());
  assert.equal(fits.ok, true);
  if (!fits.ok) return;
  assert.equal(fits.plan.paused, false);
  assert.equal(fits.plan.ticks.length, 5);

  const latest = applyScheduleChoice(schedule({ missed: "backfill_each_tick", cap: 3 }), DUE, new Set(), "run_latest_n", { n: 2, now: utc(2026, 1, 5, 14, 30), cursor: utc(2026, 1, 5, 9, 0) });
  assert.equal(latest.ok, true);
  if (!latest.ok) return;
  assert.equal(latest.paused, false);
  assert.equal(latest.clearRequest, true);
  assert.deepEqual(latest.ticks.map((t) => t.fireAt), [DUE[3], DUE[4]]);
  assert.equal(latest.skippedTickIds.length, 3);
  const resume = applyScheduleChoice(schedule({ missed: "backfill_each_tick", cap: 3 }), DUE, new Set(), "skip_backlog_and_resume", { now: utc(2026, 1, 5, 14, 30), cursor: utc(2026, 1, 5, 9, 0) });
  assert.equal(resume.ok, true);
  if (!resume.ok) return;
  assert.deepEqual(resume.ticks, []);
  assert.equal(resume.paused, false);
  assert.equal(resume.clearRequest, true);
  assert.equal(resume.cursor, DUE[4]);

  const limits = clampBackfill({ lookbackMs: 40 * DAY, cap: 900, spacingMs: 0, overlap: "queue" });
  assert.equal(limits.ok, true);
  if (!limits.ok) return;
  assert.equal(limits.guards.lookbackMs, 30 * DAY);
  assert.equal(limits.guards.cap, 500);
});

test("a tick id that already started is ignored", () => {
  const claimed = tickId(AUTOMATION, utc(2026, 1, 5, 12, 0));
  const plan = planSchedule(schedule({ missed: "backfill_each_tick" }), ctx({ startedTickIds: new Set([claimed]) }));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.plan.ticks.map((t) => t.fireAt), [DUE[0], DUE[1], DUE[3], DUE[4]]);
  assert.ok(plan.plan.ticks.every((t) => t.tickId !== claimed));
});

test("spacing holds the rest, and overlap skip drops ticks while a run is active", () => {
  const now = utc(2026, 1, 5, 14, 30);
  const held = planSchedule(schedule({ missed: "backfill_each_tick", spacingMs: 10 * 60_000 }), ctx({ lastStartedAt: now - 1000 }));
  assert.equal(held.ok, true);
  if (!held.ok) return;
  assert.deepEqual(held.plan.ticks, []);
  assert.equal(held.plan.cursor, utc(2026, 1, 5, 9, 0));
  assert.equal(held.plan.paused, false);

  const one = planSchedule(schedule({ missed: "backfill_each_tick", spacingMs: 10 * 60_000 }), ctx({ lastStartedAt: now - 10 * 60_000 }));
  assert.equal(one.ok, true);
  if (!one.ok) return;
  assert.deepEqual(one.plan.ticks.map((t) => t.fireAt), [DUE[0]]);
  assert.equal(one.plan.cursor, DUE[0]);

  const overlap = planSchedule(schedule({ missed: "backfill_each_tick", overlap: "skip_while_active" }), ctx({ activeRunCount: 1 }));
  assert.equal(overlap.ok, true);
  if (!overlap.ok) return;
  assert.deepEqual(overlap.plan.ticks, []);
  assert.equal(overlap.plan.skippedTickIds.length, 5);
  assert.equal(overlap.plan.cursor, DUE[4]);
  assert.equal(overlap.plan.request, undefined);
});

test("the host seam fires automations.fire in order and does not open a second Needs You request", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cap, input });
    if (cap === "tasks.create") return { task: { id: "tsk_sched" } };
    return { runId: "run_sched" };
  };
  const held = new Set<string>();
  const ticks = [
    { automationId: AUTOMATION, tickId: tickId(AUTOMATION, DUE[1]!), fireAt: DUE[1]! },
    { automationId: AUTOMATION, tickId: tickId(AUTOMATION, DUE[0]!), fireAt: DUE[0]! },
  ];
  const claim = { claim(id: string): boolean { if (held.has(id)) return false; held.add(id); return true; } };
  const first = await startScheduledTicks(call, ticks, { now: utc(2026, 1, 5, 14, 30), cron: "0 * * * *", claim });
  assert.deepEqual(first.started.map((t) => t.fireAt), [DUE[0], DUE[1]]);
  assert.equal(calls[0]!.cap, SCHEDULE_FIRE_CAPABILITY);
  assert.equal(calls[0]!.input.idempotencyKey, ticks[1]!.tickId);
  assert.equal(calls[0]!.input.trigger, "schedule");
  assert.equal((calls[0]!.input.payload as { scheduledFor: number }).scheduledFor, DUE[0]);
  const again = await startScheduledTicks(call, ticks, { now: utc(2026, 1, 5, 14, 30), claim });
  assert.deepEqual(again.started, []);
  assert.equal(again.ignored.length, 2);
  assert.equal(calls.filter((c) => c.cap === SCHEDULE_FIRE_CAPABILITY).length, 2);

  const planned = planSchedule(schedule({ missed: "backfill_each_tick", cap: 3 }), ctx());
  assert.equal(planned.ok, true);
  if (!planned.ok || !planned.plan.request) return;
  const before = calls.length;
  const delivered = await deliverScheduleNeedsYou(call, planned.plan.request, new Set());
  assert.equal(delivered.created, true);
  assert.equal(delivered.taskId, "tsk_sched");
  const created = calls.slice(before);
  assert.equal(created[0]!.cap, "tasks.create");
  assert.equal(created[0]!.input.idempotencyKey, planned.plan.request.dedupKey);
  assert.equal(created[1]!.cap, "tasks.followers.add");
  assert.equal(created.filter((c) => c.cap === "notifications.send").length, 2);
  assert.ok(created.filter((c) => c.cap === "notifications.send").every((c) => c.input.collapseKey === planned.plan.request!.dedupKey));
  const repeat = await deliverScheduleNeedsYou(call, planned.plan.request, new Set([planned.plan.request.dedupKey]));
  assert.equal(repeat.created, false);
  assert.equal(calls.length, before + created.length);

  const heldFail = new Set<string>();
  const claimFail = {
    claim(id: string): boolean { if (heldFail.has(id)) return false; heldFail.add(id); return true; },
    release(id: string): void { heldFail.delete(id); },
  };
  let boom = true;
  const failing = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    if (cap === SCHEDULE_FIRE_CAPABILITY && boom) throw new Error("fire failed");
    return { runId: "run_after" };
  };
  const broken = await startScheduledTicks(failing, [ticks[0]!], { now: utc(2026, 1, 5, 14, 30), claim: claimFail });
  assert.equal(broken.started.length, 0);
  assert.equal(broken.failed?.tickId, ticks[0]!.tickId);
  boom = false;
  const retried = await startScheduledTicks(failing, [ticks[0]!], { now: utc(2026, 1, 5, 14, 30), claim: claimFail });
  assert.equal(retried.started.length, 1);

  const keys = await loadOpenScheduleKeys(async () => ({
    tasks: [
      { state: "todo", source: { id: "automation-schedule:aut_a" } },
      { state: "done", source: { id: "automation-schedule:aut_b" } },
      { state: "todo", source: { id: "manual" } },
    ],
  }));
  assert.deepEqual([...keys], ["automation-schedule:aut_a"]);
});
