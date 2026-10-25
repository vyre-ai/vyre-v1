// Golden flow 1, form leg: a public form is submitted, the person is matched, form.submitted is announced with what a Journey Start rule needs,
// and a second submit by the same person lands on the same record. Journeys and Projects are other lanes; this test proves the form step they wait for.
// @reads /modules/forms/migrations/0001_forms.sql

import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/world.ts";
import { openForm, run } from "../fixtures/seed.ts";

test("golden 1 form step: submit, match, form.submitted with the record, First source set", async () => {
  const w = harness();
  const f = await openForm(w, { name: "Estate planning intake" });
  const trace: string[] = [];
  const step = (name: string, detail: Record<string, unknown>): void => {
    trace.push(`${String(trace.length + 1).padStart(2, "0")} ${name} ${JSON.stringify(detail)}`);
  };

  step("form.published", { slug: f.slug, url: (await run<{ url: string }>(w.ctx, "forms.publish", { formId: f.formId })).url });
  const out = await run<{ recordId: string }>(f.public, "forms.submit", {
    slug: f.slug, answers: { email: "Dana@Client.example", name: "Dana Reyes", phone: "555 0100" },
    attribution: { consent: true, utmSource: "google", utmMedium: "cpc", utmCampaign: "estate-plans", clickIds: { gclid: "g-1" }, referrer: "https://www.google.com/", landingPage: "https://harbor.example/wills" },
  });
  const submitted = w.events.filter((e) => e.name === "form.submitted");
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0]?.payload, { formId: f.formId, recordId: out.recordId, type: "contact", matched: false });
  step("form.submitted", { subject: submitted[0]?.subject, ...(submitted[0]?.payload as Record<string, unknown>) });

  const writer = w.calls.find((c) => c.cap === "records.create");
  assert.match(writer?.principal.id ?? "", /^svc_form_/);
  step("record.written", { as: writer?.principal.id, type: "contact", fields: Object.keys(w.records.get(out.recordId)?.fields ?? {}) });

  const src = await run<{ first?: { utmSource?: string }; latest?: { utmSource?: string } }>(w.ctx, "forms.attribution_get", { recordId: out.recordId });
  assert.equal(src.first?.utmSource, "google");
  assert.equal(w.db.rows("forms_attribution")[0]?.first_channel, "paid");
  step("first_source", { source: src.first?.utmSource, channel: w.db.rows("forms_attribution")[0]?.first_channel });

  w.advance(5 * 60_000);
  const again = await run<{ recordId: string }>(f.public, "forms.submit", { slug: f.slug, answers: { email: "dana@client.example", phone: "555 0111" } });
  assert.equal(again.recordId, out.recordId);
  assert.equal((w.events.filter((e) => e.name === "form.submitted")[1]?.payload as { matched: boolean }).matched, true);
  step("form.submitted", { recordId: again.recordId, matched: true });
  assert.equal(w.records.size, 1);

  for (const line of trace) console.log(`golden1-form-step ${line}`);
});
