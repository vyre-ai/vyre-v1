// The public form renderer (spec 2.11; ARCH 7.6): multi-step, conditional logic, thank-you and the page the host serves, all drawn from a form definition. Strings in, strings out:
// nothing here needs a browser. Every value a person or the form author wrote is checked to come out escaped.

import test from "node:test";
import assert from "node:assert/strict";
import { parseDefinition } from "../src/definition.js";
import { esc, renderDocument, renderForm, safeJson, contentSecurityPolicy } from "../src/html.js";
import { fieldsOfStep, nextStep, prevStep, stepList } from "../src/steps.js";
import { define, RAW } from "./fixtures.ts";

const fresh = (answers: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  status: "editing" as const, step: 0, history: [] as number[], answers, errors: {} as Record<string, string>, consent: false, ...over,
});
const names = (def: ReturnType<typeof define>, answers: Record<string, unknown>, step: number) => fieldsOfStep(def, answers, step).map((f) => f.field);

// ---- the definition ------------------------------------------------------------------------------------------------

test("a definition is checked and normalised: defaults filled, every problem named by its path", () => {
  const ok = define();
  assert.equal(ok.submitLabel, "Send");
  assert.equal(ok.fields.find((f) => f.field === "name")!.mode, "ask");
  assert.equal(ok.fields.find((f) => f.field === "budget")!.step, 2);
  assert.deepEqual(ok.uploadPolicy, { maxBytes: 10 * 1024 * 1024, types: [], max: 5 });

  const bad = parseDefinition({
    slug: "Bad Slug", name: "", kind: "booking",
    fields: [{ field: "Name", label: "x" }, { field: "a", mode: "maybe", label: "A" }, { field: "b", type: "hologram", label: "B" }, { field: "c", label: "C", step: -1 }, { field: "d", type: "choice", label: "D" }, { field: "e", label: "E" }, { field: "e", label: "E again" }],
    logic: { rules: [{ if: { field: "nope", op: "eq", value: 1 }, then: [{ show: ["e"] }] }, { if: { field: "e", op: "xor" }, then: [{ show: ["e"] }] }, { if: { field: "e", op: "eq" }, then: [{ show: ["ghost"] }] }] },
    theme: { skin: "neon", accent: "red", radius: 99, font: "comic", cover: "http://insecure.example/a.png" },
    thankYou: { redirect: "javascript:alert(1)" },
  });
  assert.equal(bad.def, null);
  const text = bad.problems.join("\n");
  for (const want of [
    "slug: lowercase letters, digits and dashes", "name: a name of 1 to 200 characters", "kind: public, one_use or survey", "fields[0].field: lowercase letters", "fields[1].mode: ask, show or hide",
    "fields[2].type: one of", "fields[3].step: a whole number from 0 to 100", "fields[4].options: 1 to 200 options", "fields[6].field: e is used twice",
    "logic.rules[0].if.field: names a field of this form", "logic.rules[1].if.op: eq, ne", "logic.rules[2].then[0].show: names fields of this form",
    "theme.skin: paper or dusk", "theme.accent: a colour such as #5b5bd6", "theme.radius: a number from 0 to 32", "theme.font: system, serif, mono, rounded", "theme.cover: an https address or a path on this site",
    "thankYou.redirect: a path on this site or a full https address",
  ]) assert.ok(text.includes(want), `names: ${want}\n${text}`);
  assert.deepEqual(parseDefinition(null).problems, ["a form definition is an object"]);
  assert.ok(parseDefinition({ ...RAW, fields: [] }).problems[0]!.startsWith("fields:"));
});

// ---- steps and logic ---------------------------------------------------------------------------------------------------

test("steps: fields group by step, hidden fields and logic-gated fields are not in a step, and a step with no visible field is not a step", () => {
  const def = define();
  assert.deepEqual(stepList(def, {}), [0, 1, 2]);
  assert.deepEqual(names(def, {}, 0), ["name", "email", "area", "notice"], "the hidden field is never drawn");
  assert.deepEqual(names(def, {}, 1), ["details", "has_deadline"], "the deadline waits for its rule");
  assert.deepEqual(names(def, { has_deadline: true }, 1), ["details", "has_deadline", "deadline"]);
  assert.deepEqual(names(def, { has_deadline: false }, 1), ["details", "has_deadline"]);
  assert.deepEqual(names(def, { area: "estate" }, 2), ["referral"], "budget is hidden by the estate rule");
  const lonely = define({ fields: [{ field: "a", label: "A", step: 0 }, { field: "b", label: "B", step: 3, mode: "hide" }, { field: "c", label: "C", step: 5 }], logic: undefined });
  assert.deepEqual(stepList(lonely, {}), [0, 5]);
});

test("steps: Next goes to the following step, a matching skip jumps forward, Back returns to where the person was, and the last step has no Next", () => {
  const def = define();
  assert.equal(nextStep(def, {}, 0), 1);
  assert.equal(nextStep(def, {}, 1), 2);
  assert.equal(nextStep(def, {}, 2), null);
  assert.equal(nextStep(def, { area: "other" }, 0), 2, "something else skips the details step");
  assert.equal(nextStep(def, { area: "family" }, 0), 1);
  assert.equal(prevStep(def, {}, 2), 1);
  assert.equal(prevStep(def, { area: "other" }, 2, [0]), 0, "back follows the path taken, not step order");
  assert.equal(prevStep(def, {}, 0), null);
  assert.equal(nextStep(def, { area: "other" }, 2), null, "a skip only jumps forward");
});

// ---- drawing a step ---------------------------------------------------------------------------------------------------

test("render: the first step shows the title, the intro, the progress, its fields with labels and controls, a read-only notice, and Next", () => {
  const def = define();
  const html = renderForm(def, fresh());
  assert.match(html, /<h1 class="vf-title" id="vf-title">Client intake<\/h1>/);
  assert.match(html, /<p class="vf-intro">Tell us about your matter\.<\/p>/);
  assert.match(html, /<ol class="vf-progress" aria-label="Progress">(<li[^>]*>.*?<\/li>){3}<\/ol>/);
  assert.match(html, /<li data-state="now" aria-current="step">/);
  assert.match(html, /Step 1 of 3/);
  assert.match(html, /<label class="vf-label" id="vf-name-label" for="vf-name">Your name<\/label>/);
  assert.match(html, /<input class="vf-input" type="text" autocomplete="off" id="vf-name" name="name" required/);
  assert.match(html, /<input class="vf-input" type="email" autocomplete="email" inputmode="email" id="vf-email" name="email" required/);
  assert.match(html, /<label class="vf-label" id="vf-area-label" for="vf-area">|<span class="vf-label" id="vf-area-label">Practice area/);
  assert.equal((html.match(/type="radio" name="area"/g) ?? []).length, 3, "three options are radios");
  assert.match(html, /role="radiogroup" aria-labelledby="vf-area-label"/);
  assert.match(html, /<div class="vf-show">We reply within one business day\.<\/div>/);
  assert.ok(!html.includes("source_secret") && !html.includes("Source"), "a hidden field is not in the page at all");
  assert.ok(!html.includes("What happened"), "the next step is not drawn yet");
  assert.match(html, /<button class="vf-btn" type="submit" data-primary data-action="next">Next<\/button>/);
  assert.ok(!html.includes('data-action="back"'), "no Back on the first step");
  assert.ok(!html.includes("vf-consent"), "consent comes with the last step");
  assert.match(html, /<form class="vf-form" novalidate aria-labelledby="vf-title" data-step="0">/);
});

test("render: optional fields say so, required ones do not, and logic can make an optional field required", () => {
  const def = define();
  const first = renderForm(def, fresh());
  assert.ok(!/id="vf-name-label"[^>]*>Your name <span/.test(first), "required: no optional tag");
  assert.match(first, /Practice area <span class="vf-req">\(optional\)<\/span>/);
  const last = renderForm(def, fresh({ area: "family" }, { step: 2, history: [0, 1] }));
  assert.match(last, /Who referred you\? <span class="vf-req">\(optional\)<\/span>/);
  const estate = renderForm(def, fresh({ area: "estate" }, { step: 2, history: [0, 1] }), new Set(["name", "email", "details", "referral"]));
  assert.ok(!/Who referred you\? <span class="vf-req">/.test(estate), "the estate rule requires it");
  assert.match(estate, /id="vf-referral"[^>]*required/);
});

test("render: the second step shows help text and appears with a deadline only after its checkbox is ticked", () => {
  const def = define();
  const a = renderForm(def, fresh({}, { step: 1, history: [0] }));
  assert.match(a, /<textarea class="vf-textarea" id="vf-details" name="details" required[^>]*aria-describedby="vf-details-help"[^>]*rows="5"><\/textarea>/);
  assert.match(a, /<p class="vf-help" id="vf-details-help">A few sentences is plenty\.<\/p>/);
  assert.match(a, /<input type="checkbox" id="vf-has_deadline" name="has_deadline" value="true"><span>There is a deadline<\/span>/);
  assert.ok(!a.includes('id="vf-deadline"'));
  assert.match(a, /<button class="vf-btn" type="button" data-action="back">Back<\/button>/);
  const b = renderForm(def, fresh({ has_deadline: true }, { step: 1, history: [0] }));
  assert.match(b, /<input class="vf-input" type="date" id="vf-deadline" name="deadline" required/);
  assert.match(b, /name="has_deadline" value="true" checked/);
});

test("render: the last step shows the consent statement, the submit button and Back; errors show under their fields and in a banner", () => {
  const def = define();
  const html = renderForm(def, fresh({ area: "family", budget: "1200.5" }, { step: 2, history: [0, 1], errors: { budget: "Use 0 or more.", consent: "Please accept the statement to continue." }, banner: "Check the highlighted answers." }));
  assert.match(html, /<div class="vf-banner" role="alert">Check the highlighted answers\.<\/div>/);
  assert.match(html, /<input class="vf-input" type="number" inputmode="decimal" step="0.01" min="0" id="vf-budget" name="budget" aria-invalid="true" aria-describedby="vf-budget-err" value="1200.5">/);
  assert.match(html, /<p class="vf-error" id="vf-budget-err" role="alert">Use 0 or more\.<\/p>/);
  assert.match(html, /<div class="vf-consent vf-has-error"><label class="vf-opt"><input type="checkbox" id="vf-consent" name="consent" value="true" aria-invalid="true"/);
  assert.match(html, /I agree that you may contact me about this matter\./);
  assert.match(html, /<button class="vf-btn" type="submit" data-primary data-action="submit">Send<\/button>/);
  assert.match(html, /data-action="back"/);
  assert.match(html, /Step 3 of 3/);
  const sending = renderForm(def, fresh({ area: "family" }, { step: 2, history: [0, 1], status: "sending" }));
  assert.match(sending, /data-action="submit" disabled>Sending<\/button>/);
  assert.match(sending, /data-action="back" disabled/);
});

test("render: a one-step form has no progress; a captcha shows only on the last step and only when the form asks for it", () => {
  const one = define({ fields: [{ field: "q", label: "Question", type: "text", required: true }], logic: undefined, captcha: { siteKey: "site-key-123" }, consentText: undefined });
  const html = renderForm(one, fresh());
  assert.ok(!html.includes("vf-progress") && !html.includes("Step 1 of"));
  assert.match(html, /<div class="vf-captcha" id="vf-captcha" data-sitekey="site-key-123">/);
  assert.match(html, /data-action="submit"/);
  assert.ok(!renderForm(define(), fresh()).includes("vf-captcha"));
});

// ---- thank-you --------------------------------------------------------------------------------------------------------

test("thank-you: the form is replaced by the thank-you with its text; a redirect shows a link as well; the intro is gone", () => {
  const def = define();
  const html = renderForm(def, fresh({}, { status: "done", thanks: { text: "We will be in touch within one business day." } }));
  assert.match(html, /<div class="vf-thanks" role="status" tabindex="-1" id="vf-thanks"><h2>Thank you<\/h2><p>We will be in touch within one business day\.<\/p><\/div>/);
  assert.ok(!html.includes("<form") && !html.includes("Tell us about your matter"));
  const redirect = renderForm(def, fresh({}, { status: "done", thanks: { redirect: "https://example.com/welcome?x=1&y=2" } }));
  assert.match(redirect, /<p>Your answers were sent\.<\/p><p><a href="https:\/\/example\.com\/welcome\?x=1&amp;y=2">Continue<\/a><\/p>/);
  assert.match(renderForm(def, fresh({}, { status: "done" })), /<p>Your answers were sent\.<\/p>/);
});

// ---- the other field types ---------------------------------------------------------------------------------------------

test("render: every field type draws the right control with the right attributes", () => {
  const def = define({
    consentText: undefined, logic: undefined,
    fields: [
      { field: "p", label: "Phone", type: "phone" }, { field: "u", label: "Site", type: "url" }, { field: "n", label: "Count", type: "number", min: 1, max: 9 }, { field: "dt", label: "When", type: "datetime" },
      { field: "pick", label: "Many", type: "choice", options: Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })) },
      { field: "multi", label: "Several", type: "multichoice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      { field: "stars", label: "How was it?", type: "rating" }, { field: "tax", label: "Tax ID", type: "sealed" }, { field: "docs", label: "Documents", type: "files" },
    ],
  });
  const html = renderForm(def, fresh({ pick: "v3", multi: ["b"], stars: 4 }));
  assert.match(html, /type="tel" autocomplete="tel" inputmode="tel" id="vf-p"/);
  assert.match(html, /type="url" inputmode="url" id="vf-u"/);
  assert.match(html, /type="number" inputmode="decimal" step="any" min="1" max="9" id="vf-n"/);
  assert.match(html, /type="datetime-local" id="vf-dt"/);
  assert.match(html, /<select class="vf-select" id="vf-pick" name="pick">/);
  assert.match(html, /<option value="v3" selected>Option 3<\/option>/);
  assert.match(html, /<input type="checkbox" name="multi" id="vf-multi-1" value="b" checked>/);
  assert.match(html, /<input type="checkbox" name="multi" id="vf-multi-0" value="a">/);
  assert.equal((html.match(/type="radio" name="stars"/g) ?? []).length, 5);
  assert.match(html, /<input type="radio" name="stars" id="vf-stars-4" value="4" checked>/);
  assert.match(html, /type="password" autocomplete="off" spellcheck="false" id="vf-tax"/);
  assert.match(html, /type="file" multiple id="vf-docs"/);
});

// ---- escaping -----------------------------------------------------------------------------------------------------------

test("escaping: titles, labels, options, help, values, errors and thank-you text from a person or an author never become markup", () => {
  const evil = `<img src=x onerror=alert(1)> "quoted" 'single' & more`;
  const def = define({
    name: evil, intro: evil, consentText: evil, logic: undefined,
    fields: [{ field: "q", label: evil, type: "choice", help: evil, options: [{ value: evil, label: evil }, { value: "ok", label: "OK" }] }, { field: "t", label: "T", type: "text", placeholder: evil }],
  });
  const html = renderForm(def, fresh({ q: evil, t: evil }, { errors: { q: evil, t: evil }, banner: evil }));
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes('onerror=alert(1)>') && !html.includes('"quoted"'), "quotes and angle brackets are encoded");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &quot;quoted&quot; &#39;single&#39; &amp; more/);
  const done = renderForm(def, fresh({}, { status: "done", thanks: { text: evil, redirect: `https://example.com/"onmouseover="x` } }));
  assert.ok(!done.includes("<img") && !done.includes('"onmouseover="'), done);
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(esc(undefined), "");
  assert.equal(esc(5), "5");
});

// ---- the page ----------------------------------------------------------------------------------------------------------

test("the page: a full document with the first draw in it, the styles by nonce, the definition as safe JSON, the module script, and no indexing", () => {
  const def = define({ name: `Intake </script><script>alert(1)</script>`, theme: { skin: "dusk", accent: "#b49cff" } });
  const html = renderDocument(def, { scriptUrl: "/f/_embed/main.js", nonce: "abc123" });
  assert.ok(html.startsWith("<!doctype html><html lang=\"en\" data-skin=\"dusk\">"));
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<title>Intake &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
  assert.match(html, /<style nonce="abc123">:root\{--win:#17151c;/);
  assert.match(html, /<div id="vyre-form-root"><div class="vf-wrap" data-status="editing">/);
  assert.match(html, /<script type="module" src="\/f\/_embed\/main\.js" nonce="abc123"><\/script>/);
  const json = /<script type="application\/json" id="vyre-form">(.*?)<\/script>/s.exec(html)![1]!;
  assert.ok(!json.includes("<") && !json.includes(">"), "no angle bracket can end the script element");
  assert.equal(JSON.parse(json).name, `Intake </script><script>alert(1)</script>`, "and the JSON still reads back exactly");
  assert.equal(safeJson({ a: " <&>" }), '{"a":"\\u2028\\u003c\\u0026\\u003e"}');
  assert.match(renderDocument(define(), { scriptUrl: "/x.js", nonce: "n" }), /data-skin="paper"/);
});

test("the policy: scripts and styles only by nonce, answers only back to the same site, framing allowed, captcha hosts only when given and only https", () => {
  const csp = contentSecurityPolicy({ nonce: "abc123" });
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' 'nonce-abc123'(;|$)/);
  assert.match(csp, /style-src 'nonce-abc123'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors \*/);
  assert.match(csp, /frame-src 'none'/);
  const withCaptcha = contentSecurityPolicy({ nonce: "n", captchaHosts: ["https://challenges.cloudflare.com", "http://evil.example", "https://x.example; script-src *"] });
  assert.match(withCaptcha, /script-src 'self' 'nonce-n' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(withCaptcha, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.ok(!withCaptcha.includes("evil") && !withCaptcha.includes("script-src *"));
});
