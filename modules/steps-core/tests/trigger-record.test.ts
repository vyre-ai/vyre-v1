// A form, a button or a stage move names a record; the step that reads `trigger.record` gets it read through the Run's own principal, never through the service that noticed the event (review 19 Nov, point 7).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { callOf, node } from "../fixtures/seed.ts";
import { runStep } from "../handlers/control.ts";

const FIELDS = { name: "Ada", ssn: { sealed: "ssn", present: true }, email: "a@x.example" };
const note = (text: string) =>
  node("m", "records.update", { type: "contact", recordId: "rec_a1", patch: { note: text } });
const noteOf = (h: ReturnType<typeof harness>, i = 0): unknown =>
  (h.only("records.update")[i]!.input as { patch: { note: unknown } }).patch.note;
const form = { formId: "frm_1", recordId: "rec_9", type: "contact", matched: true };
const withKind = (kind: string, calls: Parameters<typeof harness>[0]) =>
  harness(
    { "records.update": () => ({ recordId: "rec_a1", version: 2 }), ...calls },
    { run: { id: "run_t1", trigger: kind } },
  );

test("a form's record is read for the step that asks, without its sealed fields", async () => {
  const h = withKind("form_submit", { "records.get": () => ({ record: { fields: FIELDS } }) });
  await runStep(h.env, note("{{trigger.record.name}}|{{trigger.record.ssn}}"), callOf({ trigger: form }));
  assert.equal(noteOf(h), "Ada|");
  assert.deepEqual(h.only("records.get")[0]!.input, { type: "contact", recordId: "rec_9" });
});

test("a step that does not read the record causes no read of it", async () => {
  const h = withKind("form_submit", { "records.get": () => ({ record: { fields: FIELDS } }) });
  await runStep(h.env, note("{{trigger.recordId}}"), callOf({ trigger: form }));
  assert.equal(h.only("records.get").length, 0);
});

test("a record the Run's principal may not read never reaches the template: the step fails and nothing is written", async () => {
  const h = withKind("form_submit", {
    "records.get": () => {
      throw Object.assign(new Error("no"), { error: { code: "permission.no_grant" } });
    },
  });
  await assert.rejects(runStep(h.env, note("{{trigger.record.email}}"), callOf({ trigger: form })), (e) =>
    /has nothing to read: this trigger should carry "record"/.test(
      (e as { error?: { message?: string } }).error?.message ?? "",
    ),
  );
  assert.equal(h.only("records.update").length, 0);
});

test("the read goes through the Run's own ctx: whoever that ctx is, is who is asked", async () => {
  const seen: string[] = [];
  const h = withKind("button", { "records.get": () => ({ record: { fields: FIELDS } }) });
  const call = h.ctx.call!.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    seen.push(`${h.ctx.principal.kind}:${h.ctx.principal.id}:${cap}`);
    return call(cap, input);
  };
  await runStep(
    h.env,
    note("{{trigger.record.name}}"),
    callOf({ trigger: { pressedBy: "usr_a", recordId: "rec_9", type: "contact" } }),
  );
  assert.ok(seen.includes("service:svc_run:records.get"), JSON.stringify(seen));
});

test("a stage move reads the record of the Journey by the Journey's own record type", async () => {
  const h = withKind("journey_stage_entered", {
    "journeys.get": () => ({ journey: { recordType: "matter" } }),
    "records.get": () => ({ record: { fields: FIELDS } }),
  });
  await runStep(
    h.env,
    note("{{trigger.record.name}}"),
    callOf({ trigger: { journeyId: "jrn_1", recordId: "rec_7", stage: "review", manual: false } }),
  );
  assert.equal(noteOf(h), "Ada");
  assert.deepEqual(h.only("records.get")[0]!.input, { type: "matter", recordId: "rec_7" });
});

test("a name with a fallback renders the fallback when it has nothing; the same name without one fails", async () => {
  const h = withKind("manual", {});
  await runStep(h.env, note("{{ steps.find.out.count ?? 'none' }}"), callOf({ trigger: {}, outputs: { other: {} } }));
  await runStep(
    h.env,
    note("{{ steps.find.out.count || 'zero' }}"),
    callOf({ trigger: {}, outputs: {}, key: "run_t1:m:2" }),
  );
  await runStep(
    h.env,
    note("{{ exists(steps.find.out.count) }}"),
    callOf({ trigger: {}, outputs: {}, key: "run_t1:m:3" }),
  );
  assert.deepEqual([noteOf(h, 0), noteOf(h, 1), noteOf(h, 2)], ["none", "zero", false]);
  await assert.rejects(
    runStep(h.env, note("{{ steps.find.out.count }}"), callOf({ trigger: {}, outputs: { other: {} } })),
  );
  // a value that is there is used, with or without a fallback
  await runStep(
    h.env,
    note("{{ steps.find.out.count ?? 'none' }}"),
    callOf({ trigger: {}, outputs: { find: { count: 4 } }, key: "run_t1:m:5" }),
  );
  assert.equal(noteOf(h, 3), 4);
});
