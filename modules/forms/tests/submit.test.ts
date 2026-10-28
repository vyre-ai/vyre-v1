// forms.submit: consent, captcha, rate limits, matching, attribution and the principal the write runs as (spec 2.11; ARCH 7.6).
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/forms/migrations/0001_forms.sql

import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureForms } from "../projections.ts";
import { formPrincipal } from "../handlers/submit.ts";
import { harness } from "../fixtures/world.ts";
import { code, openForm, run } from "../fixtures/seed.ts";

interface SubmitOut { recordId: string; thankYou?: string }
const submit = (f: { slug: string; public: Ctx }, input: Record<string, unknown>) =>
  run<SubmitOut>(f.public, "forms.submit", { slug: f.slug, ...input });

test("a public submit creates a record as the form's service principal and fires form.submitted", async () => {
  const w = harness();
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "dana@client.example", name: "Dana" } });
  assert.match(out.recordId, /^rec_/);
  const create = w.calls.find((c) => c.cap === "records.create");
  assert.ok(create);
  assert.deepEqual(create.principal, { kind: "service", id: formPrincipal(f.formId) });
  assert.match(create.principal.id, /^svc_form_/);
  assert.deepEqual(w.records.get(out.recordId)?.fields, { email: "dana@client.example", name: "Dana" });
  const ev = w.events.filter((e) => e.name === "form.submitted");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]?.payload, { formId: f.formId, recordId: out.recordId, type: "contact", matched: false });
  assert.equal(ev[0]?.subject, `form/${f.formId}`);
  const list = await run<{ rows: { recordId: string; matched: boolean }[]; total: number }>(w.ctx, "forms.submissions", { formId: f.formId });
  assert.equal(list.total, 1);
  assert.deepEqual(list.rows.map((r) => [r.recordId, r.matched]), [[out.recordId, false]]);
});

test("a second submit with the same email updates that record and does not blank what is there", async () => {
  const w = harness();
  const f = await openForm(w);
  const first = await submit(f, { answers: { email: "Dana@Client.example ", name: "Dana", phone: "555" } });
  w.advance(120_000);
  const second = await submit(f, { answers: { email: "dana@client.example", name: "Dana L", phone: "" } });
  assert.equal(second.recordId, first.recordId);
  assert.equal(w.records.size, 1);
  assert.deepEqual(w.records.get(first.recordId)?.fields, { email: "dana@client.example", name: "Dana L", phone: "555" });
  assert.equal((w.events.filter((e) => e.name === "form.submitted")[1]?.payload as { matched: boolean }).matched, true);
});

test("several records with the match key: a record is created and the doubt goes to Needs you", async () => {
  const w = harness();
  w.addRecord({ id: "rec_a", type: "contact", fields: { email: "dup@x.example" } });
  w.addRecord({ id: "rec_b", type: "contact", fields: { email: "dup@x.example" } });
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "dup@x.example", name: "Dup" } });
  assert.notEqual(out.recordId, "rec_a");
  assert.notEqual(out.recordId, "rec_b");
  assert.equal(w.tasks.length, 1);
  assert.equal((w.tasks[0] as { recordId: string }).recordId, out.recordId);
  assert.equal((w.events.find((e) => e.name === "form.submitted")?.payload as { matched: boolean }).matched, false);
});

test("a custom match rule uses the chosen field", async () => {
  const w = harness();
  w.addRecord({ id: "rec_p", type: "contact", fields: { phone: "555", name: "Old" } });
  const f = await openForm(w, { matchRule: ["phone"] });
  const out = await submit(f, { answers: { phone: "555", name: "New" } });
  assert.equal(out.recordId, "rec_p");
  assert.equal(w.records.get("rec_p")?.fields.name, "New");
});

test("questions: unknown refused, Show ignored, Hide only with a prefill key", async () => {
  const w = harness();
  const f = await openForm(w, {
    fields: [{ field: "email", mode: "ask" }, { field: "plan", mode: "show" }, { field: "source_page", mode: "hide", prefillKey: "src" }, { field: "secret", mode: "hide" }],
  });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example", nope: "x" } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example", secret: "x" } })), "validation.bad_input");
  const out = await submit(f, { answers: { email: "a@x.example", plan: "gold", source_page: "/pricing" } });
  assert.deepEqual(w.records.get(out.recordId)?.fields, { email: "a@x.example", source_page: "/pricing" });
});

test("answers must be plain values and an email must look like one", async () => {
  const w = harness();
  const f = await openForm(w);
  assert.equal(await code(submit(f, { answers: { email: "not-an-email" } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example", name: { evil: true } } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: [] })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example", name: "x".repeat(10_001) } })), "validation.too_large");
  assert.equal(w.records.size, 0);
});

test("a draft, closed or deleted form answers as not found", async () => {
  const w = harness();
  const draft = await openForm(w, { publish: false });
  assert.equal(await code(submit(draft, { answers: { email: "a@x.example" } })), "validation.not_found");
  const f = await openForm(w, { name: "Second" });
  await run(w.ctx, "forms.unpublish", { formId: f.formId });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" } })), "validation.not_found");
  await run(w.ctx, "forms.publish", { formId: f.formId });
  await submit(f, { answers: { email: "a@x.example" } });
  await run(w.ctx, "forms.delete", { formId: f.formId });
  assert.equal(await code(submit(f, { answers: { email: "b@x.example" } })), "validation.not_found");
  assert.equal(await code(run(w.ctx, "forms.get", { formId: f.formId })), "validation.not_found");
});

test("one form's service principal cannot submit another form", async () => {
  const w = harness();
  const a = await openForm(w, { name: "A" });
  const b = await openForm(w, { name: "B" });
  assert.equal(await code(run(a.public, "forms.submit", { slug: b.slug, answers: { email: "a@x.example" } })), "permission.no_grant");
  assert.equal(w.records.size, 0);
});

// ---- consent -------------------------------------------------------------------------------------------------

test("consent text: no consent, no write; consent from attribution or the reserved answer key; the key is never stored", async () => {
  const w = harness();
  const f = await openForm(w, { consentText: "I agree to be contacted." });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, attribution: { consent: false } })), "validation.bad_input");
  assert.equal(w.records.size, 0);
  const one = await submit(f, { answers: { email: "a@x.example" }, attribution: { consent: true } });
  const two = await submit(f, { answers: { email: "b@x.example", consent: true } });
  const three = await submit(f, { answers: { email: "c@x.example", consent: "true" } });
  for (const r of [one, two, three]) assert.equal("consent" in (w.records.get(r.recordId)?.fields ?? {}), false);
  assert.equal(w.db.rows("forms_submission").every((s) => s.consent === 1), true);
});

test("without consent text the form still records what the visitor chose", async () => {
  const w = harness();
  const f = await openForm(w);
  await submit(f, { answers: { email: "a@x.example" } });
  assert.equal(w.db.rows("forms_submission")[0]?.consent, 0);
});

// ---- captcha -------------------------------------------------------------------------------------------------

test("captcha on: missing and wrong tokens are refused before any write; a good one passes", async () => {
  const w = harness();
  const f = await openForm(w, { captcha: true });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" } })), "auth.invalid_code");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, captcha: "robot" })), "auth.invalid_code");
  assert.equal(w.records.size, 0);
  assert.deepEqual(w.captcha.checked, ["robot"]);
  const out = await submit(f, { answers: { email: "a@x.example" }, captcha: "human" });
  assert.ok(w.records.has(out.recordId));
});

test("captcha on but no verifier configured fails closed; a verifier that throws is a provider error", async () => {
  const w = harness({ captcha: false });
  const f = await openForm(w, { captcha: true });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, captcha: "human" })), "validation.precondition_failed");
  const w2 = harness();
  const f2 = await openForm(w2, { captcha: true });
  w2.captcha.throws = true;
  assert.equal(await code(submit(f2, { answers: { email: "a@x.example" }, captcha: "human" })), "provider.unavailable");
  assert.equal(w2.records.size, 0);
  assert.ok(w2.warnings.some((m) => m.includes("captcha")));
});

test("captcha off: the verifier is never called", async () => {
  const w = harness();
  const f = await openForm(w);
  await submit(f, { answers: { email: "a@x.example" }, captcha: "anything" });
  assert.deepEqual(w.captcha.checked, []);
});

// ---- rate limits and duplicates ------------------------------------------------------------------------------

test("rate limit: the form's own limit per minute; a refused call is not counted; the window passes", async () => {
  const w = harness();
  const f = await openForm(w, { rateLimit: 3 });
  const g = await openForm(w, { name: "Other", rateLimit: 3 });
  for (const n of [1, 2, 3]) await submit(f, { answers: { email: `p${n}@x.example` } });
  assert.equal(await code(submit(f, { answers: { email: "p4@x.example" } })), "rate_limit.exceeded");
  assert.equal(await code(submit(f, { answers: { email: "p5@x.example" } })), "rate_limit.exceeded");
  assert.equal(w.db.rows("forms_hit").filter((h) => h.scope === `submit:${f.formId}`).length, 3);
  await submit(g, { answers: { email: "other@x.example" } });
  w.advance(61_000);
  await submit(f, { answers: { email: "p6@x.example" } });
  assert.equal(w.records.size, 5);
});

test("the default limit is 30 a minute", async () => {
  const w = harness();
  const f = await openForm(w);
  for (let n = 0; n < 30; n++) await submit(f, { answers: { email: `n${n}@x.example` } });
  assert.equal(await code(submit(f, { answers: { email: "late@x.example" } })), "rate_limit.exceeded");
});

test("an identical submit inside a minute is a duplicate; later it is a new submit", async () => {
  const w = harness();
  const f = await openForm(w);
  await submit(f, { answers: { email: "a@x.example", name: "A" } });
  assert.equal(await code(submit(f, { answers: { name: "A", email: "a@x.example" } })), "validation.duplicate");
  w.advance(61_000);
  await submit(f, { answers: { email: "a@x.example", name: "A" } });
  assert.equal(w.db.rows("forms_submission").length, 2);
});

test("a failed write leaves no submission, no attribution and no event", async () => {
  const w = harness();
  const f = await openForm(w);
  w.state.failRecords = true;
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, attribution: { consent: true, utmSource: "x" } })), "internal.unexpected");
  assert.equal(w.db.rows("forms_submission").length, 0);
  assert.equal(w.db.rows("forms_attribution").length, 0);
  assert.deepEqual(w.names().filter((n) => n === "form.submitted"), []);
});

test("thank-you text or redirect comes back from the submit", async () => {
  const w = harness();
  const f = await openForm(w);
  await run(w.ctx, "forms.design_set", { formId: f.formId, thankYou: { text: "Thanks, we will call you." } });
  assert.equal((await submit(f, { answers: { email: "a@x.example" } })).thankYou, "Thanks, we will call you.");
  await run(w.ctx, "forms.design_set", { formId: f.formId, thankYou: { text: "ignored", redirect: "https://harbor.example/thanks" } });
  assert.equal((await submit(f, { answers: { email: "b@x.example" } })).thankYou, "https://harbor.example/thanks");
  assert.equal(await code(run(w.ctx, "forms.design_set", { formId: f.formId, thankYou: { redirect: "javascript:alert(1)" } })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.design_set", { formId: f.formId, thankYou: { redirect: "//evil.example" } })), "validation.bad_input");
});

// ---- attribution ---------------------------------------------------------------------------------------------

const FULL = {
  consent: true, utmSource: "google", utmMedium: "cpc", utmCampaign: "estate-plans", clickIds: { gclid: "abc123", fbclid: "zzz" },
  referrer: "https://www.google.com/search?q=wills", landingPage: "https://harbor.example/wills?utm_source=google", device: "mobile", location: "Roseville, US",
};

test("attribution: UTMs, click ids, referrer, landing page, device and location are captured with consent", async () => {
  const w = harness();
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "a@x.example" }, attribution: FULL });
  const got = await run<{ first?: Record<string, unknown>; latest?: Record<string, unknown> }>(w.ctx, "forms.attribution_get", { recordId: out.recordId });
  assert.deepEqual(got.first, FULL);
  assert.deepEqual(got.latest, FULL);
});

test("attribution: First source is set on create only; Latest moves on every submit", async () => {
  const w = harness();
  const f = await openForm(w);
  const first = await submit(f, { answers: { email: "a@x.example" }, attribution: { consent: true, utmSource: "google", utmMedium: "cpc" } });
  w.advance(120_000);
  await submit(f, { answers: { email: "a@x.example", name: "A" }, attribution: { consent: true, utmSource: "newsletter", utmMedium: "email" } });
  const got = await run<{ first?: { utmSource?: string }; latest?: { utmSource?: string } }>(w.ctx, "forms.attribution_get", { recordId: first.recordId });
  assert.equal(got.first?.utmSource, "google");
  assert.equal(got.latest?.utmSource, "newsletter");
  const ch = w.db.rows("forms_attribution")[0];
  assert.equal(ch?.first_channel, "paid");
  assert.equal(ch?.latest_channel, "email");
});

test("attribution is consent-aware: without consent only campaign tags and the referrer host are kept", async () => {
  const w = harness();
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "a@x.example" }, attribution: { ...FULL, consent: false } });
  const got = await run<{ first?: Record<string, unknown> }>(w.ctx, "forms.attribution_get", { recordId: out.recordId });
  assert.deepEqual(got.first, { consent: false, utmSource: "google", utmMedium: "cpc", utmCampaign: "estate-plans", referrer: "www.google.com" });
});

test("a submit with no attribution stores none; a record with none reads back empty", async () => {
  const w = harness();
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "a@x.example" } });
  assert.deepEqual(await run(w.ctx, "forms.attribution_get", { recordId: out.recordId }), {});
});

test("attribution input is bounded and typed", async () => {
  const w = harness();
  const f = await openForm(w);
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, attribution: { consent: true, utmSource: 5 } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, attribution: "x" })), "validation.bad_input");
  const out = await submit(f, { answers: { email: "b@x.example" }, attribution: { consent: true, utmSource: "s".repeat(900), clickIds: { "bad key!": "x", ok: "y" } } });
  const got = await run<{ first?: { utmSource?: string; clickIds?: Record<string, string> } }>(w.ctx, "forms.attribution_get", { recordId: out.recordId });
  assert.equal(got.first?.utmSource?.length, 500);
  assert.deepEqual(got.first?.clickIds, { ok: "y" });
});

test("Source rules map clicks to channels and the first matching rule wins; defaults apply otherwise", async () => {
  const w = harness();
  const f = await openForm(w);
  assert.deepEqual(await run(w.ctx, "source_rules.list", {}), { rules: [] });
  await run(w.ctx, "source_rules.set", { rules: [
    { match: { utmSource: "podcast" }, channel: "Podcast" },
    { match: { referrer: "avvo.com" }, channel: "Directory" },
    { match: { utmMedium: "cpc", utmSource: "bing" }, channel: "Bing ads" },
  ] });
  const listed = await run<{ rules: { channel: string; order: number }[] }>(w.ctx, "source_rules.list", {});
  assert.deepEqual(listed.rules.map((r) => [r.order, r.channel]), [[0, "Podcast"], [1, "Directory"], [2, "Bing ads"]]);
  const channels: string[] = [];
  const cases: Record<string, unknown>[] = [
    { consent: true, utmSource: "podcast", utmMedium: "cpc" },
    { consent: true, referrer: "https://www.avvo.com/x" },
    { consent: true, utmSource: "bing", utmMedium: "cpc" },
    { consent: true, clickIds: { gclid: "1" } },
    { consent: true, referrer: "https://www.facebook.com/" },
    { consent: true, referrer: "https://blog.example/post" },
    { consent: true },
  ];
  for (const [n, a] of cases.entries()) {
    const out = await submit(f, { answers: { email: `s${n}@x.example` }, attribution: a });
    channels.push(String(w.db.rows("forms_attribution").find((r) => r.record_id === out.recordId)?.first_channel));
  }
  assert.deepEqual(channels, ["Podcast", "Directory", "Bing ads", "paid", "social", "referral", "direct"]);
  assert.equal(await code(run(w.ctx, "source_rules.set", { rules: [{ match: {}, channel: "x" }] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "source_rules.set", { rules: [{ match: { utmSource: "x" }, channel: "" }] })), "validation.bad_input");
  await run(w.ctx, "source_rules.set", { rules: [] });
  assert.deepEqual(await run(w.ctx, "source_rules.list", {}), { rules: [] });
});

// ---- surveys -------------------------------------------------------------------------------------------------

test("survey results aggregate numbers and choices; only a survey has them", async () => {
  const w = harness();
  const f = await openForm(w, { kind: "survey", name: "Pulse", fields: [{ field: "rating", mode: "ask" }, { field: "topics", mode: "ask" }, { field: "email", mode: "ask" }] });
  const rows = [
    { rating: 5, topics: ["wills", "trusts"], email: "a@x.example" },
    { rating: 3, topics: ["wills"], email: "b@x.example" },
    { rating: 4, topics: [], email: "c@x.example" },
  ];
  for (const answers of rows) await submit(f, { answers });
  const res = await run<{ responses: number; questions: { field: string; summary: Record<string, unknown> }[] }>(w.ctx, "forms.survey_results", { formId: f.formId });
  assert.equal(res.responses, 3);
  const rating = res.questions.find((q) => q.field === "rating")?.summary;
  assert.deepEqual(rating, { kind: "number", answered: 3, average: 4, min: 3, max: 5, distribution: { "3": 1, "4": 1, "5": 1 } });
  const topics = res.questions.find((q) => q.field === "topics")?.summary;
  assert.deepEqual(topics, { kind: "choice", answered: 2, counts: [{ value: "wills", count: 2 }, { value: "trusts", count: 1 }] });
  const plain = await openForm(w, { name: "Plain" });
  assert.equal(await code(run(w.ctx, "forms.survey_results", { formId: plain.formId })), "validation.precondition_failed");
  assert.equal(w.db.rows("forms_submission").filter((s) => s.form_id === plain.formId).length, 0);
});

test("a normal form keeps no copy of the answers outside the record", async () => {
  const w = harness();
  const f = await openForm(w);
  await submit(f, { answers: { email: "a@x.example", name: "A" } });
  assert.equal(w.db.rows("forms_submission")[0]?.answers, null);
});

// ---- definitions ---------------------------------------------------------------------------------------------

test("definitions: create, fields, update, design, publish, list, unpublish", async () => {
  const w = harness();
  const made = await run<{ form: { formId: string; slug: string; state: string; submissions: number } }>(w.ctx, "forms.create", { name: "Estate Intake", recordType: "contact", kind: "public" });
  assert.equal(made.form.slug, "estate-intake");
  assert.equal(made.form.state, "draft");
  const id = made.form.formId;
  assert.equal(await code(run(w.ctx, "forms.publish", { formId: id })), "validation.precondition_failed");
  await run(w.ctx, "forms.fields_set", { formId: id, fields: [{ field: "email", mode: "ask", prefillKey: "e", step: 0 }, { field: "name", mode: "ask", step: 1 }] });
  const pub = await run<{ url: string; embed: string }>(w.ctx, "forms.publish", { formId: id });
  assert.equal(pub.url, "https://harbor.example/f/estate-intake");
  assert.match(pub.embed, /^<iframe src="https:\/\/harbor\.example\/f\/estate-intake" title="Estate Intake"/);
  assert.equal(w.events.filter((e) => e.name === "form.published").length, 1);
  await run(w.ctx, "forms.publish", { formId: id });
  assert.equal(w.events.filter((e) => e.name === "form.published").length, 1, "publishing twice announces once");
  const upd = await run<{ form: { name: string } }>(w.ctx, "forms.update", { formId: id, name: "Estate Intake 2", captcha: true, rateLimit: 5, consentText: "I agree.", matchRule: ["email", "phone"] });
  assert.equal(upd.form.name, "Estate Intake 2");
  const row = w.db.rows("forms_form")[0];
  assert.equal(row?.captcha, 1);
  assert.equal(row?.rate_limit, 5);
  assert.equal(row?.match_rule, JSON.stringify(["email", "phone"]));
  await run(w.ctx, "forms.design_set", { formId: id, theme: { font: "Inter" }, css: ".x { color: red }", logic: { show: [] } });
  const got = await run<{ fields: { field: string; mode: string; prefillKey?: string }[]; theme?: unknown; logic?: unknown }>(w.ctx, "forms.get", { formId: id });
  assert.deepEqual(got.fields, [{ field: "email", mode: "ask", prefillKey: "e", step: 0 }, { field: "name", mode: "ask", step: 1 }]);
  assert.deepEqual(got.theme, { font: "Inter" });
  assert.deepEqual(got.logic, { show: [] });
  const listed = await run<{ forms: { formId: string }[]; total: number }>(w.ctx, "forms.list", {});
  assert.deepEqual(listed.forms.map((x) => x.formId), [id]);
  assert.equal((await run<{ total: number }>(w.ctx, "forms.list", { section: "personal" })).total, 0);
  await run(w.ctx, "forms.unpublish", { formId: id });
  assert.equal((await run<{ form: { state: string } }>(w.ctx, "forms.get", { formId: id })).form.state, "closed");
});

test("definitions: bad input is refused with the field named", async () => {
  const w = harness();
  assert.equal(await code(run(w.ctx, "forms.create", { name: "", recordType: "contact", kind: "public" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.create", { name: "x", recordType: "Bad Type", kind: "public" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.create", { name: "x", recordType: "contact", kind: "weird" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.create", { name: "x", recordType: "contact", kind: "booking" })), "validation.precondition_failed");
  const f = await openForm(w);
  const set = (fields: unknown) => run(w.ctx, "forms.fields_set", { formId: f.formId, fields });
  assert.equal(await code(set([{ field: "a", mode: "ask" }, { field: "a", mode: "hide" }])), "validation.bad_input");
  assert.equal(await code(set([{ field: "a", mode: "maybe" }])), "validation.bad_input");
  assert.equal(await code(set([{ field: "a", mode: "ask", prefillKey: "Bad Key" }])), "validation.bad_input");
  assert.equal(await code(set([{ field: "a", mode: "ask", prefillKey: "k" }, { field: "b", mode: "ask", prefillKey: "k" }])), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.update", { formId: f.formId, rateLimit: 0 })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.update", { formId: f.formId, matchRule: [] })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.design_set", { formId: f.formId, css: "@import url(//evil.example/x.css);" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.design_set", { formId: f.formId, css: "</style><script>alert(1)</script>" })), "validation.bad_input");
  assert.equal(await code(run(w.ctx, "forms.get", { formId: "frm_missing" })), "validation.not_found");
});

test("definitions: addresses are unique and the embed escapes the name", async () => {
  const w = harness();
  const a = await run<{ form: { slug: string } }>(w.ctx, "forms.create", { name: "Intake", recordType: "contact", kind: "public" });
  const b = await run<{ form: { slug: string; formId: string } }>(w.ctx, "forms.create", { name: "Intake", recordType: "contact", kind: "public" });
  assert.equal(a.form.slug, "intake");
  assert.match(b.form.slug, /^intake-[a-z0-9]{3,}$/);
  await run(w.ctx, "forms.update", { formId: b.form.formId, name: 'A "quoted" <b>name</b>' });
  await run(w.ctx, "forms.fields_set", { formId: b.form.formId, fields: [{ field: "email", mode: "ask" }] });
  const pub = await run<{ embed: string }>(w.ctx, "forms.publish", { formId: b.form.formId });
  assert.ok(pub.embed.includes('title="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt;"'));
});

test("the module is not configured: forms still define and submit without a captcha verifier", async () => {
  const w = harness({ configure: false });
  const f = await openForm(w);
  const out = await submit(f, { answers: { email: "a@x.example" } });
  assert.ok(w.records.has(out.recordId));
  const pub = await run<{ url: string }>(w.ctx, "forms.publish", { formId: f.formId });
  assert.equal(pub.url, "/f/intake");
  configureForms(null);
});
