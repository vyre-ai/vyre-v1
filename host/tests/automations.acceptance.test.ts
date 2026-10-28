// Packet section 17 acceptance flows, on the real runs and automations databases.
// Resume builds a new host object on those same databases. This process is not killed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRunsHost } from "../src/seams/runs.ts";
import type { HostCall } from "../src/seams/runs.ts";
import { deliverScheduleNeedsYou, startScheduledTicks } from "../src/seams/automation-schedule.ts";
import { harness as runsHarness } from "../../modules/runs/fixtures/db.ts";
import { harness as autoHarness } from "../../modules/automations/fixtures/db.ts";
import { alice, engine, HOUR, node, NOW } from "../../modules/automations/fixtures/seed.ts";
import type { Definition } from "../../modules/automations/projections.ts";
import { findAutomation, findRunLink, listChildLinks } from "../../modules/automations/projections.ts";
import { consumeEvent, startRun } from "../../modules/automations/handlers/triggers.ts";
import type { LoggedEvent } from "../../modules/automations/handlers/triggers.ts";
import { hostCalls as autoHost } from "../../modules/automations/impl.ts";
import { hostCalls as stepHost } from "../../modules/steps-core/impl.ts";
import { drive, interrupted, sweepWaits, wake } from "../../modules/runs/handlers/engine.ts";
import { allSteps, findRun, readWait } from "../../modules/runs/projections.ts";
import { askBundle } from "../../modules/automations/ask-vyre.ts";
import { applyScheduleChoice, planSchedule, scheduleRequestKey, tickId } from "../../modules/automations/schedule/index.ts";
import type { AutomationSchedule, PlanContext } from "../../modules/automations/schedule/index.ts";

interface CapCall { cap: string; input: Record<string, unknown> }

const DAY = 24 * HOUR;
const ANCHOR = "evt_appt";
const CONNECTION = "con_google";
const manual = [{ key: "manual" }];
const contact = (fields: Record<string, unknown>) => ({ type: "contact", fields });
const mailInput = (subject: string) => ({ mailboxId: "mbx_1", to: ["a@b.c"], subject, body: subject });
const patch = (id: string, fields: Record<string, unknown>, next?: string[]) =>
  node(id, "records.update", { type: "contact", recordId: "rec_1", patch: fields }, next ? { next } : {});
const letter = (id: string, subject: string, next?: string[]) =>
  node(id, "send_email", mailInput(subject), next ? { next } : {});
const milestone = (id: string, offset: string, next: string[]) =>
  node(id, "wait", { anchorId: ANCHOR, offset, direction: "before" }, { next });

function rig() {
  const calls: CapCall[] = [];
  let startsAt = NOW + 5 * HOUR;
  let revoked = true;
  const runsH = runsHarness({ now: NOW });
  runsH.callee("tasks.create", () => ({ task: { id: "tsk_needs" } }));
  const autoH = autoHarness({
    now: NOW,
    calls: {
      "runs.start": (i) => runsH.call("runs.start", i, engine),
      "runs.stop": (i) => runsH.call("runs.stop", i, engine),
      "runs.get": (i) => runsH.call("runs.get", i, engine),
      "runs.resume": (i) => runsH.call("runs.resume", i, engine),
      "runs.mark_waiting": (i) => runsH.call("runs.mark_waiting", i, engine),
      "runs.steps": (i) => runsH.call("runs.steps", i, engine),
      "runs.list": (i) => runsH.call("runs.list", i, engine),
      "runs.retry": (i) => runsH.call("runs.retry", i, engine),
      "runs.pin_version": (i) => runsH.call("runs.pin_version", i, engine),
      "tasks.create": () => ({ task: { id: "tsk_needs" } }),
    },
  });
  const stepCtx = {
    space: "spc_test",
    principal: { kind: "person", id: alice.id },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => runsH.now(),
    db: { all: () => [], run: () => ({ changes: 0 }) },
    emit: () => ({ id: "evt_step" }),
    async call(cap: string, input: unknown) {
      const body = (input ?? {}) as Record<string, unknown>;
      calls.push({ cap, input: body });
      if (cap === "records.create" || cap === "records.update") return { record: { id: "rec_made", version: 1 } };
      if (cap === "mail.send" || cap === "mail.draft") return { messageId: "msg_1" };
      if (cap === "calendar.get_event") return { event: { startsAt } };
      if (cap === "google.gmail.list_messages") {
        if (revoked) {
          const message = "Google rejected Bearer ya29.super-secret-token";
          throw Object.assign(new Error(message), { error: { code: "provider.auth_failed", message, retryable: false } });
        }
        return { messages: [{ id: "gm_1", threadId: "th_1" }] };
      }
      throw new Error(`unexpected step call ${cap}`);
    },
  };
  const errors: string[] = [];
  let driveCount = 0;
  let host!: ReturnType<typeof createRunsHost>;
  const call: HostCall = async (name, input, as) => {
    if (name === "runs.drive_run") {
      driveCount += 1;
      const runId = (input as { runId: string }).runId;
      const before = findRun(runsH.db, runId);
      if (!before) return "gone";
      try {
        const resolved = await host.resolve({ id: runId });
        if (!resolved) return "not_ours";
        const status = (await drive(runsH.ctxFor(null, engine), runId, resolved.plan, resolved.exec)).status;
        if (before.parentRun) {
          const parent = findRun(runsH.db, before.parentRun);
          if (parent && (parent.status === "queued" || parent.status === "running")) host.enqueue(parent.id);
        }
        return status;
      } catch (e) {
        errors.push(e instanceof Error ? e.stack ?? e.message : String(e));
        throw e;
      }
    }
    if (name === "runs.interrupted") return interrupted(runsH.db);
    if (name.startsWith("automations.")) {
      const fn = autoHost[name as keyof typeof autoHost] as (ctx: unknown, i: unknown) => unknown;
      return fn(autoH.ctxFor(null, engine), input);
    }
    if (name.startsWith("runs.")) return runsH.call(name, input, engine);
    if (name === "steps-core.run_step") {
      return stepHost["steps-core.run_step"]({ ...stepCtx, principal: as?.principal ?? stepCtx.principal } as never, input as never);
    }
    throw new Error(`unexpected host call ${name}`);
  };
  const log = (msg: string, attrs: unknown) => errors.push(`${msg} ${JSON.stringify(attrs)}`);
  host = createRunsHost({ call, log });

  async function drain(): Promise<void> {
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      const mark = driveCount;
      await host.settle(5000);
      await new Promise((r) => setTimeout(r, 0));
      if (errors.length) throw new Error(errors.join("\n"));
      if (driveCount === mark && driveCount === prev) return;
      prev = driveCount;
    }
    const rows = runsH.db.all("SELECT id, status, parent_run, summary FROM runs_items") as { id: string; status: string; parent_run: string | null; summary: string | null }[];
    throw new Error(`drain did not settle ${JSON.stringify(rows)}`);
  }

  async function boot(definition: Definition, name: string, payload: Record<string, unknown> = {}): Promise<{ automationId: string; parentId: string }> {
    const made = await autoH.call("automations.create", { name, definition }, alice);
    const automationId = made.automation.id as string;
    const parentId = await autoH.consumer(engine, (ctx) => {
      const a = findAutomation(ctx.db, automationId);
      if (!a) throw new Error("missing automation");
      return startRun(ctx, a, { trigger: "manual", payload: { startedBy: alice.id, ...payload }, test: false, depth: 0, key: `parent:${automationId}:${ctx.now()}:${Math.random()}`, principal: { kind: "person", id: alice.id } });
    });
    return { automationId, parentId };
  }

  function advance(ms: number): void {
    const n = runsH.now() + ms;
    runsH.setNow(n);
    autoH.setNow(n);
  }

  function reboot(): string[] {
    const ids = interrupted(runsH.db);
    host = createRunsHost({ call, log });
    return ids;
  }

  const caps = (cap: string) => calls.filter((c) => c.cap === cap);
  const run = (id: string) => findRun(runsH.db, id);
  const steps = (id: string) => allSteps(runsH.db, id);
  const children = (parentId: string) => listChildLinks(autoH.db, parentId);

  return {
    get host() { return host; }, calls, caps, boot, drain, advance, reboot, run, steps, children, autoH, runsH, errors,
    setStartsAt(n: number) { startsAt = n; },
    setRevoked(v: boolean) { revoked = v; },
  };
}

function crashStep(w: ReturnType<typeof rig>, runId: string, step: string): void {
  w.runsH.db.run("UPDATE runs_items SET status = ?, wait_reason = NULL WHERE id = ?", "running", runId);
  w.runsH.db.run("UPDATE runs_steps SET state = ? WHERE run_id = ? AND step = ?", "running", runId, step);
  w.runsH.db.run("DELETE FROM runs_waits WHERE run_id = ?", runId);
}

test("form opt-in updates the record, assigns and tags in parallel, then resumes the wait once", async () => {
  const w = rig();
  const def: Definition = {
    triggers: [{ key: "form_submit", filter: { formId: "frm_opt" } }],
    start: ["save"],
    nodes: [
      node("save", "records.update", { type: "contact", recordId: "{{ trigger.recordId }}", patch: { status: "opted_in" } }, { next: ["par"] }),
      node("par", "parallel", { waitFor: "all", branches: ["assign", "tag"] }, {
        branches: [{ label: "Assign", to: "assign" }, { label: "Tags", to: "tag" }], next: ["pause"],
      }),
      patch("assign", { owner: "usr_alice" }, ["pause"]),
      patch("tag", { tags: "member" }, ["pause"]),
      node("pause", "wait", { forDuration: "1h" }, { next: ["mail"] }),
      letter("mail", "Welcome"),
    ],
  };
  const made = await w.autoH.call("automations.create", { name: "Form opt-in", definition: def }, alice);
  const automationId = made.automation.id as string;
  await w.autoH.call("automations.set_enabled", { automationId, enabled: true }, alice);
  const ev: LoggedEvent = { id: "evt_opt", type: "form.submitted", payload: { formId: "frm_opt", recordId: "rec_1", type: "contact", matched: true }, depth: 0 };
  const started = await w.autoH.consumer(engine, (ctx) => consumeEvent(ctx, ev));
  const parentId = started.find((row) => "runId" in row.result)?.result;
  assert.ok(parentId && "runId" in parentId);
  w.host.enqueue(parentId.runId);
  await w.drain();

  assert.equal(w.run(parentId.runId)?.status, "waiting");
  assert.equal(w.caps("mail.send").length, 0);
  const saved = w.caps("records.update").find((c) => (c.input.patch as { status?: string }).status === "opted_in");
  assert.equal(saved?.input.recordId, "rec_1");
  assert.equal(w.children(parentId.runId).length, 2);
  assert.equal(w.caps("records.update").some((c) => (c.input.patch as { owner?: string }).owner === "usr_alice"), true);
  assert.equal(w.caps("records.update").some((c) => (c.input.patch as { tags?: string }).tags === "member"), true);
  assert.equal(w.steps(parentId.runId).find((s) => s.step === "pause")?.state, "waiting");

  const parked = w.reboot();
  assert.equal(parked.includes(parentId.runId), false);
  crashStep(w, parentId.runId, "pause");
  const crashed = w.reboot();
  assert.ok(crashed.includes(parentId.runId));
  w.host.enqueue(parentId.runId);
  await w.drain();
  assert.equal(w.run(parentId.runId)?.status, "waiting");
  assert.equal(w.caps("mail.send").length, 0);
  const pause = w.steps(parentId.runId).filter((s) => s.step === "pause");
  assert.equal(pause.length, 1);
  assert.equal(pause[0]?.attempt, 1);

  w.advance(HOUR);
  const woken = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.deepEqual(woken, [parentId.runId]);
  w.reboot();
  for (const id of woken) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(parentId.runId)?.status, "succeeded", w.run(parentId.runId)?.summary);
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.steps(parentId.runId).filter((s) => s.step === "mail" && s.state === "succeeded").length, 1);

  await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  w.host.enqueue(parentId.runId);
  await w.drain();
  assert.equal(w.caps("mail.send").length, 1);
});

test("an appointment tomorrow skips the seven-day and five-day messages and still updates the record", async () => {
  const w = rig();
  w.setStartsAt(NOW + DAY + 2 * HOUR);
  const def: Definition = {
    triggers: manual,
    start: ["w7"],
    nodes: [
      milestone("w7", "7d", ["m7"]),
      letter("m7", "Seven days", ["tag7"]),
      patch("tag7", { tag: "seven" }, ["w5"]),
      milestone("w5", "5d", ["m5"]),
      letter("m5", "Five days", ["tag5"]),
      patch("tag5", { tag: "five" }, ["w1"]),
      milestone("w1", "1d", ["m1"]),
      letter("m1", "Tomorrow", ["tag1"]),
      patch("tag1", { tag: "day" }),
    ],
  };
  const { parentId } = await w.boot(def, "Appointment tomorrow");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting", w.run(parentId)?.summary);
  assert.equal(w.caps("mail.send").length, 0);
  const early = w.steps(parentId);
  assert.equal(early.find((s) => s.step === "m7")?.state, "skipped");
  assert.equal(early.find((s) => s.step === "m5")?.state, "skipped");
  assert.equal(early.find((s) => s.step === "w1")?.state, "waiting");
  assert.deepEqual(w.caps("records.update").map((c) => (c.input.patch as { tag?: string }).tag), ["seven", "five"]);

  w.advance(2 * HOUR);
  const woken = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.deepEqual(woken, [parentId]);
  for (const id of woken) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.caps("mail.send")[0]?.input.subject, "Tomorrow");
  assert.equal(w.steps(parentId).find((s) => s.step === "m1")?.state, "succeeded");
  assert.deepEqual(w.caps("records.update").map((c) => (c.input.patch as { tag?: string }).tag), ["seven", "five", "day"]);
  assert.equal(w.steps(parentId).filter((s) => s.step === "m7" && s.state === "skipped").length, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "m5" && s.state === "skipped").length, 1);
});

test("rescheduling an appointment moves the unfinished milestone and does not repeat a sent message", async () => {
  const w = rig();
  const first = NOW + 10 * DAY;
  w.setStartsAt(first);
  const def: Definition = {
    triggers: manual,
    start: ["booked"],
    nodes: [
      letter("booked", "Booked", ["w7"]),
      milestone("w7", "7d", ["m7"]),
      letter("m7", "One week", ["w1"]),
      milestone("w1", "1d", ["m1"]),
      letter("m1", "Tomorrow"),
    ],
  };
  const { parentId } = await w.boot(def, "Reschedule");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.caps("mail.send")[0]?.input.subject, "Booked");
  assert.equal((readWait(w.runsH.db, parentId)?.on as { at?: number }).at, first - 7 * DAY);

  const moved = NOW + 20 * DAY;
  w.setStartsAt(moved);
  const woken = await w.runsH.engineRun(engine, (ctx) => wake(ctx, { type: "calendar_event.updated", payload: { eventId: ANCHOR } }));
  assert.deepEqual(woken, [parentId]);
  for (const id of woken) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal((readWait(w.runsH.db, parentId)?.on as { at?: number }).at, moved - 7 * DAY);
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "booked" && s.state === "succeeded").length, 1);

  w.advance((moved - 7 * DAY) - w.runsH.now());
  const due = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  for (const id of due) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting", w.run(parentId)?.summary);
  assert.deepEqual(w.caps("mail.send").map((c) => c.input.subject), ["Booked", "One week"]);
  assert.equal((readWait(w.runsH.db, parentId)?.on as { at?: number }).at, moved - DAY);
  assert.equal(w.steps(parentId).filter((s) => s.step === "m1").length, 0);

  w.setStartsAt(moved + 2 * DAY);
  const again = await w.runsH.engineRun(engine, (ctx) => wake(ctx, { type: "calendar_event.updated", payload: { eventId: ANCHOR } }));
  for (const id of again) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.caps("mail.send").length, 2);
  assert.equal(w.steps(parentId).filter((s) => s.step === "booked").length, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "m7" && s.state === "succeeded").length, 1);
  assert.equal((readWait(w.runsH.db, parentId)?.on as { at?: number }).at, moved + 2 * DAY - DAY);
});

test("a loop of three stakeholders resumes the waiting child on the same node after a new host", async () => {
  const w = rig();
  const def: Definition = {
    triggers: manual,
    start: ["each"],
    nodes: [
      node("each", "loop", {
        items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }],
        concurrency: 1,
        maxIterations: 10,
      }, { branches: [{ label: "body", to: "make" }], next: ["after"] }),
      node("make", "records.create", contact({ name: "{{ item.name }}" }), { next: ["hold"] }),
      node("hold", "wait", { forDuration: "1h" }),
      node("after", "records.update", { type: "contact", recordId: "rec_after", patch: { step: "after" } }),
    ],
  };
  const { parentId } = await w.boot(def, "Stakeholders");
  w.host.enqueue(parentId);
  await w.drain();
  const kids = w.children(parentId);
  assert.equal(kids.length, 3);
  const ada = kids.find((k) => k.scope?.iterationKey === "a")!;
  assert.equal(w.run(ada.runId)?.status, "waiting");
  assert.equal(w.steps(ada.runId).find((s) => s.step === "make")?.state, "succeeded");
  assert.equal(w.steps(ada.runId).find((s) => s.step === "hold")?.state, "waiting");
  assert.equal(w.reboot().includes(ada.runId), false);

  crashStep(w, ada.runId, "hold");
  const crashed = w.reboot();
  assert.ok(crashed.includes(ada.runId));
  w.host.enqueue(ada.runId);
  await w.drain();
  assert.equal(w.children(parentId).find((k) => k.scope?.iterationKey === "a")?.runId, ada.runId);
  const hold = w.steps(ada.runId).filter((s) => s.step === "hold");
  assert.equal(hold.length, 1);
  assert.equal(hold[0]?.attempt, 1);
  assert.equal(hold[0]?.state, "waiting");
  assert.equal(w.caps("records.create").map((c) => (c.input.fields as { name?: string }).name).join(","), "Ada");

  w.advance(HOUR);
  const woken = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.deepEqual(woken, [ada.runId]);
  w.reboot();
  for (const id of woken) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(ada.runId)?.status, "succeeded", w.run(ada.runId)?.summary);
  assert.equal(w.steps(ada.runId).filter((s) => s.step === "make").length, 1);
  const names = w.caps("records.create").map((c) => (c.input.fields as { name?: string }).name);
  assert.deepEqual(names, ["Ada", "Bea"]);
  const bea = w.children(parentId).find((k) => k.scope?.iterationKey === "b")!;
  assert.equal(w.steps(bea.runId).find((s) => s.step === "hold")?.state, "waiting");
  const cy = w.children(parentId).find((k) => k.scope?.iterationKey === "c")!;
  assert.equal(cy.scope?.held, true);
  assert.equal(w.steps(cy.runId).length, 0);
  assert.equal(w.children(parentId).length, 3);
});

test("seventy-three missed ticks open one Needs You item, and latest N does not start them twice", async () => {
  const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);
  const automationId = "aut_sched73";
  const spec: AutomationSchedule = {
    automationId, cron: "0 * * * *", timezone: "UTC", missed: "backfill_each_tick",
    lookbackMs: 30 * DAY, cap: 10, spacingMs: 0, overlap: "queue",
  };
  const ctx: PlanContext = {
    now: utc(2026, 1, 4, 1, 30), cursor: utc(2026, 1, 1, 0, 0), ownerId: "usr_owner", sharedRecipientIds: ["usr_shared"], onTimeMs: 60_000,
  };
  const first = planSchedule(spec, ctx);
  assert.equal(first.ok, true);
  if (!first.ok || !first.plan.request) return;
  assert.equal(first.plan.backlogCount, 73);
  assert.equal(first.plan.paused, true);
  assert.equal(first.plan.pausedReason, "backfill_over_cap");
  assert.deepEqual(first.plan.ticks, []);
  assert.equal(first.plan.request.dedupKey, scheduleRequestKey(automationId));
  assert.equal(first.plan.request.task.kind, "unblock");

  const again = planSchedule(spec, { ...ctx, openRequestKeys: new Set([first.plan.request.dedupKey]) });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.plan.request, undefined);
  assert.equal(again.plan.deduped, true);
  assert.equal(again.plan.paused, true);
  assert.deepEqual(again.plan.ticks, []);

  const choice = applyScheduleChoice(spec, first.plan.backlog, new Set(), "run_latest_n", { n: 5, now: ctx.now, cursor: ctx.cursor });
  assert.equal(choice.ok, true);
  if (!choice.ok) return;
  assert.equal(choice.ticks.length, 5);
  assert.equal(choice.clearRequest, true);
  assert.equal(choice.paused, false);
  assert.deepEqual(choice.ticks.map((t) => t.fireAt), [
    utc(2026, 1, 3, 21, 0), utc(2026, 1, 3, 22, 0), utc(2026, 1, 3, 23, 0), utc(2026, 1, 4, 0, 0), utc(2026, 1, 4, 1, 0),
  ]);
  assert.equal(choice.skippedTickIds.length, 68);

  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ cap, input });
    if (cap === "tasks.create") return { task: { id: "tsk_sched" } };
    return { runId: `run_${calls.length}` };
  };
  const held = new Set<string>();
  const claim = { claim(id: string): boolean { if (held.has(id)) return false; held.add(id); return true; } };
  const started = await startScheduledTicks(call, choice.ticks, { now: ctx.now, cron: spec.cron, claim });
  assert.equal(started.started.length, 5);
  assert.deepEqual(started.started.map((t) => t.tickId), choice.ticks.map((t) => tickId(automationId, t.fireAt)));
  const second = await startScheduledTicks(call, choice.ticks, { now: ctx.now, cron: spec.cron, claim });
  assert.deepEqual(second.started, []);
  assert.equal(second.ignored.length, 5);
  assert.equal(calls.filter((c) => c.cap === "automations.fire").length, 5);

  const open = new Set<string>();
  const delivered = await deliverScheduleNeedsYou(call, first.plan.request, open);
  assert.equal(delivered.created, true);
  open.add(first.plan.request.dedupKey);
  const repeat = await deliverScheduleNeedsYou(call, first.plan.request, open);
  assert.equal(repeat.created, false);
  assert.equal(calls.filter((c) => c.cap === "tasks.create").length, 1);
});

test("a revoked Google account fails the step, Ask Vyre drops the token, and the same connection retries", async () => {
  const w = rig();
  w.setRevoked(true);
  const def: Definition = {
    triggers: manual,
    start: ["gmail"],
    nodes: [node("gmail", "google.gmail.list_messages", { connectionId: CONNECTION, q: "newer_than:1d" })],
  };
  const { automationId, parentId } = await w.boot(def, "Google account");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "failed", w.run(parentId)?.summary);
  const failed = w.steps(parentId).find((s) => s.step === "gmail");
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.error?.code, "provider.auth_failed");
  assert.match(failed?.error?.message ?? "", /ya29\.super-secret-token/);
  assert.equal(w.caps("google.gmail.list_messages")[0]?.input.connectionId, CONNECTION);

  const bundle = askBundle({
    resource: "run",
    errorCode: failed?.error?.code,
    message: failed?.error?.message,
    connectionId: CONNECTION,
    connectionState: "revoked",
    nodeId: "gmail",
    stepKey: "google.gmail.list_messages",
    authorization: "Bearer ya29.super-secret-token",
  });
  assert.equal(bundle.connectionId, CONNECTION);
  assert.equal(bundle.errorCode, "provider.auth_failed");
  assert.equal(bundle.connectionState, "revoked");
  assert.equal(bundle.message?.includes("ya29"), false);
  assert.equal("authorization" in bundle, false);

  w.setRevoked(false);
  const retried = await w.autoH.call("automations.retry", { automationId, runId: parentId, fromStep: "gmail" }, alice) as { runId: string };
  assert.notEqual(retried.runId, parentId);
  assert.equal(findRunLink(w.autoH.db, retried.runId)?.version, findRunLink(w.autoH.db, parentId)?.version);
  w.host.enqueue(retried.runId);
  await w.drain();
  assert.equal(w.run(retried.runId)?.status, "succeeded", w.run(retried.runId)?.summary);
  assert.equal(w.run(parentId)?.status, "failed");
  const google = w.caps("google.gmail.list_messages");
  assert.equal(google.length, 2);
  assert.ok(google.every((c) => c.input.connectionId === CONNECTION));
  assert.equal(w.steps(retried.runId).find((s) => s.step === "gmail")?.state, "succeeded");
});

test("publishing version 13 leaves version 12 runs in place and previews safe and ambiguous groups", async () => {
  const w = rig();
  const cohort = (hours: string, riskKey: "wait" | "send_email"): Definition => ({
    triggers: manual,
    start: ["gate"],
    nodes: [
      node("gate", "if", { condition: "trigger.risk == true" }, { branches: [{ label: "then", to: "risk" }, { label: "else", to: "hold" }] }),
      node("hold", "wait", { forDuration: hours }),
      riskKey === "wait"
        ? node("risk", "wait", { forDuration: hours })
        : letter("risk", "Moved"),
    ],
  });
  const made = await w.autoH.call("automations.create", { name: "Versions", definition: cohort("1h", "wait") }, alice);
  const automationId = made.automation.id as string;
  for (let version = 1; version < 12; version++) {
    await w.autoH.call("automations.update", { automationId, definition: cohort(`${version + 1}h`, "wait"), expectedVersion: version }, alice);
  }
  assert.equal((await w.autoH.call("automations.get", { automationId }, alice)).automation.version, 12);

  const start = async (risk: boolean): Promise<string> => {
    const id = await w.autoH.consumer(engine, (ctx) => {
      const a = findAutomation(ctx.db, automationId);
      if (!a) throw new Error("missing automation");
      return startRun(ctx, a, {
        trigger: "manual", payload: { startedBy: alice.id, ...(risk ? { risk: true } : {}) }, test: false, depth: 0,
        key: `enroll:${automationId}:${risk}:${ctx.now()}:${Math.random()}`, principal: { kind: "person", id: alice.id },
      });
    });
    w.host.enqueue(id);
    await w.drain();
    return id;
  };
  const safeId = await start(false);
  const riskId = await start(true);
  assert.equal(findRunLink(w.autoH.db, safeId)?.version, 12);
  assert.equal(findRunLink(w.autoH.db, riskId)?.version, 12);
  assert.equal(w.run(safeId)?.status, "waiting");
  assert.equal(w.run(riskId)?.status, "waiting");
  assert.equal(w.steps(safeId).find((s) => s.state === "waiting")?.step, "hold");
  assert.equal(w.steps(riskId).find((s) => s.state === "waiting")?.step, "risk");

  await w.autoH.call("automations.update", { automationId, definition: cohort("12h", "send_email"), expectedVersion: 12 }, alice);
  assert.equal((await w.autoH.call("automations.get", { automationId }, alice)).automation.version, 13);
  const freshId = await w.autoH.consumer(engine, (ctx) => {
    const a = findAutomation(ctx.db, automationId);
    if (!a) throw new Error("missing automation");
    return startRun(ctx, a, { trigger: "manual", payload: { startedBy: alice.id }, test: false, depth: 0, key: `enroll:${automationId}:new`, principal: { kind: "person", id: alice.id } });
  });
  assert.equal(findRunLink(w.autoH.db, freshId)?.version, 13);
  assert.equal(w.run(freshId)?.definitionVersion, 13);
  assert.equal(findRunLink(w.autoH.db, safeId)?.version, 12);
  assert.equal(findRunLink(w.autoH.db, riskId)?.version, 12);
  assert.equal(w.run(safeId)?.definitionVersion, 12);
  assert.equal(w.run(riskId)?.definitionVersion, 12);

  const preview = await w.autoH.call("automations.migration_preview", { automationId, toVersion: 13 }, alice) as {
    cohorts: { definitionVersion: number; disposition: string; runIds: string[] }[];
  };
  const old = preview.cohorts.filter((c) => c.definitionVersion === 12);
  const safeGroup = old.find((c) => c.disposition === "safe" && c.runIds.includes(safeId));
  const ambiguous = old.find((c) => c.disposition === "ambiguous" && c.runIds.includes(riskId));
  assert.ok(safeGroup, JSON.stringify(preview.cohorts));
  assert.ok(ambiguous, JSON.stringify(preview.cohorts));
});