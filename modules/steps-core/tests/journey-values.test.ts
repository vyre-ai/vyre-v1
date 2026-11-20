// A Journey's carried values in a Run (rc.41): {{journey.plan}} reads what the Journey kept for the record the Run is about, a name that is not carried fails the step in words, and the step that keeps a value sends it to the Journey.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { callOf, node } from "../fixtures/seed.ts";
import { runStep } from "../handlers/control.ts";

const note = (text: string) =>
  node("m", "records.update", { type: "contact", recordId: "rec_a1", patch: { note: text } });
const said = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { error?: { message?: string } }).error?.message ?? String(e);
  }
  return "";
};
const calls = (values: Record<string, unknown>, carried: { key: string }[] = [{ key: "plan" }, { key: "owner" }]) => ({
  "records.update": () => ({ recordId: "rec_a1", version: 2 }),
  "journeys.values.get": () => ({ values }),
  "journeys.list": () => ({ journeys: [{ variables: carried }] }),
});
const trig = { trigger: { record: { id: "rec_c1" }, recordId: "rec_c1" } };

test("{{journey.plan}} is filled from what the Journey kept for the record the Run is about", async () => {
  const h = harness(calls({ plan: "Premium" }));
  await runStep(h.env, note("Plan: {{journey.plan}}"), callOf(trig));
  assert.equal(h.only("journeys.values.get")[0]!.input.recordId, "rec_c1");
  assert.equal(h.only("records.update")[0]!.input.patch.note, "Plan: Premium");
});

test("a value the Journey carries that nothing has kept yet fails the step and says an earlier step has to remember it", async () => {
  const h = harness(calls({ plan: "Premium" }));
  const line = await said(runStep(h.env, note("{{journey.owner}}"), callOf(trig)));
  assert.match(
    line,
    /\{\{journey\.owner\}\} has no value yet: nothing has kept "owner" for this record\. A step before this one has to remember it\./,
  );
  assert.equal(h.only("records.update").length, 0, "nothing was sent");
});

test("a name no Journey carries fails the step and says what they carry", async () => {
  const h = harness(calls({ plan: "x" }));
  const line = await said(runStep(h.env, note("{{journey.colour}}"), callOf(trig)));
  assert.match(line, /\{\{journey\.colour\}\} is not a value this Journey carries\. It carries owner, plan\./);
});

test("a step that does not name the Journey never asks for its values, and a Run about no record says nothing about the names", async () => {
  const h = harness(calls({}));
  await runStep(h.env, note("Plain"), callOf(trig));
  assert.equal(h.only("journeys.values.get").length, 0);
  const h2 = harness(calls({}));
  await runStep(h2.env, note("{{journey.plan}}"), callOf({ trigger: {} }));
  assert.equal(h2.only("journeys.values.get").length, 0, "no record, nothing to read");
});

test("the step that keeps a value sends the record, the name and the value to the Journey", async () => {
  const h = harness({ "journeys.values.set": () => ({ recordId: "rec_c1", key: "plan" }) });
  const r = await runStep(
    h.env,
    node("k", "journeys.values.set", { recordId: "rec_c1", key: "plan", value: "{{trigger.tier}}" }),
    callOf({ trigger: { tier: "Gold" } }),
  );
  assert.deepEqual(h.only("journeys.values.set")[0]!.input, { recordId: "rec_c1", key: "plan", value: "Gold" });
  assert.deepEqual(r.output, { recordId: "rec_c1", key: "plan" });
});
