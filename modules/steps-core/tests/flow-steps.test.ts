// The two steps the law-firm audit found missing (r40 audit, gap 5): a one-use link to a form for a record that exists, and a move of a record to a stage of its Journey.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { harness } from "../fixtures/db.ts";
import { callOf, node } from "../fixtures/seed.ts";
import { runStep } from "../handlers/control.ts";

test("Make a form link asks for a one-use link for the record and hands the url to the steps after it", async () => {
  const h = harness({ "forms.link_create": () => ({ url: "https://x.example/f?t=abc", expiresAt: 1 }) });
  const out = await runStep(
    h.env,
    node("link", "forms.link_create", { formId: "frm_a1b2c3", recordId: "rec_a1b2c3" }),
    callOf({ trigger: {} }),
  );
  assert.deepEqual(out.output, { url: "https://x.example/f?t=abc", expiresAt: 1 });
  const sent = h.only("forms.link_create")[0]!.input as Record<string, unknown>;
  assert.equal(sent["singleUse"], true, "one use unless the step says otherwise");
  assert.equal(sent["formId"], "frm_a1b2c3");
  assert.equal(typeof sent["idempotencyKey"], "string");
  await runStep(
    h.env,
    node("link", "forms.link_create", {
      formId: "frm_a1b2c3",
      recordId: "rec_a1b2c3",
      singleUse: false,
      expiresInHours: 48,
    }),
    callOf({ trigger: {}, key: "run_t1:link:2" }),
  );
  const again = h.only("forms.link_create")[1]!.input as Record<string, unknown>;
  assert.deepEqual([again["singleUse"], again["expiresInHours"]], [false, 48]);
});

test("Move to a stage moves the record and says why; with no reason it says an automation moved it", async () => {
  const h = harness({
    "journeys.move_stage": (i) => ({
      recordId: (i as { recordId: string }).recordId,
      stage: (i as { toStage: string }).toStage,
    }),
  });
  const out = await runStep(
    h.env,
    node("mv", "journeys.move_stage", { journeyId: "jrn_a1b2c3", recordId: "rec_a1b2c3", toStage: "review" }),
    callOf({ trigger: {} }),
  );
  assert.deepEqual(out.output, { recordId: "rec_a1b2c3", stage: "review" });
  assert.equal((h.only("journeys.move_stage")[0]!.input as { reason: string }).reason, "Moved by an automation");
  await runStep(
    h.env,
    node("mv", "journeys.move_stage", {
      journeyId: "jrn_a1b2c3",
      recordId: "rec_a1b2c3",
      toStage: "done",
      reason: "Signed",
    }),
    callOf({ trigger: {}, key: "run_t1:mv:2" }),
  );
  assert.equal((h.only("journeys.move_stage")[1]!.input as { reason: string }).reason, "Signed");
});

test("both steps are in the catalogue, write steps that a test run stubs, and name real capabilities", () => {
  for (const key of ["forms.link_create", "journeys.move_stage"]) {
    const s = registry.steps.find((x) => x.key === key);
    assert.ok(s, key);
    assert.equal(s.effects, "write");
    assert.ok(
      registry.capabilities.some((c) => c.name === s.cap),
      `${key} names ${s.cap}`,
    );
  }
});

test("Draft a Gmail message makes a draft with the copies and the From address, and never sends", async () => {
  const h = harness({ "google.gmail.create_draft": () => ({ draftId: "r-1" }) });
  const out = await runStep(
    h.env,
    node("d", "google.gmail.create_draft", {
      connectionId: "con_a1b2c3",
      as: "ann@firm.example",
      to: ["c@x.example"],
      cc: ["b@x.example"],
      subject: "Hi",
      text: "Body",
    }),
    callOf({ trigger: {} }),
  );
  assert.deepEqual(out.output, { draftId: "r-1" });
  const sent = h.log[0]!.input as Record<string, unknown>;
  assert.deepEqual([sent["as"], sent["cc"]], ["ann@firm.example", ["b@x.example"]]);
  assert.equal(
    h.log.some((c) => /send_message/.test(c.cap)),
    false,
  );
  const s = registry.steps.find((x) => x.key === "google.gmail.create_draft");
  assert.equal(s?.gateAct, undefined, "a draft has no send act on the Gate");
});

test("the read and draft-only steps of the connected apps are in the catalogue", () => {
  for (const key of [
    "google.gmail.create_draft",
    "google.gmail.get_message",
    "google.calendar.get_event",
    "google.drive.get_file",
    "ms.mail.create_draft",
    "ms.mail.get_message",
  ]) {
    const s = registry.steps.find((x) => x.key === key);
    assert.ok(s, key);
    assert.ok(!s.gateAct || s.gateAct !== "send", `${key} must not be a send`);
  }
});
