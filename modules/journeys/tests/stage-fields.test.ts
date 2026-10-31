// Journeys: fields a stage holds and the gates on them. A move is refused, from anyone, while the fields a stage needs to be entered or left are empty; the refusal lists them.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newJourney, stage, task } from "../fixtures/seed.ts";
import type { Caller } from "../fixtures/seed.ts";

const agent: Caller = { id: "agt_checker", kind: "agent", actingFor: "usr_alice" };
const TITLES = [{ key: "amount", title: "Amount" }, { key: "address", title: "Address" }, { key: "name", title: "Name" }];

/** intake -> review -> done. Review wants an amount and an address to be entered; intake wants an amount to be left (a field of its own group). */
const gated = (): Record<string, unknown> => newJourney({
  stages: [
    stage("intake", 0, { fields: ["amount"], needToLeave: ["amount"], tasks: [task("t", { required: false })] }),
    stage("review", 1, { fields: ["address"], needToEnter: ["address"], tasks: [] }),
    stage("done", 2, { final: true, exit: { requireTasks: false } }),
  ],
});

function world(values: Record<string, unknown> = {}): { h: Harness; values: Record<string, unknown> } {
  const h = harness({ calls: {
    "records.get": (i) => ({ record: { id: i.recordId, type: i.type, fields: { name: "x", ...values } } }),
    "schema.describe": () => ({ types: [{ key: "journey_client_intake", fields: TITLES }] }),
  } });
  return { h, values };
}
const start = async (h: Harness): Promise<{ journeyId: string; recordId: string }> => {
  const j = (await h.call("journeys.create", gated(), alice)).journey;
  const recordId = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice)).recordId as string;
  return { journeyId: j.id, recordId };
};
const move = (h: Harness, a: { journeyId: string; recordId: string }, toStage: string, who: Caller = alice): Promise<any> =>   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.call("journeys.move_stage", { ...a, toStage, reason: "Test" }, who);
const detailsOf = (e: unknown): any => (e as { error?: { details?: unknown } }).error?.details;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("a stage keeps its fields and gates in the design, and the Journey gives them back", async () => {
  const { h } = world();
  const j = (await h.call("journeys.create", gated(), alice)).journey;
  const got = (await h.call("journeys.get", { journeyId: j.id }, alice)).journey;
  assert.deepEqual(got.stages[0].fields, ["amount"]);
  assert.deepEqual(got.stages[0].needToLeave, ["amount"]);
  assert.deepEqual(got.stages[1].needToEnter, ["address"]);
});

test("move_stage is refused while the fields to leave or to enter are empty, and the refusal lists them", async () => {
  const { h } = world();
  const a = await start(h);
  await assert.rejects(move(h, a, "review"), (e) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    const d = detailsOf(e);
    assert.equal(d.reason, "fields_required");
    assert.deepEqual(d.fields, [
      { key: "amount", title: "Amount", stage: "intake", when: "leave" },
      { key: "address", title: "Address", stage: "review", when: "enter" },
    ]);
    assert.equal(d.toStage, "review");
    assert.match((e as { error: { message: string } }).error.message, /Amount, Address/);
    return true;
  });
  assert.equal(h.only("records.update").length, 0, "nothing was written");
  assert.deepEqual(h.allEvents.map((e) => e.name).filter((n) => n.startsWith("journey.stage") || n === "journey.moved"), ["journey.stage_entered"], "only the start entered a stage");
});

test("an agent or an Automation calling move_stage is refused the same way", async () => {
  const { h } = world();
  const a = await start(h);
  for (const who of [agent, { id: "svc_engine", kind: "service" } as Caller]) {
    await assert.rejects(move(h, a, "review", who), (e) => { assert.equal(detailsOf(e).reason, "fields_required"); assert.equal(detailsOf(e).fields.length, 2); return true; });
  }
});

test("only the fields still empty are listed, and the move goes ahead once they are filled", async () => {
  const { h, values } = world({ amount: 120 });
  const a = await start(h);
  await assert.rejects(move(h, a, "review"), (e) => { assert.deepEqual(detailsOf(e).fields.map((f: { key: string }) => f.key), ["address"]); return true; });
  values["address"] = "1 Main St";
  const r = await move(h, a, "review");
  assert.equal(r.stage, "review");
  assert.equal(h.only("records.update").length, 1);
});

test("an empty string, an empty list and a blank are empty; zero and false are answers", async () => {
  const { h, values } = world({ amount: "  ", address: [] });
  const a = await start(h);
  await assert.rejects(move(h, a, "review"), (e) => { assert.equal(detailsOf(e).fields.length, 2); return true; });
  values["amount"] = 0; values["address"] = false;
  assert.equal((await move(h, a, "review")).stage, "review");
});

test("a stage with no gates moves as before and never reads the record", async () => {
  const { h } = world();
  const j = (await h.call("journeys.create", newJourney(), alice)).journey;
  const recordId = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice)).recordId as string;
  await h.call("journeys.move_stage", { journeyId: j.id, recordId, toStage: "review", reason: "ok" }, alice);
  assert.equal(h.only("records.get").length, 0);
});

test("advance keeps a record where it is while a gate waits, and moves it once the fields are filled", async () => {
  const { h, values } = world({ amount: 5 });
  const j = (await h.call("journeys.create", newJourney({ stages: [
    stage("intake", 0, { exit: { requireTasks: false } }), stage("review", 1, { needToEnter: ["address"], exit: { requireTasks: false } }), stage("done", 2, { final: true, exit: { requireTasks: false } }),
  ] }), alice)).journey;
  const recordId = (await h.call("journeys.start", { journeyId: j.id, subjectRecordId: "rec_s1" }, alice)).recordId as string;
  assert.deepEqual(await h.call("journeys.advance", { recordId }, alice), { advanced: false, stage: "intake" });
  values["address"] = "1 Main St";
  assert.deepEqual(await h.call("journeys.advance", { recordId }, alice), { advanced: true, stage: "review" });
});

test("a design whose field lists are not field keys is refused", async () => {
  const { h } = world();
  await assert.rejects(h.call("journeys.create", newJourney({ stages: [stage("a", 0, { needToEnter: [""] as never })] }), alice), (e) => codeOf(e) === "validation.precondition_failed");
});
