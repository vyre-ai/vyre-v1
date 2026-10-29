// A step test result must not carry a secret that was only in the step input.
// Ask Vyre scrubbing is a different path and is not this check.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { stepsTest } from "../handlers/control.ts";

const SECRET = "sk-live-abcdefghij";
const BEARER = "ya29.super-secret-token";

test("a step test result does not contain a secret from the step input", async () => {
  const h = harness();
  const sent = await stepsTest(h.ctx, {
    key: "send_email",
    input: { mailboxId: "mbx_1", to: ["a@b.c"], subject: "Hi", body: `Bearer ${BEARER} ${SECRET}` },
  });
  const sentText = JSON.stringify(sent);
  assert.equal(sentText.includes(SECRET), false);
  assert.equal(sentText.includes(BEARER), false);
  assert.equal((sent as { stubbed?: boolean }).stubbed, true);

  const read = await stepsTest(h.ctx, {
    key: "google.gmail.list_messages",
    input: { connectionId: "con_1", q: SECRET, authorization: `Bearer ${BEARER}` },
  }) as { output: unknown; error?: { code?: string; message?: string } };
  const readText = JSON.stringify(read);
  assert.equal(readText.includes(SECRET), false);
  assert.equal(readText.includes(BEARER), false);
  assert.equal(read.output, null);
  assert.equal(read.error?.code, "validation.bad_input");
  assert.match(read.error?.message ?? "", /cannot hold a secret/);
});
