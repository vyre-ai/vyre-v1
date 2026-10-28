// Matrix rows the three-item loop, all-join, and preview-only cohort tests do not close.
// Any-join is a product behavior. All-join is the other one, covered by the lane wait test.
import test from "node:test";
import assert from "node:assert/strict";
import { createRunsHost } from "../src/seams/runs.ts";
import type { HostCall } from "../src/seams/runs.ts";
import { harness as runsHarness } from "../../modules/runs/fixtures/db.ts";
import { harness as autoHarness, codeOf, reasonOf } from "../../modules/automations/fixtures/db.ts";
import { alice, engine, node, NOW } from "../../modules/automations/fixtures/seed.ts";
import type { Definition } from "../../modules/automations/projections.ts";
import { findRunLink, listChildLinks } from "../../modules/automations/projections.ts";
import { findAutomation } from "../../modules/automations/projections.ts";
import { startRun } from "../../modules/automations/handlers/triggers.ts";
import { hostCalls as autoHost } from "../../modules/automations/impl.ts";
import { hostCalls as stepHost } from "../../modules/steps-core/impl.ts";
import { drive, interrupted } from "../../modules/runs/handlers/engine.ts";
import { allSteps, findRun } from "../../modules/runs/projections.ts";

interface CapCall { cap: string; input: Record<string, unknown> }

const LOOP_MAX = 1000;
const CONCURRENCY_MAX = 20;
const manual = [{ key: "manual" }];
const contact = (fields: Record<string, unknown>) => ({ type: "contact", fields });
const mailInput = (subject: string, body = subject) => ({ mailboxId: "mbx_1", to: ["a@b.c"], subject, body });

function loopOf(items: unknown[], concurrency: number, maxIterations: number, body: "make" | "hold"): Definition {
  const step = body === "hold"
    ? node("hold", "wait", { forDuration: "1h" })
    : node("make", "records.create", contact({ name: "{{ item.name }}" }));
  return {
    triggers: manual,
    start: ["each"],
    nodes: [
      node("each", "loop", { items, concurrency, maxIterations }, { branches: [{ label: "body", to: body }], next: ["after"] }),
      step,
      node("after", "records.update", { type: "contact", recordId: "rec_after", patch: { step: "after" } }),
    ],
  };
}

function rig() {
  const calls: CapCall[] = [];
  const mailApplied = new Map<string, string>();
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
      if (cap === "mail.send" || cap === "mail.draft") {
        const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
        const prior = key ? mailApplied.get(key) : undefined;
        if (prior) return { messageId: prior };
        const messageId = `msg_${mailApplied.size + 1}`;
        if (key) mailApplied.set(key, messageId);
        return { messageId };
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
  host = createRunsHost({
    call,
    log: (msg, attrs) => errors.push(`${msg} ${JSON.stringify(attrs)}`),
  });

  async function drain(limit = 40): Promise<void> {
    let prev = -1;
    for (let i = 0; i < limit; i++) {
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

  const caps = (cap: string) => calls.filter((c) => c.cap === cap);
  const run = (id: string) => findRun(runsH.db, id);
  const steps = (id: string) => allSteps(runsH.db, id);
  const children = (parentId: string) => listChildLinks(autoH.db, parentId);
  const ordered = (parentId: string) => children(parentId).slice().sort((a, b) => (a.scope?.iterationIndex ?? 0) - (b.scope?.iterationIndex ?? 0));

  return { host, calls, caps, boot, drain, run, steps, children, ordered, autoH, runsH, mailApplied };
}

test("a loop of zero items runs the following step and starts no child", async () => {
  const w = rig();
  const { parentId } = await w.boot(loopOf([], 1, 10, "make"), "Empty loop");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.equal(w.children(parentId).length, 0);
  assert.equal(w.caps("records.create").length, 0);
  assert.equal(w.caps("records.update").length, 1);
  assert.deepEqual(w.steps(parentId).map((s) => [s.step, s.state]), [["each", "succeeded"], ["after", "succeeded"]]);
  assert.deepEqual(JSON.parse(w.steps(parentId)[0]!.outputJson!), { iterations: 0, results: [] });
});

test("a loop of one item keeps that item id and does not start a second body", async () => {
  const w = rig();
  const item = { id: "only", name: "Ada" };
  const { parentId } = await w.boot(loopOf([item], 1, 10, "make"), "One item");
  w.host.enqueue(parentId);
  await w.drain();
  const kids = w.ordered(parentId);
  assert.equal(kids.length, 1);
  assert.equal(kids[0]!.scope?.iterationKey, "only");
  assert.equal(kids[0]!.scope?.iterationIndex, 0);
  assert.equal(kids[0]!.scope?.held, undefined);
  assert.deepEqual(kids[0]!.scope?.item, item);
  assert.equal(w.run(kids[0]!.runId)?.status, "succeeded", w.run(kids[0]!.runId)?.summary);
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.equal(w.caps("records.create").length, 1);
  assert.equal((w.caps("records.create")[0]!.input.fields as { name?: string }).name, "Ada");
  assert.equal(w.caps("records.create")[0]!.input.idempotencyKey, `${kids[0]!.runId}:make:1`);
  assert.equal(w.caps("records.update").length, 1);
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.children(parentId).length, 1);
  assert.equal(w.children(parentId)[0]!.scope?.iterationKey, "only");
  assert.equal(w.caps("records.create").length, 1);
});

test("a repeated item id keeps a stable second key", async () => {
  const w = rig();
  const items = [{ id: "a", name: "Ada" }, { id: "a", name: "Ann" }];
  const { parentId } = await w.boot(loopOf(items, 2, 10, "hold"), "Same id twice");
  w.host.enqueue(parentId);
  await w.drain();
  const kids = w.ordered(parentId);
  assert.deepEqual(kids.map((k) => k.scope?.iterationKey), ["a", "1:a"]);
  assert.deepEqual(kids.map((k) => k.scope?.iterationIndex), [0, 1]);
  assert.deepEqual(kids.map((k) => (k.scope?.item as { name?: string }).name), ["Ada", "Ann"]);
  assert.equal(kids.every((k) => k.scope?.held !== true), true);
  await w.runsH.call("runs.resume", { runId: parentId, reason: "background" }, engine);
  w.host.enqueue(parentId);
  await w.drain();
  assert.deepEqual(w.ordered(parentId).map((k) => k.scope?.iterationKey), ["a", "1:a"]);
  assert.equal(w.children(parentId).length, 2);
});

test("a loop of the maximum 1000 items keeps each item id and holds past the concurrency cap", { timeout: 120_000 }, async () => {
  const w = rig();
  const items = Array.from({ length: LOOP_MAX }, (_, i) => ({ id: `k${i}`, name: `n${i}` }));
  const { parentId } = await w.boot(loopOf(items, CONCURRENCY_MAX, LOOP_MAX, "hold"), "Max loop");
  w.host.enqueue(parentId);
  await w.drain(80);
  const kids = w.ordered(parentId);
  assert.equal(kids.length, LOOP_MAX);
  const live = kids.filter((k) => k.scope?.held !== true);
  const held = kids.filter((k) => k.scope?.held === true);
  assert.equal(live.length, CONCURRENCY_MAX);
  assert.equal(held.length, LOOP_MAX - CONCURRENCY_MAX);
  for (const kid of kids) {
    assert.equal(kid.scope?.iterationKey, `k${kid.scope?.iterationIndex}`);
    assert.equal((kid.scope?.item as { id?: string }).id, kid.scope?.iterationKey);
  }
  assert.deepEqual(live.map((k) => k.scope?.iterationIndex), Array.from({ length: CONCURRENCY_MAX }, (_, i) => i));
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.caps("records.update").length, 0);
  await w.runsH.call("runs.resume", { runId: parentId, reason: "background" }, engine);
  w.host.enqueue(parentId);
  await w.drain(80);
  assert.equal(w.children(parentId).length, LOOP_MAX);
  assert.deepEqual(w.ordered(parentId).map((k) => k.scope?.iterationKey), items.map((item) => item.id));
});

test("a concurrency request above 20 stays at 20", async () => {
  const w = rig();
  const items = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` }));
  const { parentId } = await w.boot(loopOf(items, 50, 25, "hold"), "Concurrency cap");
  w.host.enqueue(parentId);
  await w.drain();
  const kids = w.ordered(parentId);
  assert.equal(kids.length, 25);
  assert.equal(kids.filter((k) => k.scope?.held !== true).length, CONCURRENCY_MAX);
  assert.equal(kids.filter((k) => k.scope?.held === true).length, 5);
  assert.deepEqual(kids.filter((k) => k.scope?.held === true).map((k) => k.scope?.iterationIndex), [20, 21, 22, 23, 24]);
});

test("one item past the loop maximum fails the run and starts no child", async () => {
  const w = rig();
  const items = Array.from({ length: LOOP_MAX + 1 }, (_, i) => ({ id: `k${i}` }));
  const { parentId } = await w.boot(loopOf(items, 1, LOOP_MAX, "make"), "Over max");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "failed", w.run(parentId)?.summary);
  assert.match(w.run(parentId)?.summary ?? "", /1001 items and the loop allows 1000/);
  assert.equal(w.children(parentId).length, 0);
  assert.equal(w.caps("records.create").length, 0);
  assert.equal(w.caps("records.update").length, 0);
  assert.equal(w.steps(parentId).find((s) => s.step === "each")?.error?.code, "run.loop_too_large");
});

test("any-join cancels the unfinished lane and does not run its later step", async () => {
  const w = rig();
  const def: Definition = {
    triggers: manual,
    start: ["par"],
    nodes: [
      node("par", "parallel", { waitFor: "any" }, { branches: [{ label: "Slow", to: "s1" }, { label: "Fast", to: "f1" }], next: ["join"] }),
      node("s1", "records.create", contact({ lane: "slow" }), { next: ["s2"] }),
      node("s2", "wait", { forDuration: "1h" }, { next: ["s3"] }),
      node("s3", "records.update", { type: "contact", recordId: "rec_slow", patch: { step: "later" } }),
      node("f1", "records.create", contact({ lane: "fast" }), { next: ["join"] }),
      node("join", "records.update", { type: "contact", recordId: "rec_join", patch: { step: "join" } }),
    ],
  };
  const { parentId } = await w.boot(def, "Any join");
  w.host.enqueue(parentId);
  await w.drain();
  const kids = w.children(parentId);
  const slow = kids.find((k) => k.scope?.laneId === "Slow");
  const fast = kids.find((k) => k.scope?.laneId === "Fast");
  assert.ok(slow && fast);
  assert.equal(w.run(parentId)?.status, "succeeded", w.run(parentId)?.summary);
  assert.equal(w.run(fast.runId)?.status, "succeeded");
  assert.equal(w.run(slow.runId)?.status, "stopped");
  assert.equal(w.caps("records.create").filter((c) => (c.input.fields as { lane?: string }).lane === "fast").length, 1);
  assert.equal(w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "later").length, 0);
  assert.equal(w.caps("records.update").filter((c) => (c.input.patch as { step?: string }).step === "join").length, 1);
  assert.equal(w.steps(slow.runId).some((s) => s.step === "s3"), false);
});

test("migrate_runs on a safe cohort does not send the finished message again", async () => {
  const w = rig();
  const sent = (hours: string) => ({
    triggers: manual,
    start: ["mail"],
    nodes: [
      node("mail", "send_email", mailInput("Hello"), { next: ["hold"] }),
      node("hold", "wait", { forDuration: hours }),
    ],
  }) satisfies Definition;
  const { automationId, parentId } = await w.boot(sent("1h"), "Cohort send");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  assert.equal(w.steps(parentId).find((s) => s.step === "mail")?.state, "succeeded");
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.mailApplied.size, 1);

  await w.autoH.call("automations.update", { automationId, definition: sent("2h"), expectedVersion: 1 }, alice);
  const moved = await w.autoH.call("automations.migrate_runs", { automationId, toVersion: 2, runIds: [parentId] }, alice) as { moved: { runId: string; atStepId: string }[] };
  assert.deepEqual(moved.moved.map((row) => row.runId), [parentId]);
  assert.equal(moved.moved[0]!.atStepId, "hold");
  assert.equal(findRunLink(w.autoH.db, parentId)?.version, 2);
  assert.equal(w.run(parentId)?.definitionVersion, 2);
  assert.equal(w.run(parentId)?.status, "waiting");

  await w.runsH.call("runs.resume", { runId: parentId, reason: "background" }, engine);
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.mailApplied.size, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "mail" && s.state === "succeeded").length, 1);
  assert.equal(w.run(parentId)?.status, "waiting");

  const ambiguous: Definition = {
    triggers: manual,
    start: ["mail"],
    nodes: [
      node("mail", "send_email", mailInput("Hello"), { next: ["hold"] }),
      node("hold", "send_email", mailInput("Again")),
    ],
  };
  await w.autoH.call("automations.update", { automationId, definition: ambiguous, expectedVersion: 2 }, alice);
  await assert.rejects(
    w.autoH.call("automations.migrate_runs", { automationId, toVersion: 3, runIds: [parentId] }, alice),
    (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "unsafe_cohort",
  );
  assert.equal(findRunLink(w.autoH.db, parentId)?.version, 2);
  assert.equal(w.run(parentId)?.definitionVersion, 2);
  assert.equal(w.caps("mail.send").length, 1);
  assert.equal(w.mailApplied.size, 1);
});

test("a repeated send attempt keeps one idempotency key and the outward send is recorded once", async () => {
  const w = rig();
  const def: Definition = {
    triggers: manual,
    start: ["mail"],
    nodes: [
      node("mail", "send_email", mailInput("Hello", "Sent once"), { next: ["hold"] }),
      node("hold", "wait", { forDuration: "1h" }),
    ],
  };
  const { parentId } = await w.boot(def, "One send");
  w.host.enqueue(parentId);
  await w.drain();
  assert.equal(w.run(parentId)?.status, "waiting");
  const first = w.caps("mail.send");
  assert.equal(first.length, 1);
  assert.equal(first[0]!.input.idempotencyKey, `${parentId}:mail:1`);
  assert.equal(w.mailApplied.size, 1);

  w.runsH.db.run("UPDATE runs_items SET status = ?, wait_reason = NULL WHERE id = ?", "running", parentId);
  w.runsH.db.run("UPDATE runs_steps SET state = ?, ended_at = NULL, output_json = NULL WHERE run_id = ? AND step = ?", "running", parentId, "mail");
  w.runsH.db.run("DELETE FROM runs_waits WHERE run_id = ?", parentId);
  w.host.enqueue(parentId);
  await w.drain();

  const sends = w.caps("mail.send");
  assert.equal(sends.length, 2);
  assert.deepEqual(sends.map((c) => c.input.idempotencyKey), [`${parentId}:mail:1`, `${parentId}:mail:1`]);
  assert.equal(w.mailApplied.size, 1);
  assert.equal(w.steps(parentId).filter((s) => s.step === "mail" && s.state === "succeeded").length, 1);
});
