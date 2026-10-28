// A reviewed Apply moves only a safe cohort. Finished steps stay finished.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { alice, node } from "../fixtures/seed.ts";
import { migrateRuns } from "../handlers/migrate.ts";
import { findRunLink, saveRunLink } from "../projections.ts";

const tag = node("tag", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" } }, { next: ["hold"] });
const hold = node("hold", "wait", { forDuration: "1h" });
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
