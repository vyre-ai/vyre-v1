// An Automation sees a record's change as its person may see it (24 Nov 2026, the release audit of the hidden-field leak): the host's field rule (ctx.recordFieldGate) cuts the trigger, the filter judges
// the cut event, a record the person may not see starts nothing, a deletion needs a person who may still see the type, and what an old Run kept is cut again when it is shown or started again.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, create, engine, goodDefinition, node } from "../fixtures/seed.ts";
import { consumeEvent } from "../impl.ts";
import type { LoggedEvent } from "../handlers/triggers.ts";
import { findRunLink, saveRunLink } from "../projections.ts";

const step = node("a", "records.update", { type: "contact", recordId: "rec_1", patch: { status: "x" } });
const seen = new Set(["name"]); // the person may see the name, not the email
const gate = async (_p: string, _t: string, id: string) => (id === "rec_none" ? null : (f: string) => seen.has(f));
const live = async (h: Harness, filter?: unknown): Promise<string> => {
  const id = (
    await h.call(
      "automations.create",
      create({ definition: goodDefinition({ triggers: [{ key: "record_change", ...(filter ? { filter } : {}) }], nodes: [step] }) }),
      alice,
    )
  ).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  return id;
};
const ev = (id: string, recordId: string, type = "record.updated"): LoggedEvent => ({
  id,
  type,
  payload: {
    recordId,
    type: "contact",
    fields: { name: "Ada B", email: "ada-new@example.com" },
    prev: { name: "Ada", email: "ada-old@example.com" },
    version: 2,
  },
});
const fired = async (h: Harness, e: LoggedEvent) => {
  const out = await h.consumer(engine, (ctx) => consumeEvent(ctx, e));
  return out.map((o) => ({ ...o, payload: "runId" in o.result ? findRunLink(h.db as never, o.result.runId)?.payload : undefined }));
};

test("the trigger carries the fields the Automation's person may see and a record they may not see starts nothing", async () => {
  const h = harness({ recordFieldGate: gate });
  await live(h);
  const out = await fired(h, ev("evt_1", "rec_1"));
  assert.equal(out.length, 1);
  const p = out[0]!.payload as Record<string, any>;
  assert.deepEqual(p.record, { name: "Ada B" });
  assert.deepEqual(p.changed, { name: "Ada B" });
  assert.deepEqual(p.fields, ["name"]);
  assert.ok(!JSON.stringify(p).includes("ada-"), "no email, new or old");
  assert.deepEqual(await fired(h, ev("evt_2", "rec_none")), [], "a record the person cannot see starts nothing, and nothing is reported");
});

test("a filter on a field the person cannot see matches nothing, and a filter on one they can see matches", async () => {
  const h = harness({ recordFieldGate: gate });
  await live(h, { where: { email: "ada-new@example.com" } });
  assert.deepEqual(await fired(h, ev("evt_3", "rec_1")), [], "the hidden value does not match, so it is not told");
  const h2 = harness({ recordFieldGate: gate });
  await live(h2, { where: { name: "Ada B" } });
  assert.equal((await fired(h2, ev("evt_4", "rec_1"))).length, 1);
});

test("a deletion is judged on the kept row: a person who could see the record is told with the values they may see, one who could not is not told at all", async () => {
  const del: LoggedEvent = {
    id: "evt_5",
    type: "record.deleted",
    payload: { recordId: "rec_gone", type: "contact", prev: { name: "Ada", email: "x@y.z" } },
  };
  const asked: Array<{ deleted?: boolean | undefined }> = [];
  const h = harness({
    recordFieldGate: async (_p, _t, id, opts) => {
      asked.push({ deleted: opts?.deleted });
      return id === "rec_gone" ? (f: string) => seen.has(f) : null;
    },
  });
  await live(h);
  const out = await fired(h, del);
  assert.equal(out.length, 1);
  assert.deepEqual((out[0]!.payload as Record<string, any>).record, { name: "Ada" });
  assert.ok(!JSON.stringify(out[0]!.payload).includes("x@y.z"));
  assert.equal(asked[0]?.deleted, true, "the host is told the record is a trashed one");
  const hidden: LoggedEvent = { ...del, id: "evt_6", payload: { ...del.payload, recordId: "rec_none" } };
  assert.deepEqual(await fired(h, hidden), [], "a deletion of a record the person could not see is not told");
});

test("a record the access does not know yet is tried again, never skipped: the Automation fires once, with the visible fields", async () => {
  let asks = 0;
  const h = harness({
    recordFieldGate: async () => (++asks <= 1 ? "later" : (f: string) => seen.has(f)),
  });
  await live(h);
  const created: LoggedEvent = {
    id: "evt_7",
    type: "record.created",
    payload: { recordId: "rec_new", type: "contact", fields: { name: "New Nia", email: "nia@example.com" } },
  };
  // the first delivery meets a snapshot that does not know the record: the consumer is made to try again
  await assert.rejects(fired(h, created), /not known yet/);
  const again = await fired(h, created);
  assert.equal(again.length, 1, "it fires on the retry");
  assert.deepEqual((again[0]!.payload as Record<string, any>).record, { name: "New Nia" });
  const third = await fired(h, created);
  assert.equal(third.length, 1);
  assert.equal(
    (third[0]!.result as { runId: string }).runId,
    (again[0]!.result as { runId: string }).runId,
    "a third delivery of the same event starts no second run",
  );
});

test("what an old Run kept is cut again when test_events shows it, and a test or a replay starts from the cut payload", async () => {
  const h = harness({ recordFieldGate: gate });
  const id = await live(h);
  saveRunLink(h.db as never, {
    runId: "run_old00000000000000000000000001",
    automationId: id,
    version: 1,
    trigger: "record_change",
    test: false,
    payload: { record: { name: "Ada", email: "old@example.com" }, recordId: "rec_1", type: "contact", op: "updated", fields: ["name", "email"], changed: { email: "old@example.com" }, version: 1 },
    depth: 0,
    principal: { kind: "person", id: alice.id },
    startedAt: 1,
  });
  saveRunLink(h.db as never, {
    runId: "run_old00000000000000000000000002",
    automationId: id,
    version: 1,
    trigger: "record_change",
    test: false,
    payload: { record: { name: "Zed" }, recordId: "rec_none", type: "contact", op: "updated", fields: ["name"], changed: {}, version: 1 },
    depth: 0,
    principal: { kind: "person", id: alice.id },
    startedAt: 2,
  });
  const te = await h.call("automations.test_events", { automationId: id }, alice);
  assert.equal(te.events.length, 1, "the run for a record the person cannot see is not offered");
  assert.deepEqual(te.events[0].payload.record, { name: "Ada" });
  assert.deepEqual(te.events[0].payload.fields, ["name"]);
  assert.deepEqual(te.events[0].payload.changed, {});
  assert.ok(!JSON.stringify(te).includes("old@example.com"));
  const r = await h.call("automations.test", { automationId: id, eventRunId: "run_old00000000000000000000000001" }, alice);
  assert.ok(!JSON.stringify(findRunLink(h.db as never, r.runId)!.payload).includes("old@example.com"), "a test starts from the cut payload");
});
