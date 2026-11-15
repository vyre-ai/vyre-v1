// A draft per Automation, saved as you go; Make live; a test of the draft on a real past event (AUTOMATIONS-BUILD-RC29, 1c and 1f).
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, create, goodDefinition, node } from "../fixtures/seed.ts";
import { findRunLink, saveRunLink } from "../projections.ts";

const mk = async (h: Harness): Promise<string> =>
  (await h.call("automations.create", create(), alice)).automation.id as string;
const edited = (key = "b") =>
  goodDefinition({
    nodes: [
      node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "active" } }),
      node(key, "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "later" } }),
    ],
  });
const on = async (h: Harness, id: string): Promise<void> => {
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
};

test("an On Automation keeps an edit as a draft: the live version does not move until Make live", async () => {
  const h = harness();
  const id = await mk(h);
  await on(h, id);
  const r = await h.call(
    "automations.draft.save",
    { automationId: id, definition: edited(), expectedVersion: 1 },
    alice,
  );
  assert.equal(r.automation.version, 1);
  assert.equal(r.automation.definition.nodes.length, 1, "live is as it was");
  assert.equal(r.draft.definition.nodes.length, 2);
  assert.equal(r.draft.rev, 1);
  const got = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(got.draft.rev, 1, "a reload finds the draft");
  const live = await h.call("automations.make_live", { automationId: id, expectedRev: 1 }, alice);
  assert.equal(live.automation.version, 2);
  assert.equal(live.automation.definition.nodes.length, 2);
  assert.equal(live.draft, undefined);
});

test("an Off Automation has no live side: an edit saves as a version at once", async () => {
  const h = harness();
  const id = await mk(h);
  const r = await h.call(
    "automations.draft.save",
    { automationId: id, definition: edited(), expectedVersion: 1 },
    alice,
  );
  assert.equal(r.automation.version, 2);
  assert.equal(r.draft, undefined);
});

test("a second person writing on a draft they read before the first wrote is refused in one plain sentence, nothing is lost", async () => {
  const h = harness();
  const id = await mk(h);
  await on(h, id);
  await h.call("automations.draft.save", { automationId: id, definition: edited("b"), expectedVersion: 1 }, alice);
  await assert.rejects(
    h.call("automations.draft.save", { automationId: id, definition: edited("c"), expectedVersion: 1 }, alice),
    (e) => {
      assert.equal(codeOf(e), "validation.version_conflict");
      assert.match(String((e as Error).message), /^Someone else changed this Automation/);
      return true;
    },
  );
  const got = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(got.draft.definition.nodes[1].id, "b", "the first draft is untouched");
  await h.call("automations.draft.save", { automationId: id, definition: edited("c"), expectedRev: 1 }, alice);
  assert.equal((await h.call("automations.get", { automationId: id }, alice)).draft.rev, 2);
});

test("Discard drops the draft and leaves the live version", async () => {
  const h = harness();
  const id = await mk(h);
  await on(h, id);
  await h.call("automations.draft.save", { automationId: id, definition: edited(), expectedVersion: 1 }, alice);
  const r = await h.call("automations.draft.discard", { automationId: id }, alice);
  assert.equal(r.draft, undefined);
  assert.equal(r.automation.version, 1);
});

test("a person without the right to change it cannot write the draft", async () => {
  const h = harness({ authorize: (who, a) => who.id !== bob.id || a.level === "view" });
  const id = await mk(h);
  await on(h, id);
  await h.call("automations.promote", { automationId: id, confirm: true }, alice);
  await assert.rejects(
    h.call("automations.draft.save", { automationId: id, definition: edited(), expectedVersion: 1 }, bob),
    (e) => String(codeOf(e)).startsWith("permission."),
  );
});

test("Test with draft: true runs the draft on a real past event, not the saved version and an empty sample", async () => {
  const h = harness();
  const id = await mk(h);
  await on(h, id);
  // a real earlier start of the same trigger
  saveRunLink(h.db, {
    runId: "run_past00000000000000000000000001",
    automationId: id,
    version: 1,
    trigger: "record_change",
    test: false,
    payload: { recordId: "rec_real", type: "contact" },
    depth: 0,
    principal: { kind: "person", id: alice.id },
    startedAt: 1,
  });
  await h.call("automations.draft.save", { automationId: id, definition: edited(), expectedVersion: 1 }, alice);
  const ev = await h.call("automations.test_events", { automationId: id }, alice);
  assert.equal(ev.events[0].runId, "run_past00000000000000000000000001");
  const r = await h.call("automations.test", { automationId: id, draft: true, eventRunId: ev.events[0].runId }, alice);
  const link = findRunLink(h.db, r.runId)!;
  assert.equal(link.test, true);
  assert.deepEqual(link.payload, { recordId: "rec_real", type: "contact" });
  assert.equal(link.draftDefinition?.nodes.length, 2, "the run keeps the draft it ran");
  const plain = await h.call("automations.test", { automationId: id }, alice);
  assert.equal(findRunLink(h.db, plain.runId)!.draftDefinition, undefined);
  await assert.rejects(
    h.call("automations.test", { automationId: id, eventRunId: "run_nope00000000000000000000000001" }, alice),
    (e) => codeOf(e) === "validation.precondition_failed",
  );
});
