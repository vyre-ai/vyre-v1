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
