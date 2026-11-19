// A record change carries the record, minus sealed values, as it fires. A form, a button and a stage move name the record; the Run reads it as its own principal when a step asks (modules/steps-core/tests/trigger-record.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, engine, goodDefinition, node } from "../fixtures/seed.ts";
import { consumeEvent } from "../impl.ts";
import type { LoggedEvent } from "../handlers/triggers.ts";
import { findRunLink } from "../projections.ts";

const FIELDS = { name: "Ada", email: "ada@example.com", ssn: { sealed: "ssn", present: true }, stage: "new" };
const step = node("a", "records.update", { type: "contact", recordId: "rec_1", patch: { status: "x" } });
const live = async (h: Harness, triggers: { key: string; filter?: unknown }[]): Promise<string> => {
  const id = (
    await h.call("automations.create", create({ definition: goodDefinition({ triggers, nodes: [step] }) }), alice)
  ).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  return id;
};
const withRecords = (h: Harness, fail = false): void => {
  h.callee("records.get", (i) => {
    if (fail) throw new Error("no access");
    return { record: { id: i.recordId, type: i.type, version: 1, label: 0, fields: FIELDS, holds: 0 } };
  });
  h.callee("journeys.get", () => ({ journey: { id: "jrn_1", recordType: "matter" } }));
};
const payloadOf = async (h: Harness, ev: LoggedEvent): Promise<Record<string, any> | undefined> => {
  const out = await h.consumer(engine, (ctx) => consumeEvent(ctx, ev));
  const r = out[0]?.result as { runId?: string } | undefined;
  return r?.runId ? (findRunLink(h.db as never, r.runId)?.payload as Record<string, any>) : undefined;
};

test("a form submit fires with the record named, and its filter reads `type`; the service that noticed the event reads no record", async () => {
  const h = harness();
  withRecords(h);
  await live(h, [{ key: "form_submit", filter: { type: "contact" } }]);
  const ev: LoggedEvent = {
    id: "evt_f1",
    type: "form.submitted",
    payload: { formId: "frm_1", recordId: "rec_9", type: "contact", matched: false },
  };
  const p = await payloadOf(h, ev);
  assert.ok(p, "the filter on type did not match");
  assert.equal(p.recordId, "rec_9");
  assert.equal("record" in p, false);
  assert.equal(h.calls.filter((c) => c.cap === "records.get" || c.cap === "journeys.get").length, 0);
  const none = await h.consumer(engine, (ctx) =>
    consumeEvent(ctx, { ...ev, id: "evt_f2", payload: { ...ev.payload, type: "matter" } }),
  );
  assert.deepEqual(none, []);
});

test("a record change never carries a sealed value", async () => {
  const h = harness();
  const id = await live(h, [{ key: "record_change", filter: { type: "contact" } }]);
  assert.ok(id);
  const p = await payloadOf(h, {
    id: "evt_c9",
    type: "record.updated",
    payload: {
      recordId: "rec_1",
      type: "contact",
      fields: { name: "A", ssn: { sealed: "ssn", present: true } },
      prev: { name: "B" },
    },
  });
  assert.deepEqual(p?.record, { name: "A" });
  assert.deepEqual(p?.changed, { name: "A" });
});

test("a button pressed on a record names it in the Run, which reads it as itself", async () => {
  const h = harness();
  withRecords(h);
  const id = await live(h, [{ key: "button" }]);
  const out = await h.call(
    "automations.run",
    { automationId: id, trigger: "button", payload: { recordId: "rec_3", type: "contact" } },
    alice,
  );
  const p = findRunLink(h.db as never, out.runId)?.payload as Record<string, any>;
  assert.equal(p.recordId, "rec_3");
  assert.equal(p.type, "contact");
  assert.equal("record" in p, false);
});
