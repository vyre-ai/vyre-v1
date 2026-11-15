// Building by asking: an Assistant proposes steps on the page; a person accepts (AUTOMATIONS-BUILD-RC29 phase 2; design 2.7 and rule R3).
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, create, goodDefinition, node } from "../fixtures/seed.ts";
import type { Caller } from "../fixtures/seed.ts";

/** Alice's Assistant, working for Alice. */
const assistant: Caller = { id: "agt_assistant_alice", kind: "agent", actingFor: "usr_alice" };
const three = () =>
  goodDefinition({
    nodes: [
      node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "new" } }),
      node("b", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "told" } }),
      node("c", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "done" } }),
    ],
  });
const mk = async (h: Harness): Promise<string> =>
  (await h.call("automations.create", create(), alice)).automation.id as string;
const SUMMARY = "When a contact is added: mark it new, tell the team, mark it done.";

test("a sentence with no Automation yet: proposing makes an empty one that is off, and the steps sit beside it, not in it", async () => {
  const h = harness();
  const r = await h.call(
    "automations.draft.propose",
    { name: "New contact follow-up", definition: three(), summary: SUMMARY },
    assistant,
  );
  assert.equal(r.automation.status, "draft", "nothing is turned on");
  assert.equal(r.automation.ownerId, "usr_alice", "it belongs to the person the Assistant works for");
  assert.equal(r.automation.definition.nodes.length, 0, "nothing proposed is saved as the definition");
  assert.equal(r.proposal.steps, 3);
  assert.equal(r.proposal.summary, SUMMARY);
  assert.equal(r.proposal.by, "agt_assistant_alice");
  assert.equal(r.proposal.for, "usr_alice");
  assert.equal(typeof r.ok, "boolean");
  assert.ok(Array.isArray(r.issues), "what is still missing comes back with the proposal");
  const got = await h.call("automations.get", { automationId: r.automation.id }, alice);
  assert.equal(got.proposal.steps, 3, "a reload finds the proposal");
  assert.equal(got.automation.version, 1);
});

test("an agent cannot accept its own proposal: a person does", async () => {
  const h = harness();
  const r = await h.call(
    "automations.draft.propose",
    { name: "New contact follow-up", definition: three(), summary: SUMMARY },
    assistant,
  );
  const id = r.automation.id as string;
  await assert.rejects(
    h.call("automations.proposal.accept", { automationId: id }, assistant),
    (e: unknown) => codeOf(e) === "validation.precondition_failed" && /person accepts/i.test((e as Error).message),
  );
  const still = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(still.automation.definition.nodes.length, 0, "the refusal wrote nothing");
  assert.equal(still.proposal.steps, 3);
  const done = await h.call("automations.proposal.accept", { automationId: id }, alice);
  assert.equal(done.automation.definition.nodes.length, 3);
  assert.equal(done.automation.status, "draft", "accepting does not turn it on");
  assert.equal(done.proposal, undefined);
});

test("on an Automation that is On, an accepted proposal becomes the person's draft: live does not move until Make live", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  await h.call("automations.draft.propose", { automationId: id, definition: three(), summary: SUMMARY }, assistant);
  const acc = await h.call("automations.proposal.accept", { automationId: id }, alice);
  assert.equal(acc.automation.version, 1);
  assert.equal(acc.automation.definition.nodes.length, 1, "live is as it was");
  assert.equal(acc.draft.definition.nodes.length, 3);
  assert.equal(acc.proposal, undefined);
  const live = await h.call("automations.make_live", { automationId: id, expectedRev: acc.draft.rev }, alice);
  assert.equal(live.automation.definition.nodes.length, 3);
});

test("a proposal made before the person changed the Automation is refused at Accept in one plain sentence, and is kept", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.draft.propose", { automationId: id, definition: three(), summary: SUMMARY }, assistant);
  const mine = goodDefinition({
    nodes: [node("z", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "mine" } })],
  });
  await h.call("automations.draft.save", { automationId: id, definition: mine, expectedVersion: 1 }, alice);
  await assert.rejects(
    h.call("automations.proposal.accept", { automationId: id }, alice),
    (e: unknown) =>
      codeOf(e) === "validation.version_conflict" && /changed after the draft was made/.test((e as Error).message),
  );
  const got = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(got.automation.definition.nodes[0].id, "z", "the person's own change is not overwritten");
  assert.equal(got.proposal.steps, 3, "the proposal is still there to read or discard");
});

test("discarding a proposal that made the Automation takes the empty Automation with it; discarding one on a real Automation leaves it as it was", async () => {
  const h = harness();
  const r = await h.call(
    "automations.draft.propose",
    { name: "New contact follow-up", definition: three(), summary: SUMMARY },
    assistant,
  );
  const gone = await h.call("automations.proposal.discard", { automationId: r.automation.id }, alice);
  assert.equal(gone.removed, true);
  const list = await h.call("automations.list", {}, alice);
  assert.equal(JSON.stringify(list).includes(r.automation.id), false, "no empty row is left in the list");

  const id = await mk(h);
  await h.call("automations.draft.propose", { automationId: id, definition: three(), summary: SUMMARY }, assistant);
  const kept = await h.call("automations.proposal.discard", { automationId: id }, alice);
  assert.equal(kept.removed, undefined);
  assert.equal(kept.proposal, undefined);
  assert.equal(kept.automation.definition.nodes.length, 1);
});

test("a second proposal replaces the first; a person who cannot see the Automation cannot read, accept or discard its proposal", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.draft.propose", { automationId: id, definition: three(), summary: "first" }, assistant);
  const two = goodDefinition({
    nodes: [node("only", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "x" } })],
  });
  const r = await h.call(
    "automations.draft.propose",
    { automationId: id, definition: two, summary: "second" },
    assistant,
  );
  assert.equal(r.proposal.steps, 1);
  assert.equal(r.proposal.summary, "second");
  for (const cap of ["automations.get", "automations.proposal.accept", "automations.proposal.discard"])
    await assert.rejects(h.call(cap, { automationId: id }, bob), (e: unknown) =>
      String(codeOf(e)).startsWith("permission."),
    );
});

test("a proposal needs a one-line summary, real steps and no secret: each is refused and nothing is written", async () => {
  const h = harness();
  const id = await mk(h);
  await assert.rejects(
    h.call("automations.draft.propose", { automationId: id, definition: three(), summary: "  " }, assistant),
    (e: unknown) => codeOf(e) === "validation.bad_input" && /one line/.test((e as Error).message),
  );
  const invented = goodDefinition({ nodes: [node("a", "lawmatics.make_a_lead", { name: "x" })] });
  await assert.rejects(
    h.call("automations.draft.propose", { automationId: id, definition: invented, summary: SUMMARY }, assistant),
    (e: unknown) => codeOf(e) === "validation.bad_input" && /no step called/.test((e as Error).message),
    "a step that is not in the catalogue is never put on the page",
  );
  const leaky = goodDefinition({
    nodes: [
      node("a", "records.update", {
        type: "contact",
        recordId: "rec_abc",
        patch: { note: "Bearer sk-live-0123456789abcdefghijklmnop" },
      }),
    ],
  });
  await assert.rejects(
    h.call("automations.draft.propose", { automationId: id, definition: leaky, summary: SUMMARY }, assistant),
    (e: unknown) => codeOf(e) === "validation.bad_input" && /cannot hold a secret/.test((e as Error).message),
  );
  const got = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(got.proposal, undefined);
});
