// The form's behaviour (spec 2.11): steps with validation, logic that follows the answers, prefill and hide by URL key, the partial save behind a link, what is sent on submit, the
// thank-you or redirect, and every way a submit can fail. The server is a script that records what it was sent.

import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../src/controller.js";
import { define } from "./fixtures.ts";

type Sent = { url: string; method: string; headers: Record<string, string>; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = (data: unknown = { recordId: "rec_1" }) => ({ status: 200, json: { data } });
const refuse = (status: number, code: string, message = "No.", details?: Record<string, unknown>) => ({ status, json: { error: { code, message, ...(details ? { details } : {}) } } });

function rig(over: Record<string, unknown> = {}, reply: (path: string, body: any) => { status: number; json: unknown } | Error = () => ok(), opts: Record<string, unknown> = {}) {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const sent: Sent[] = [];
  const assigned: string[] = [];
  const c = createController({
    def: define(over),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ url, method: init.method, headers: init.headers, body });
      const r = reply(new URL(url, "https://x.example").pathname, body);
      if (r instanceof Error) throw r;
      return { status: r.status, json: async () => r.json };
    },
    assign: (u) => { assigned.push(u); },
    href: "https://example.com/f/intake?utm_source=google&utm_medium=cpc&gclid=abc",
    search: "?utm_source=google&utm_medium=cpc&gclid=abc",
    referrer: "https://news.example/story?id=1#top",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120",
    timeZone: "America/Los_Angeles",
    ...opts,
  });
  return { c, sent, assigned };
}

/** Fills the fixture form far enough to reach its last step. */
async function toLastStep(c: ReturnType<typeof createController>, area = "family") {
  c.set("name", "Dana Whitfield");
  c.set("email", "dana@example.com");
  c.set("area", area);
  assert.equal(await c.next(), true);
  if (area !== "other") {
    c.set("details", "A short account.");
    assert.equal(await c.next(), true);
  }
}

// ---- steps ---------------------------------------------------------------------------------------------------------

test("next: an invalid step stays put, names each problem under its field, puts focus on the first, and a valid step moves on and clears the problems", async () => {
  const { c, sent } = rig();
  assert.equal(await c.next(), false);
  assert.deepEqual(c.state.errors, { name: "This is required.", email: "This is required." });
  assert.equal(c.state.step, 0);
  assert.equal(c.state.banner, "Check the highlighted answers.");
  assert.equal(c.focus, "error:name");
  const html = c.html();
  assert.match(html, /<p class="vf-error" id="vf-name-err" role="alert">This is required\.<\/p>/);
  assert.match(html, /id="vf-name" name="name" required aria-invalid="true"/);

  c.set("name", "Dana");
  assert.deepEqual(Object.keys(c.state.errors), ["email"], "an answer clears its own problem");
  c.set("email", "not-an-email");
  assert.equal(await c.next(), false);
  assert.equal(c.state.errors.email, "That does not look like an email address.");
  c.set("email", "dana@example.com");
  assert.equal(await c.next(), true);
  assert.deepEqual([c.state.step, c.state.history, c.state.errors, c.state.banner, c.focus], [1, [0], {}, undefined, "step"]);
  assert.equal(sent.length, 0, "no link, so nothing is saved on the way");
});

test("back returns to the step the person came from, keeping every answer; there is no back from the first step", async () => {
  const { c } = rig();
  assert.equal(c.back(), false);
  await toLastStep(c);
  assert.equal(c.state.step, 2);
  assert.equal(c.back(), true);
  assert.equal(c.state.step, 1);
  assert.equal(c.state.answers.details, "A short account.");
  assert.equal(c.back(), true);
  assert.deepEqual([c.state.step, c.state.history], [0, []]);
  assert.equal(c.state.answers.name, "Dana Whitfield");
});

test("logic: something else skips the details step and Back returns to the first; a deadline appears when ticked and then must be a date; estate requires a referral and hides the budget", async () => {
  const skip = rig();
  await toLastStep(skip.c, "other");
  assert.deepEqual([skip.c.state.step, skip.c.state.history], [2, [0]]);
  assert.equal(skip.c.back(), true);
  assert.equal(skip.c.state.step, 0);

  const { c } = rig();
  c.set("name", "D"); c.set("email", "d@example.com");
  await c.next();
  c.set("details", "x");
  c.set("has_deadline", true);
  assert.match(c.html(), /id="vf-deadline"/);
  assert.equal(await c.next(), false);
  assert.equal(c.state.errors.deadline, "This is required.");
  c.set("deadline", "2026-02-30");
  assert.equal(await c.next(), false);
  assert.equal(c.state.errors.deadline, "Enter a date.");
  c.set("deadline", "2026-03-01");
  assert.equal(await c.next(), true);

  const estate = rig();
  await toLastStep(estate.c, "estate");
  assert.doesNotMatch(estate.c.html(), /id="vf-budget"/);
  assert.match(estate.c.html(), /id="vf-referral" name="referral" required/);
  assert.equal(await estate.c.submit(), false);
  assert.equal(estate.c.state.errors.referral, "This is required.");
});

test("a link keeps the answers: each Next posts the answers so far and the step to /f/partial with the token, and a failed save never blocks the form", async () => {
  const { c, sent } = rig({ token: "tok_123" }, (path) => (path === "/f/partial" ? refuse(500, "internal.unexpected") : ok()));
  c.set("name", "Dana"); c.set("email", "dana@example.com");
  assert.equal(await c.next(), true);
  assert.deepEqual(sent.map((s) => [new URL(s.url, "https://x.example").pathname, s.method, s.headers["content-type"], s.body]), [
    ["/f/partial", "POST", "application/json", { slug: "intake", token: "tok_123", answers: { name: "Dana", email: "dana@example.com", has_deadline: false }, step: 1 }],
  ]);
  assert.equal(c.state.step, 1);
});

test("a form reopened from a partial save starts on the step it stopped at, with its answers and the way back", () => {
  const { c } = rig({ token: "tok_123", partial: { answers: { name: "Dana", email: "dana@example.com", details: "Half done" }, step: 1 } });
  assert.deepEqual([c.state.step, c.state.history, c.state.answers.details], [1, [0], "Half done"]);
  const gone = rig({ partial: { answers: {}, step: 7 } });
  assert.equal(gone.c.state.step, 2, "a step that no longer exists falls to the next one after it, else the last");
});

// ---- the URL -----------------------------------------------------------------------------------------------------------

test("URL keys: a valid ?key=value fills its field, an invalid or unknown one is ignored, and ?hide= takes prefilled fields off the page while their values are still sent", async () => {
  const { c, sent } = rig({}, () => ok(), { search: "?e=Dana@Example.com&area=estate&hide=e,area,name&name=&budget=abc&bogus=1&notice=changed" });
  assert.deepEqual(c.state.answers, { email: "Dana@Example.com", area: "estate" }, "name is empty, budget is not a number, bogus is not a field, notice is read-only");
  assert.deepEqual([...c.hidden].sort(), ["area", "email"], "only fields that were filled can be hidden");
  const html = c.html();
  assert.ok(!html.includes('id="vf-email"') && !html.includes('name="area"'), "the page does not ask for what the link already knows");
  assert.match(html, /id="vf-name"/);
  c.set("name", "Dana");
  assert.equal(await c.next(), true, "hidden fields are not checked on the page");
  c.set("details", "x");
  await c.next();
  c.set("referral", "A friend");
  c.setConsent(true);
  assert.equal(await c.submit(), true);
  assert.deepEqual(sent[0]!.body.answers, { name: "Dana", email: "Dana@Example.com", area: "estate", details: "x", has_deadline: false, referral: "A friend", consent: true });
});

// ---- submitting ---------------------------------------------------------------------------------------------------------

test("submit: the consent statement and the captcha are required before anything is sent, and the form goes to the first step with a problem", async () => {
  const { c, sent } = rig({ captcha: { siteKey: "sk" } });
  await toLastStep(c);
  assert.equal(await c.submit(), false);
  assert.deepEqual(c.state.errors, { consent: "Please accept the statement to continue.", captcha: "Complete the check to continue." });
  assert.equal(sent.length, 0);
  assert.equal(c.focus, "error:consent");
  c.setConsent(true);
  assert.equal(await c.submit(), false);
  assert.deepEqual(Object.keys(c.state.errors), ["captcha"]);
  c.setCaptcha("captcha-token");
  assert.equal(await c.submit(), true);
  assert.equal(sent[0]!.body.captcha, "captcha-token");

  const early = rig();
  early.c.set("name", "D"); early.c.set("email", "d@example.com");
  await early.c.next();
  early.c.set("details", "x");
  await early.c.next();
  early.c.set("name", "");
  early.c.setConsent(true);
  assert.equal(await early.c.submit(), false);
  assert.deepEqual([early.c.state.step, early.c.state.history, early.c.focus], [0, [], "error:name"], "back to the step with the problem");
});

test("submit: sends the slug, only the visible asked answers, the consent flag, the link token and the attribution, to /f/submit as JSON", async () => {
  const { c, sent } = rig({ token: "tok_9" });
  await toLastStep(c);
  c.set("budget", "1200.50");
  c.set("referral", "  A friend ");
  c.setConsent(true);
  assert.equal(await c.submit(), true);
  const submit = sent.find((s) => s.url.endsWith("/f/submit"))!;
  assert.equal(submit.method, "POST");
  assert.equal(submit.headers["content-type"], "application/json");
  assert.deepEqual(submit.body, {
    slug: "intake", token: "tok_9",
    answers: { name: "Dana Whitfield", email: "dana@example.com", area: "family", details: "A short account.", has_deadline: false, budget: 1200.5, referral: "A friend", consent: true },
    attribution: {
      consent: true, utmSource: "google", utmMedium: "cpc", referrer: "https://news.example/story", landingPage: "https://example.com/f/intake",
      clickIds: { gclid: "abc" }, device: "desktop", location: "America/Los_Angeles",
    },
  });
  assert.ok(!("source_secret" in submit.body.answers) && !("notice" in submit.body.answers) && !("deadline" in submit.body.answers), "hidden, read-only and logic-hidden fields are never sent");
});

test("submit: without a consent statement no consent is claimed, and attribution carries only the UTMs and the referring host", async () => {
  const { c, sent } = rig({ consentText: undefined });
  await toLastStep(c);
  assert.equal(await c.submit(), true);
  assert.ok(!("consent" in sent[0]!.body.answers));
  assert.deepEqual(sent[0]!.body.attribution, { consent: false, utmSource: "google", utmMedium: "cpc", referrer: "news.example" });
});

test("submit: a double press sends once; while sending nothing else moves", async () => {
  let release: (v: { status: number; json: unknown }) => void = () => {};
  const gate = new Promise<{ status: number; json: unknown }>((r) => { release = r; });
  const sent: unknown[] = [];
  const c = createController({
    def: define({ consentText: undefined }),
    fetch: async (url, init) => { sent.push(JSON.parse(init.body)); const r = await gate; return { status: r.status, json: async () => r.json }; },
  });
  await toLastStep(c);
  const first = c.submit();
  assert.equal(c.state.status, "sending");
  assert.equal(await c.submit(), false);
  assert.equal(c.back(), false);
  assert.equal(await c.next(), false);
  release(ok());
  assert.equal(await first, true);
  assert.equal(sent.length, 1);
  assert.equal(c.state.status, "done");
  assert.equal(await c.submit(), false, "and not again once it is done");
});

// ---- the thank-you -----------------------------------------------------------------------------------------------------

test("thank-you: the server's text wins when the form has no redirect; the form's own text is the fallback; focus moves to it", async () => {
  const a = rig({ consentText: undefined }, () => ok({ recordId: "rec_1", thankYou: "Thanks from the server." }));
  await toLastStep(a.c);
  await a.c.submit();
  assert.deepEqual(a.c.state.thanks, { text: "Thanks from the server." });
  assert.equal(a.c.focus, "thanks");
  assert.match(a.c.html(), /<p>Thanks from the server\.<\/p>/);
  const b = rig({ consentText: undefined });
  await toLastStep(b.c);
  await b.c.submit();
  assert.deepEqual(b.c.state.thanks, { text: "We will be in touch within one business day." });
});

test("thank-you: a redirect is followed once, and the page shows the thank-you with a link in case the redirect does not happen", async () => {
  const { c, assigned } = rig({ consentText: undefined, thankYou: { redirect: "https://example.com/welcome", text: "Thank you." } }, () => ok({ recordId: "rec_1", thankYou: "https://example.com/welcome" }));
  await toLastStep(c);
  assert.equal(await c.submit(), true);
  assert.deepEqual(assigned, ["https://example.com/welcome"]);
  assert.deepEqual(c.state.thanks, { text: "Thank you.", redirect: "https://example.com/welcome" });
  assert.match(c.html(), /<a href="https:\/\/example\.com\/welcome">Continue<\/a>/);
});

// ---- failures ----------------------------------------------------------------------------------------------------------

test("a refusal about one answer shows under that field, on its step, and keeps every answer so the person can fix it and send again", async () => {
  let n = 0;
  const { c, sent } = rig({ consentText: undefined }, () => (++n === 1 ? refuse(400, "validation.bad_input", "That does not look like an email address.", { field: "answers.email" }) : ok()));
  await toLastStep(c);
  assert.equal(await c.submit(), false);
  assert.deepEqual(c.state.errors, { email: "That does not look like an email address." });
  assert.deepEqual([c.state.status, c.state.step, c.state.history, c.focus, c.state.banner], ["editing", 0, [], "error:email", "Check the highlighted answers."]);
  assert.equal(c.state.answers.details, "A short account.");
  c.set("email", "dana@example.org");
  assert.equal(await c.next(), true);
  assert.equal(await c.next(), true);
  assert.equal(await c.submit(), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.body.answers.email, "dana@example.org");
});

test("refusals that are not about one answer say what happened in plain words: too many tries, a link that no longer works, a duplicate, an odd server answer, a server that is not there", async () => {
  const cases: [Parameters<typeof rig>[1], string][] = [
    [() => refuse(429, "rate_limit.exceeded"), "Too many tries. Wait a minute and send it again."],
    [() => refuse(401, "auth.invalid_code"), "This link is not valid any more. Ask for a new one."],
    [() => refuse(413, "validation.too_large", "x"), "Those answers are too large to send."],
    [() => refuse(500, "internal.unexpected", "The server hit a problem."), "The server hit a problem."],
    [() => ({ status: 502, json: {} }), "Something went wrong. Try again."],
    [() => new Error("offline"), "We could not reach the server. Your answers are still here; send it again."],
  ];
  for (const [reply, banner] of cases) {
    const { c } = rig({ consentText: undefined }, reply);
    await toLastStep(c);
    assert.equal(await c.submit(), false);
    assert.deepEqual([c.state.status, c.state.banner, c.state.errors, c.state.answers.name], ["editing", banner, {}, "Dana Whitfield"], banner);
  }
  const dup = rig({ consentText: undefined }, () => refuse(409, "validation.duplicate"));
  await toLastStep(dup.c);
  assert.equal(await dup.c.submit(), true, "already sent counts as sent");
  assert.deepEqual(dup.c.state.thanks, { text: "This was already sent. Thank you." });
});

test("a failed captcha asks for a new one: the old token is dropped and the error shows under the widget", async () => {
  const { c } = rig({ consentText: undefined, captcha: { siteKey: "sk" } }, () => refuse(400, "auth.invalid_code", "The captcha check failed. Try again."));
  await toLastStep(c);
  c.setCaptcha("old");
  assert.equal(await c.submit(), false);
  assert.equal(c.state.captcha, undefined);
  assert.deepEqual(c.state.errors, { captcha: "The check did not pass. Try again." });
  assert.match(c.html(), /<div class="vf-captcha" id="vf-captcha" data-sitekey="sk"><p class="vf-error" role="alert">/);
});

// ---- uploads -----------------------------------------------------------------------------------------------------------

test("files: each is uploaded first and only its file id is sent; one file goes as { fileId }, several as a list of ids; without an uploader nothing is sent", async () => {
  const fields = [{ field: "docs", label: "Documents", type: "files" }];
  const none = rig({ fields, logic: undefined, consentText: undefined });
  none.c.set("docs", [{ name: "a.pdf", size: 1000, type: "application/pdf" }]);
  assert.equal(await none.c.submit(), false);
  assert.equal(none.c.state.banner, "File uploads are not available on this form yet.");
  assert.equal(none.sent.length, 0);

  const uploaded: string[] = [];
  const one = rig({ fields, logic: undefined, consentText: undefined }, () => ok(), { upload: async (f: { name: string }) => { uploaded.push(f.name); return `fil_${uploaded.length}`; } });
  one.c.set("docs", [{ name: "a.pdf", size: 1000, type: "application/pdf" }]);
  assert.equal(await one.c.submit(), true);
  assert.deepEqual(one.sent[0]!.body.answers, { docs: { fileId: "fil_1" } });

  const many = rig({ fields, logic: undefined, consentText: undefined }, () => ok(), { upload: async (f: { name: string }) => `fil_${f.name.replace(/\W/g, "")}` });
  many.c.set("docs", [{ name: "a.pdf", size: 1, type: "application/pdf" }, { name: "b.pdf", size: 1, type: "application/pdf" }]);
  assert.equal(await many.c.submit(), true);
  assert.deepEqual(many.sent[0]!.body.answers, { docs: ["fil_apdf", "fil_bpdf"] });

  const policy = rig({ fields, logic: undefined, consentText: undefined, uploadPolicy: { maxBytes: 100, types: ["application/pdf", "image/*", ".docx"], max: 2 } });
  policy.c.set("docs", [{ name: "big.pdf", size: 101, type: "application/pdf" }]);
  await policy.c.submit();
  assert.equal(policy.c.state.errors.docs, "Each file can be at most 1 KB.");
  policy.c.set("docs", [{ name: "x.exe", size: 5, type: "application/x-msdownload" }]);
  await policy.c.submit();
  assert.equal(policy.c.state.errors.docs, "That kind of file is not accepted.");
  policy.c.set("docs", [{ name: "a.png", size: 5, type: "image/png" }, { name: "b.docx", size: 5, type: "" }, { name: "c.pdf", size: 5, type: "application/pdf" }]);
  await policy.c.submit();
  assert.equal(policy.c.state.errors.docs, "Attach at most 2 files.");
});

test("only asked fields can be set: a read-only or hidden field, or one that is not on the form, ignores set()", () => {
  const { c } = rig();
  c.set("notice", "changed");
  c.set("source_secret", "x");
  c.set("not_a_field", "x");
  assert.deepEqual(c.state.answers, {});
});
