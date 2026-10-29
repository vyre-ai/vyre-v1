import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import { run } from "../fixtures/seed.ts";
test("form editor reads consent, captcha, finish settings and step grouping without dropping them", async () => {
  const h = harness();
  const made = await run(h.ctx, "forms.create", { name: "Editor fixture", recordType: "contact", kind: "public" });
  const formId = made.form.formId;
  await run(h.ctx, "forms.update", { formId, consentText: "I agree", captcha: true, rateLimit: 12 });
  await run(h.ctx, "forms.design_set", { formId, thankYou: { text: "Thank you" }, css: "input { border-color: purple; }" });
  await run(h.ctx, "forms.fields_set", { formId, fields: [{ field: "name", mode: "ask", prefillKey: "full_name", step: 2 }] });
  const got = await run(h.ctx, "forms.get", { formId });
  assert.deepEqual(got.settings, { consentText: "I agree", captcha: true, rateLimit: 12, thankYou: { text: "Thank you" } });
  assert.equal(got.css, "input { border-color: purple; }");
  assert.equal(got.fields[0].step, 2);
  assert.equal(got.fields[0].prefillKey, "full_name");
});
