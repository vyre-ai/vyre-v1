// Parallel lanes and Loop iterations are child Runs. A missed milestone skips outward steps. The host queue drives each Run; this file wires the real runs and automations databases behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRunsHost } from "../src/seams/runs.ts";
import type { HostCall } from "../src/seams/runs.ts";
import { harness as runsHarness } from "../../modules/runs/fixtures/db.ts";
import { harness as autoHarness } from "../../modules/automations/fixtures/db.ts";
import { alice, engine, HOUR, node, NOW } from "../../modules/automations/fixtures/seed.ts";
import type { Definition } from "../../modules/automations/projections.ts";
import { findAutomation, findRunLink, listChildLinks } from "../../modules/automations/projections.ts";
import { startRun } from "../../modules/automations/handlers/triggers.ts";
import { hostCalls as autoHost } from "../../modules/automations/impl.ts";
import { hostCalls as stepHost } from "../../modules/steps-core/impl.ts";
import { drive, sweepWaits, wake } from "../../modules/runs/handlers/engine.ts";
import { allSteps, findRun, readWait } from "../../modules/runs/projections.ts";
import { interrupted } from "../../modules/runs/handlers/engine.ts";

interface CapCall { cap: string; input: Record<string, unknown> }

const manual = [{ key: "manual" }];
const contact = (fields: Record<string, unknown>) => ({ type: "contact", fields });

function parallelDef(waitInLane: boolean): Definition {
  const leftRest = waitInLane
    ? [
        node("a2", "wait", { forDuration: "1h" }, { next: ["a3"] }),
        node("a3", "records.update", { type: "contact", recordId: "rec_left", patch: { step: "a3" } }, { next: ["join"] }),
      ]
    : [node("a2", "records.update", { type: "contact", recordId: "rec_left", patch: { step: "a2" } }, { next: ["join"] })];
  return {
    triggers: manual,
    start: ["par"],
    nodes: [
      node("par", "parallel", { waitFor: "all" }, { branches: [{ label: "Left", to: "a1" }, { label: "Right", to: "b1" }], next: ["join"] }),
      node("a1", "records.create", contact({ lane: "left" }), { next: ["a2"] }),
      ...leftRest,
      node("b1", "records.create", contact({ lane: "right" }), { next: ["join"] }),
      node("join", "records.update", { type: "contact", recordId: "rec_join", patch: { step: "join" } }),
    ],
  };
}

function loopDef(): Definition {
  return {
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
}

function rig() {
  const calls: CapCall[] = [];
  let startsAt = NOW + 5 * HOUR;
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
  host = createRunsHost({
    call,
    log: (msg, attrs) => errors.push(`${msg} ${JSON.stringify(attrs)}`),
  });

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

  async function boot(definition: Definition, name: string): Promise<{ automationId: string; parentId: string }> {
    const made = await autoH.call("automations.create", { name, definition }, alice);
    const automationId = made.automation.id as string;
    const parentId = await autoH.consumer(engine, (ctx) => {
      const a = findAutomation(ctx.db, automationId);
      if (!a) throw new Error("missing automation");
      return startRun(ctx, a, { trigger: "manual", payload: { startedBy: alice.id }, test: false, depth: 0, key: `parent:${automationId}`, principal: { kind: "person", id: alice.id } });
    });
    return { automationId, parentId };
  }

  function advance(ms: number): void {
    const n = runsH.now() + ms;
    runsH.setNow(n);
    autoH.setNow(n);
  }

  const caps = (cap: string) => calls.filter((c) => c.cap === cap);
  const run = (id: string) => findRun(runsH.db, id);
  const steps = (id: string) => allSteps(runsH.db, id);
  const children = (parentId: string) => listChildLinks(autoH.db, parentId);

  return { host, calls, caps, boot, drain, advance, run, steps, children, autoH, runsH, errors, setStartsAt(n: number) { startsAt = n; } };
}

test("two parallel lanes become two child Runs and the parent joins once", async () => {
  const w = rig();
  const def = parallelDef(false);
  const { automationId, parentId } = await w.boot(def, "Split");
  const rewritten = structuredClone(def);
  rewritten.nodes.find((n) => n.id === "a1")!.input = contact({ lane: "rewritten" });
  await w.autoH.call("automations.update", { automationId, definition: rewritten, expectedVersion: 1 }, alice);
  w.host.enqueue(parentId);
  await w.drain();

  const parent = w.run(parentId);
  assert.equal(parent?.status, "succeeded", parent?.summary);
  const kids = w.children(parentId);
  assert.equal(kids.length, 2);
  const left = kids.find((k) => k.scope?.laneId === "Left");
  const right = kids.find((k) => k.scope?.laneId === "Right");
  assert.ok(left && right);
  assert.equal(left.version, 1);
  assert.equal(right.version, 1);
  assert.equal(findRunLink(w.autoH.db, parentId)?.version, 1);
  assert.equal((await w.autoH.call("automations.get", { automationId }, alice)).automation.version, 2);
  assert.equal(left.parentRun, parentId);
  assert.equal(left.scope?.containerNodeId, "par");
  assert.equal(w.run(left.runId)?.parentRun, parentId);
  assert.deepEqual(w.steps(parentId).map((s) => s.step), ["par", "join"]);
  assert.deepEqual(w.steps(left.runId).map((s) => [s.step, s.state]), [["a1", "succeeded"], ["a2", "succeeded"]]);
  assert.deepEqual(w.steps(right.runId).map((s) => [s.step, s.state]), [["b1", "succeeded"]]);
  const creates = w.caps("records.create");
  assert.equal(creates.length, 2);
  const leftCreate = creates.find((c) => (c.input.fields as { lane?: string }).lane === "left");
  assert.equal(leftCreate?.input.idempotencyKey, `${left.runId}:a1:1`);
  assert.equal(creates.filter((c) => (c.input.fields as { lane?: string }).lane === "rewritten").length, 0);
  const join = w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "join");
  assert.equal(join.length, 1);

  const again = await w.host.resolve({ id: parentId });
  assert.ok(again);
  const par = again.plan.find((s) => s.id === "par");
  assert.ok(par);
  await again.exec(par as never, { attempt: 1, key: "again", input: par.input, outputs: {}, sandbox: false, resumed: true, startedAt: NOW } as never);
  assert.equal(w.children(parentId).length, 2);
});

test("a wait inside a lane parks only that child, then the parent joins once", async () => {
  const w = rig();
  const { parentId } = await w.boot(parallelDef(true), "Wait in a lane");
  w.host.enqueue(parentId);
  await w.drain();

  const kids = w.children(parentId);
  const left = kids.find((k) => k.scope?.laneId === "Left")!;
  const right = kids.find((k) => k.scope?.laneId === "Right")!;
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.run(left.runId)?.status, "waiting");
  assert.equal(w.run(right.runId)?.status, "succeeded");
  assert.equal(w.steps(left.runId).find((s) => s.step === "a2")?.state, "waiting");
  assert.equal(w.steps(left.runId).some((s) => s.step === "a3"), false);
  assert.equal(w.caps("records.update").some((c) => (c.input.patch as { step?: string }).step === "a3"), false);
  assert.equal(w.caps("records.update").some((c) => (c.input.patch as { step?: string }).step === "join"), false);
  assert.equal(w.steps(parentId).map((s) => s.step).includes("join"), false);

  w.advance(HOUR);
  const woken = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.ok(woken.includes(left.runId));
  assert.equal(woken.includes(parentId), false);
  for (const id of woken) w.host.enqueue(id);
  await w.drain();

  assert.equal(w.run(left.runId)?.status, "succeeded", w.run(left.runId)?.summary);
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.deepEqual(w.steps(left.runId).map((s) => [s.step, s.state]), [["a1", "succeeded"], ["a2", "succeeded"], ["a3", "succeeded"]]);
  assert.equal(w.caps("records.create").filter((c) => (c.input.fields as { lane?: string }).lane === "left").length, 1);
  assert.equal(w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "a3").length, 1);
  assert.equal(w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "join").length, 1);
  assert.deepEqual(w.steps(parentId).map((s) => [s.step, s.state]), [["par", "succeeded"], ["join", "succeeded"]]);
});

test("a crashed child resumes at the incomplete step and a parked parent wakes when its children are terminal", async () => {
  const w = rig();
  const { parentId } = await w.boot(parallelDef(true), "Crash resume");
  w.host.enqueue(parentId);
  await w.drain();
  const left = w.children(parentId).find((k) => k.scope?.laneId === "Left")!;
  const right = w.children(parentId).find((k) => k.scope?.laneId === "Right")!;
  const creates = () => w.caps("records.create").filter((c) => (c.input.fields as { lane?: string }).lane === "left").length;
  assert.equal(creates(), 1);
  assert.equal(w.steps(left.runId).filter((s) => s.step === "a1" && s.state === "succeeded").length, 1);

  w.runsH.db.run("UPDATE runs_items SET status = ?, wait_reason = NULL WHERE id = ?", "running", left.runId);
  w.runsH.db.run("UPDATE runs_steps SET state = ? WHERE run_id = ? AND step = ?", "running", left.runId, "a2");
  w.runsH.db.run("DELETE FROM runs_waits WHERE run_id = ?", left.runId);
  w.host.enqueue(left.runId);
  await w.drain();
  assert.equal(creates(), 1);
  assert.equal(w.run(left.runId)?.status, "waiting");
  const a2 = w.steps(left.runId).filter((s) => s.step === "a2");
  assert.equal(a2.length, 1);
  assert.equal(a2[0]?.attempt, 1);
  assert.equal(a2[0]?.state, "waiting");
  assert.equal(w.run(parentId)?.status, "waiting");

  await w.runsH.call("runs.resume", { runId: left.runId, reason: "background" }, engine);
  w.host.enqueue(left.runId);
  await w.drain();
  assert.equal(creates(), 1);
  assert.equal(w.steps(left.runId).filter((s) => s.step === "a1").length, 1);
  assert.equal(w.run(left.runId)?.status, "waiting");

  w.runsH.db.run("UPDATE runs_items SET status = ?, wait_reason = NULL, ended_at = ? WHERE id = ?", "succeeded", w.runsH.now(), left.runId);
  w.runsH.db.run("UPDATE runs_items SET status = ? WHERE id = ?", "succeeded", right.runId);
  w.runsH.db.run("DELETE FROM runs_waits WHERE run_id = ?", left.runId);
  assert.equal(w.run(parentId)?.status, "waiting");
  await w.host.recover();
  await w.drain();
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.equal(w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "join").length, 1);
  assert.equal(creates(), 1);
});

test("a loop of three items creates three child Runs and resumes a waiting child at its incomplete step", async () => {
  const w = rig();
  const { parentId } = await w.boot(loopDef(), "Each person");
  w.host.enqueue(parentId);
  await w.drain();

  const kids = w.children(parentId);
  assert.equal(kids.length, 3);
  assert.deepEqual(kids.map((k) => k.scope?.iterationKey).sort(), ["a", "b", "c"]);
  const live = kids.find((k) => k.scope?.held !== true)!;
  const held = kids.filter((k) => k.scope?.held === true);
  assert.equal(held.length, 2);
  assert.equal(live.scope?.iterationKey, "a");
  assert.equal(live.scope?.iterationIndex, 0);
  assert.equal(w.run(live.runId)?.status, "waiting");
  assert.equal(w.steps(live.runId).find((s) => s.step === "make")?.state, "succeeded");
  assert.equal(w.steps(live.runId).find((s) => s.step === "hold")?.state, "waiting");
  assert.equal(w.caps("records.create").map((c) => (c.input.fields as { name?: string }).name).join(","), "Ada");
  assert.equal(w.caps("records.create")[0]?.input.idempotencyKey, `${live.runId}:make:1`);
  for (const h of held) {
    assert.equal(w.run(h.runId)?.status, "waiting");
    const slot = readWait(w.runsH.db, h.runId);
    assert.equal(slot?.label, "a loop slot");
    assert.equal((slot?.on as { at?: number } | undefined)?.at, undefined);
    assert.equal(w.steps(h.runId).length, 0);
  }
  assert.equal(w.run(parentId)?.status, "waiting");

  await w.runsH.call("runs.resume", { runId: parentId, reason: "background" }, engine);
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.children(parentId).length, 3);
  assert.equal(w.caps("records.create").length, 1);

  await w.runsH.call("runs.resume", { runId: live.runId, reason: "background" }, engine);
  w.host.enqueue(live.runId);
  await w.drain();
  assert.equal(w.caps("records.create").length, 1);
  assert.equal(w.steps(live.runId).filter((s) => s.step === "make" && s.state === "succeeded").length, 1);
  assert.equal(w.run(live.runId)?.status, "waiting");
  assert.equal(w.steps(live.runId).find((s) => s.step === "hold")?.state, "waiting");

  w.advance(HOUR);
  const woken = await w.runsH.engineRun(engine, (ctx) => sweepWaits(ctx));
  assert.deepEqual(woken, [live.runId]);
  for (const id of woken) w.host.enqueue(id);
  await w.drain();

  assert.equal(w.run(live.runId)?.status, "succeeded", w.run(live.runId)?.summary);
  assert.equal(w.steps(live.runId).filter((s) => s.step === "make").length, 1);
  const names = w.caps("records.create").map((c) => (c.input.fields as { name?: string }).name);
  assert.deepEqual(names, ["Ada", "Bea"]);
  const next = w.children(parentId).find((k) => k.scope?.iterationKey === "b")!;
  assert.equal(next.scope?.held, false);
  assert.equal(w.run(next.runId)?.status, "waiting");
  assert.equal(w.steps(next.runId).find((s) => s.step === "make")?.state, "succeeded");
  assert.equal(w.steps(next.runId).find((s) => s.step === "hold")?.state, "waiting");
  const still = w.children(parentId).find((k) => k.scope?.iterationKey === "c")!;
  assert.equal(still.scope?.held, true);
  assert.equal(w.steps(still.runId).length, 0);
  assert.equal(w.run(parentId)?.status, "waiting");
});

test("a milestone that is already past skips outward steps and still updates the record", async () => {
  const w = rig();
  const def: Definition = {
    triggers: manual,
    start: ["pause"],
    nodes: [
      node("pause", "wait", { at: NOW - HOUR }, { next: ["mail"] }),
      node("mail", "send_email", { mailboxId: "mbx_1", to: ["a@b.c"], subject: "Hi", body: "There" }, { next: ["upd"] }),
      node("upd", "records.update", { type: "contact", recordId: "rec_1", patch: { status: "active" } }),
    ],
  };
  const { parentId } = await w.boot(def, "Missed milestone");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  const rows = w.steps(parentId);
  assert.deepEqual(rows.map((s) => [s.step, s.state]), [["pause", "succeeded"], ["mail", "skipped"], ["upd", "succeeded"]]);
  assert.deepEqual(JSON.parse(rows[0]!.outputJson!), { missed: true, skipTimeSensitive: true, reason: "milestone_passed" });
  assert.deepEqual(JSON.parse(rows[1]!.outputJson!), { skipped: true, reason: "milestone_passed" });
  assert.equal(w.caps("mail.send").length, 0);
  assert.equal(w.caps("records.update").length, 1);
  assert.equal((w.caps("records.update")[0]!.input.patch as { status?: string }).status, "active");
});

test("reschedule and cancel leave a succeeded send as it is", async () => {
  const w = rig();
  w.setStartsAt(NOW + 5 * HOUR);
  const def: Definition = {
    triggers: manual,
    start: ["mail"],
    nodes: [
      node("mail", "send_email", { mailboxId: "mbx_1", to: ["a@b.c"], subject: "Hi", body: "Sent" }, { next: ["pause"] }),
      node("pause", "wait", { at: NOW + 2 * HOUR, anchorId: "evt_cal", direction: "after" }),
    ],
  };
  const { parentId } = await w.boot(def, "Follow the meeting");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.steps(parentId).find((s) => s.step === "mail")?.state, "succeeded");
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.caps("mail.send")[0]?.input.idempotencyKey, `${parentId}:mail:1`);
  const parked = readWait(w.runsH.db, parentId);
  assert.equal((parked?.on as { at?: number; anchorId?: string }).at, NOW + 2 * HOUR);
  assert.equal((parked?.on as { anchorId?: string }).anchorId, "evt_cal");

  const woken = await w.runsH.engineRun(engine, (ctx) => wake(ctx, { type: "calendar_event.updated", payload: { eventId: "evt_cal" } }));
  assert.deepEqual(woken, [parentId]);
  for (const id of woken) w.host.enqueue(id);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.caps("calendar.get_event").length, 1);
  assert.equal((readWait(w.runsH.db, parentId)?.on as { at?: number }).at, NOW + 5 * HOUR);
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "mail" && s.state === "succeeded").length, 1);

  await w.runsH.engineRun(engine, (ctx) => wake(ctx, { type: "calendar_event.deleted", payload: { eventId: "evt_cal" } }));
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "stopped");
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "mail").length, 1);
  assert.equal(w.steps(parentId).find((s) => s.step === "mail")?.state, "succeeded");
});
