// The schedule clock: a due tick starts one run, a second pass does not, and an over-cap backlog opens one Needs You request.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, create, goodDefinition, node } from "../fixtures/seed.ts";
import { hostCalls, periodic } from "../impl.ts";
import { chooseScheduleRecovery, runDueSchedules } from "./live.ts";
import { saveCursor } from "./state.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 30);

function definition(config: Record<string, unknown>) {
  return goodDefinition({
    triggers: [{ key: "schedule", config }],
    nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" } })],
  });
}

function stubNeedsYou(h: ReturnType<typeof harness>) {
  const tasks: { id: string; state: string; source: { id: string }; kind: string }[] = [];
  h.callee("runs.list", () => ({ runs: [], total: 0 }));
  h.callee("tasks.list", () => ({ tasks, next: undefined }));
  h.callee("tasks.create", (input) => {
    const task = { id: "tsk_schedcap", state: "todo", source: input.source as { id: string }, kind: "unblock" };
    tasks.push(task);
    return { task };
  });
  h.callee("tasks.followers.add", () => ({ task: tasks[0] }));
  h.callee("notifications.send", () => ({ outcome: "badge" }));
  h.callee("tasks.act", (input) => {
    const task = tasks.find((row) => row.id === input.taskId);
    if (task) task.state = "done";
    return { task };
  });
  return tasks;
}

test("the first look arms the cursor and a later minute starts one run, once", async () => {
  const h = harness({ now: T0 });
  stubNeedsYou(h);
  const id = (await h.call("automations.create", create({ definition: definition({ cron: "* * * * *", timezone: "UTC", missed: "skip" }) }), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  const armed = await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  assert.deepEqual(armed.started, []);
  assert.deepEqual(armed.armed, [id]);
  h.setNow(T0 + 2 * MINUTE);
  const due = await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  assert.equal(due.started.length, 1);
  assert.equal(due.started[0]!.automationId, id);
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0]!.definitionVersion, 1);
  const again = await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  assert.deepEqual(again.started, []);
  assert.equal(h.runs.length, 1);
  assert.ok(periodic["automations.schedule_tick"]);
});

test("a backlog over the cap pauses that schedule and opens one Needs You request", async () => {
  const h = harness({ now: T0 });
  const tasks = stubNeedsYou(h);
  const config = {
    cron: "* * * * *", timezone: "UTC", missed: "backfill_each_tick",
    lookbackMs: 30 * 24 * HOUR, cap: 2, spacingMs: 0, overlap: "queue",
  };
  const id = (await h.call("automations.create", create({ definition: definition(config) }), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  saveCursor(h.db, id, T0 - 3 * HOUR, T0);
  h.setNow(T0 + MINUTE);
  const paused = await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  assert.deepEqual(paused.started, []);
  assert.deepEqual(paused.paused, [id]);
  assert.equal(h.runs.length, 0);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.source.id, `automation-schedule:${id}`);
  const row = h.db.all(`SELECT "status", "paused_reason" FROM "automations_defs" WHERE "id" = ?`, id) as { status: string; paused_reason: string }[];
  assert.equal(row[0]!.status, "paused");
  assert.equal(row[0]!.paused_reason, "Schedule backlog is over its cap");
  const again = await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  assert.equal(tasks.length, 1, "a second pass does not open another request");
  assert.deepEqual(again.started, []);

  const chosen = await h.consumer(alice, (ctx) => chooseScheduleRecovery(ctx, { automationId: id, choice: "run_first_n", n: 2 }));
  assert.equal(chosen.ok, true);
  if (!chosen.ok) return;
  assert.equal(chosen.started.length, 2);
  assert.equal(chosen.paused, false);
  assert.equal(h.runs.length, 2);
  const ids = h.runs.map((run) => run.id);
  assert.equal(new Set(ids).size, 2);
  const after = h.db.all(`SELECT "status" FROM "automations_defs" WHERE "id" = ?`, id) as { status: string }[];
  assert.equal(after[0]!.status, "on");
  const repeat = await h.consumer(alice, (ctx) => chooseScheduleRecovery(ctx, { automationId: id, choice: "run_first_n", n: 2 }));
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(h.runs.length, 2, "the same ticks are not started again");
  assert.equal(typeof hostCalls["automations.schedule_choose"], "function");
});

test("skip backlog is a capability a person can call", async () => {
  const h = harness({ now: T0 });
  stubNeedsYou(h);
  const config = {
    cron: "* * * * *", timezone: "UTC", missed: "backfill_each_tick",
    lookbackMs: 30 * 24 * HOUR, cap: 2, spacingMs: 0, overlap: "queue",
  };
  const id = (await h.call("automations.create", create({ definition: definition(config) }), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  saveCursor(h.db, id, T0 - 3 * HOUR, T0);
  h.setNow(T0 + MINUTE);
  await h.consumer(alice, (ctx) => runDueSchedules(ctx));
  const chosen = await h.call("automations.schedule_choose", { automationId: id, choice: "skip_backlog_and_resume" }, alice) as { ok: boolean; started: unknown[]; paused: boolean };
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.started, []);
  assert.equal(chosen.paused, false);
  assert.equal(h.runs.length, 0);
  const after = h.db.all(`SELECT "status" FROM "automations_defs" WHERE "id" = ?`, id) as { status: string }[];
  assert.equal(after[0]!.status, "on");
  const again = await h.call("automations.schedule_choose", { automationId: id, choice: "skip_backlog_and_resume" }, alice) as { ok: boolean; started: unknown[] };
  assert.equal(again.ok, true);
  assert.equal(h.runs.length, 0);
});
