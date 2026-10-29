// A reviewed Apply moves only a safe cohort. Finished steps stay finished.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, node } from "../fixtures/seed.ts";
import { migrateRuns, migrationPreview } from "../handlers/migrate.ts";
import { findRunLink, saveRunLink } from "../projections.ts";

const tag = node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" } }, { next: ["hold"] });
const hold = node("hold", "wait", { forDuration: "1h" });
const warm = node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "warm" } }, { next: ["hold"] });
const definition = { triggers: [{ key: "manual" }], nodes: [tag, hold] };

async function setup(): Promise<{ h: ReturnType<typeof harness>; id: string; runId: string; pins: { runId: string; definitionVersion: number }[] }> {
  const h = harness();
  const pins: { runId: string; definitionVersion: number }[] = [];
  h.callee("runs.pin_version", (input) => {
    pins.push({ runId: input.runId, definitionVersion: input.definitionVersion });
    const row = h.runs.find((run) => run.id === input.runId);
    if (row) row.definitionVersion = input.definitionVersion;
    return { run: row };
  });
  h.callee("runs.steps", () => ({ steps: [
    { step: "tag", state: "succeeded", attempt: 1 },
    { step: "hold", state: "waiting", attempt: 1 },
  ] }));
  const id = (await h.call("automations.create", { name: "Welcome", definition }, alice)).automation.id as string;
  const started = await h.call("automations.run", { automationId: id, trigger: "manual", idempotencyKey: "once" }, alice);
  h.runs[0]!.status = "waiting";
  return { h, id, runId: started.runId as string, pins };
}

function ctxOf(h: ReturnType<typeof harness>, names: string[]) {
  const ctx = h.ctxFor(null, alice);
  ctx.emit = (name) => { names.push(name); return { id: "evt_test" }; };
  return ctx;
}

test("apply pins a safe waiting run and does not replay its finished step", async () => {
  const { h, id, runId, pins } = await setup();
  const next = {
    triggers: [{ key: "manual" }],
    nodes: [node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "warm" } }, { next: ["hold"] }), hold],
  };
  await h.call("automations.update", { automationId: id, definition: next }, alice);
  const names: string[] = [];
  const out = await migrateRuns(ctxOf(h, names), { automationId: id, toVersion: 2, runIds: [runId] }) as { moved: { runId: string; fromVersion: number; atStepId: string }[] };
  assert.deepEqual(pins, [{ runId, definitionVersion: 2 }]);
  assert.equal(findRunLink(h.db, runId)!.version, 2);
  assert.equal(h.runs[0]!.definitionVersion, 2);
  assert.equal(h.runs[0]!.status, "waiting");
  assert.deepEqual(out.moved, [{ runId, fromVersion: 1, toVersion: 2, atStepId: "hold" }]);
  assert.deepEqual(names, ["automation.runs_migrated"]);
});

test("an ambiguous cohort and a finished run stay pinned", async () => {
  const { h, id, runId, pins } = await setup();
  const changed = { triggers: [{ key: "manual" }], nodes: [tag, node("hold", "send_email", { mailboxId: "mbx_main", to: "a@b.c", subject: "Hi", body: "Hi" })] };
  await h.call("automations.update", { automationId: id, definition: changed }, alice);
  const names: string[] = [];
  await assert.rejects(migrateRuns(ctxOf(h, names), { automationId: id, toVersion: 2, runIds: [runId] }), (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "unsafe_cohort");
  assert.deepEqual(pins, []);
  assert.equal(findRunLink(h.db, runId)!.version, 1);
  h.runs[0]!.status = "succeeded";
  const same = {
    triggers: [{ key: "manual" }],
    nodes: [node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "done" } }, { next: ["hold"] }), hold],
  };
  await h.call("automations.update", { automationId: id, definition: same }, alice);
  await assert.rejects(migrateRuns(ctxOf(h, names), { automationId: id, toVersion: 3, runIds: [runId] }), (e) => reasonOf(e) === "unsafe_cohort");
  assert.deepEqual(pins, []);
  assert.deepEqual(names, []);
});

test("a run already on the target version is not pinned again", async () => {
  const { h, id, runId, pins } = await setup();
  await h.call("automations.update", { automationId: id, definition: { ...definition, nodes: [tag, node("hold", "wait", { forDuration: "2h" })] } }, alice);
  const link = findRunLink(h.db, runId)!;
  saveRunLink(h.db, { ...link, version: 2 });
  h.runs[0]!.definitionVersion = 2;
  const names: string[] = [];
  const out = await migrateRuns(ctxOf(h, names), { automationId: id, toVersion: 2, runIds: [runId] }) as { moved: unknown[] };
  assert.deepEqual(out.moved, []);
  assert.deepEqual(pins, []);
  assert.deepEqual(names, []);
});

test("a preview groups the run and names the step it would land on", async () => {
  const { h, id, runId } = await setup();
  await h.call("automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [warm, hold] } }, alice);
  const out = await migrationPreview(h.ctxFor(null, alice), { automationId: id, toVersion: 2 }) as { cohorts: { runIds: string[]; disposition: string; proposedStepId: string | null }[] };
  assert.equal(out.cohorts.length, 1);
  assert.deepEqual(out.cohorts[0]!.runIds, [runId]);
  assert.equal(out.cohorts[0]!.disposition, "safe");
  assert.equal(out.cohorts[0]!.proposedStepId, "hold");
});

test("a run whose step is executing is not moved and is never pinned", async () => {
  const { h, id, runId, pins } = await setup();
  h.callee("runs.steps", () => ({ steps: [
    { step: "tag", state: "succeeded", attempt: 1 },
    { step: "hold", state: "running", attempt: 1 },
  ] }));
  h.runs[0]!.status = "running";
  await h.call("automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [warm, hold] } }, alice);
  const preview = await migrationPreview(h.ctxFor(null, alice), { automationId: id, toVersion: 2 }) as { cohorts: { disposition: string; reason: string }[] };
  assert.equal(preview.cohorts[0]!.disposition, "ambiguous");
  assert.match(preview.cohorts[0]!.reason, /running right now/);
  await assert.rejects(migrateRuns(ctxOf(h, []), { automationId: id, toVersion: 2, runIds: [runId] }), (e) => reasonOf(e) === "unsafe_cohort");
  assert.deepEqual(pins, []);
});

test("a step that starts after the preview holds the run back", async () => {
  const { h, id, runId, pins } = await setup();
  await h.call("automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [warm, hold] } }, alice);
  let calls = 0;
  h.callee("runs.steps", () => {
    calls += 1;
    // the first read plans the move; the read right before the pin sees the step running
    return { steps: [{ step: "tag", state: "succeeded", attempt: 1 }, { step: "hold", state: calls > 1 ? "running" : "waiting", attempt: 1 }] };
  });
  const out = await migrateRuns(ctxOf(h, []), { automationId: id, toVersion: 2, runIds: [runId] }) as { moved: unknown[]; held: string[] };
  assert.deepEqual(out.moved, []);
  assert.deepEqual(out.held, [runId]);
  assert.deepEqual(pins, []);
  assert.equal(findRunLink(h.db, runId)!.version, 1);
});

test("a version that lacks the current step is refused", async () => {
  const { h, id, runId, pins } = await setup();
  await h.call("automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "warm" } })] } }, alice);
  await assert.rejects(migrateRuns(ctxOf(h, []), { automationId: id, toVersion: 2, runIds: [runId] }), (e) => reasonOf(e) === "unsafe_cohort");
  assert.deepEqual(pins, []);
});
