// The Automation step "Send for signature" with built-in signing (17 Nov 2026): it reaches esign.send with the signers, the record and the note, a signer with no email is allowed, and the Run goes on with the envelope.
// The held-for-approval path (the Gate parks the Run on the approval task) is the same one every outward step takes (control.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { harness, MiniRun } from "../fixtures/db.ts";
import { node } from "../fixtures/seed.ts";

test("the sign step sends the file with the signers, the record and the note, and the Run goes on with the envelope", async () => {
  const h = harness();
  h.callee("esign.send", () => ({
    envelopeId: "env_1",
    links: [{ index: 0, name: "Andrea Lindahl", path: "/p/sign/x/" }],
    notice: "This Space has no sending mailbox, so nothing was emailed. Copy each link and send it yourself.",
  }));
  const run = await new MiniRun(
    h,
    [
      node("sg", "sign", {
        fileId: "fil_agreement",
        signers: [
          { name: "Andrea Lindahl", email: "{{ trigger.email }}" },
          { name: "Sam Okafor", email: "" },
        ],
        recordId: "rec_matter",
        message: "Please sign by {{ trigger.day }}",
      }),
      node("after", "stop", {}),
    ],
    { email: "andrea@northwind.example", day: "Friday" },
  ).run();
  assert.equal(run.state, "succeeded");
  assert.deepEqual(run.outputs.sg, { envelopeId: "env_1" });
  const sent = h.only("esign.send")[0]!.input;
  assert.equal(sent.fileId, "fil_agreement");
  assert.equal(sent.recordId, "rec_matter");
  assert.equal(sent.message, "Please sign by Friday");
  assert.deepEqual(sent.signers, [
    { name: "Andrea Lindahl", email: "andrea@northwind.example" },
    { name: "Sam Okafor", email: "" },
  ]);
  assert.match(String(sent.idempotencyKey), /^run_t1:sg/);
});

test("a sign step never carries plainOk: even when the step's settings name it, esign.send gets no such field, so a preview copy in an Automation is held back whoever approves the step", async () => {
  const h = harness();
  h.callee("esign.send", () => ({ envelopeId: "env_1", links: [] }));
  const run = await new MiniRun(
    h,
    [
      node("sg", "sign", {
        fileId: "fil_agreement",
        signers: [{ name: "Andrea Lindahl", email: "a@northwind.example" }],
        plainOk: true,
      }),
      node("after", "stop", {}),
    ],
    {},
  ).run();
  assert.equal(run.state, "succeeded");
  const sent = h.only("esign.send")[0]!.input;
  assert.equal("plainOk" in sent, false);
  assert.equal(sent.fileId, "fil_agreement");
});

test("a sign step on a file that is not the exact copy stops in the step's own words, not the person's \"send this one anyway\"", async () => {
  const h = harness();
  h.callee("esign.send", () => {
    throw Object.assign(new Error("held"), {
      error: {
        code: "validation.precondition_failed",
        message: "Letterhead and pictures are missing in this copy. Wait for the exact copy, or send this one anyway.",
        details: { plain: true, checked: false, field: "plainOk" },
      },
    });
  });
  const run = await new MiniRun(
    h,
    [node("sg", "sign", { fileId: "fil_agreement", signers: [{ name: "Andrea Lindahl", email: "a@northwind.example" }] }), node("after", "stop", {})],
    {},
  ).run();
  assert.equal(run.state, "failed");
  assert.equal(run.error?.message, "This file isn't the exact Word copy, so the step stopped. Send it by hand or fix the template.");
  assert.doesNotMatch(String(run.error?.message), /send this one anyway/);
});
