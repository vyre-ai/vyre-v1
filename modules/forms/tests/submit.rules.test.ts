// forms.submit rules and the public page (spec 2.11; ARCH 7.6): one case per rule (conditional logic hides and requires questions, upload size and type are refused, consent, captcha),
// a rendered-page snapshot, and the GET /f/<slug> and /book/<slug> routes over a real socket as a signed-out caller (rulings 64 and 67).
// @reads /modules/forms/migrations/0001_forms.sql

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { createFormsPageRoute, renderFormPage } from "../../../host/src/routes/forms-page.ts";
import type { PageCaller, PublicFormView } from "../../../host/src/routes/forms-page.ts";
import { logicState, publicFormView, typeAllowed } from "../handlers/submit.ts";
import { formPrincipal } from "../handlers/submit.ts";
import { harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { code, openForm, run } from "../fixtures/seed.ts";
import type { OpenForm } from "../fixtures/seed.ts";

interface SubmitOut { recordId: string; thankYou?: string }
const submit = (f: { slug: string; public: Ctx }, input: Record<string, unknown>) => run<SubmitOut>(f.public, "forms.submit", { slug: f.slug, ...input });

/** The public ctx, with files.get answering from a table (the fake world has no Files module). */
function withFiles(ctx: Ctx, files: Record<string, { size: number; mime: string; name: string }>): Ctx {
  const base = ctx.call.bind(ctx) as (cap: string, input: unknown) => Promise<unknown>;
  const call = (async (cap: string, input: unknown) => {
    if (cap !== "files.get") return base(cap, input);
    const id = String((input as { fileId: unknown }).fileId);
    const f = files[id];
    if (!f) throw new VyreErr({ code: "validation.not_found", message: "No such file.", retryable: false, traceId: "0".repeat(32), next: [] });
    return { file: { fileId: id, ...f } };
  }) as Ctx["call"];
  return { ...ctx, call };
}

const LOGIC = {
  rules: [
    { when: { field: "kind", op: "eq", value: "company" }, show: ["company_name"], require: ["company_name"] },
    { when: { field: "kind", op: "eq", value: "person" }, hide: ["phone"] },
    { when: { all: [{ field: "budget", op: "gte", value: 1000 }, { not: { field: "kind", op: "eq", value: "person" } }] }, require: ["notes"] },
  ],
};

async function logicForm(w: World): Promise<OpenForm> {
  const f = await openForm(w, {
    fields: ["kind", "company_name", "phone", "budget", "notes", "email"].map((field) => ({ field, mode: "ask" as const })),
  });
  await run(w.ctx, "forms.design_set", { formId: f.formId, logic: LOGIC });
  return f;
}

// ---- conditional logic --------------------------------------------------------------------------------------------

test("logic: a question named in a show rule is hidden until its rule matches, and its answer is dropped while hidden", async () => {
  const w = harness();
  const f = await logicForm(w);
  const hiddenOut = await submit(f, { answers: { kind: "person", company_name: "Acme", email: "a@x.example" } });
  assert.deepEqual(w.records.get(hiddenOut.recordId)?.fields, { kind: "person", email: "a@x.example" });
  w.advance(120_000);
  const shownOut = await submit(f, { answers: { kind: "company", company_name: "Acme", email: "b@x.example" } });
  assert.deepEqual(w.records.get(shownOut.recordId)?.fields, { kind: "company", company_name: "Acme", email: "b@x.example" });
});

test("logic: a hide rule drops the answer to the question it hides", async () => {
  const w = harness();
  const f = await logicForm(w);
  const out = await submit(f, { answers: { kind: "person", phone: "555", email: "c@x.example" } });
  assert.equal(w.records.get(out.recordId)?.fields.phone, undefined);
});

test("logic: a require rule makes a visible question mandatory, and names it in the refusal", async () => {
  const w = harness();
  const f = await logicForm(w);
  const refused = submit(f, { answers: { kind: "company", email: "d@x.example" } });
  assert.equal(await code(refused), "validation.bad_input");
  await assert.rejects(submit(f, { answers: { kind: "company", company_name: "  ", email: "d@x.example" } }), (e: unknown) => e instanceof VyreErr && (e.error.details as { field?: string }).field === "answers.company_name");
  assert.equal(w.records.size, 0, "a refused call writes nothing");
  const out = await submit(f, { answers: { kind: "company", company_name: "Acme", email: "d@x.example" } });
  assert.match(out.recordId, /^rec_/);
});

test("logic: rules combine with all and not, and a number compares as a number", async () => {
  const w = harness();
  const f = await logicForm(w);
  const company = { kind: "company", company_name: "Acme", email: "e@x.example" };
  assert.equal(await code(submit(f, { answers: { ...company, budget: "2500" } })), "validation.bad_input");
  assert.equal(await code(submit(f, { answers: { ...company, budget: "999" } })), "none");
  w.advance(120_000);
  assert.equal(await code(submit(f, { answers: { ...company, email: "f@x.example", budget: "2500", notes: "Big job" } })), "none");
  w.advance(120_000);
  assert.equal(await code(submit(f, { answers: { kind: "person", budget: "2500", email: "g@x.example" } })), "none", "not person is false for a person");
});

test("logic: a hidden question is never required, and an answer to a hidden question does not feed a rule", () => {
  const rules = { rules: [{ when: { field: "a", op: "eq", value: "x" }, show: ["b"] }, { when: { field: "b", op: "eq", value: "y" }, show: ["c"], require: ["c"] }] };
  const s = logicState(rules, { a: "no", b: "y", c: "" });
  assert.deepEqual([...s.hidden].sort(), ["b", "c"]);
  assert.deepEqual([...s.required], []);
  const on = logicState(rules, { a: "x", b: "y", c: "" });
  assert.deepEqual([...on.hidden], []);
  assert.deepEqual([...on.required], ["c"]);
});

// ---- upload policy ------------------------------------------------------------------------------------------------

async function uploadForm(w: World, policy: Record<string, unknown>): Promise<OpenForm> {
  const f = await openForm(w, { fields: [{ field: "email", mode: "ask" }, { field: "resume", mode: "ask" }] });
  await run(w.ctx, "forms.update", { formId: f.formId, uploadPolicy: policy });
  return f;
}
const FILES = {
  fil_small_pdf: { size: 10_000, mime: "application/pdf", name: "cv.pdf" },
  fil_big_pdf: { size: 5_000_000, mime: "application/pdf", name: "big.pdf" },
  fil_exe: { size: 10_000, mime: "application/x-msdownload", name: "run.exe" },
  fil_png: { size: 10_000, mime: "image/png", name: "me.png" },
};

test("upload policy: a file over the size limit is refused as too large and nothing is written", async () => {
  const w = harness();
  const f = await uploadForm(w, { fields: ["resume"], maxBytes: 1_000_000, types: ["application/pdf"] });
  const ctx = withFiles(f.public, FILES);
  const over = run(ctx, "forms.submit", { slug: f.slug, answers: { email: "a@x.example", resume: { fileId: "fil_big_pdf" } } });
  assert.equal(await code(over), "validation.too_large");
  assert.equal(w.records.size, 0);
});

test("upload policy: a file of a type that is not listed is refused, a family and an extension both match", async () => {
  const w = harness();
  const f = await uploadForm(w, { fields: ["resume"], types: ["application/pdf", "image/*"] });
  const ctx = withFiles(f.public, FILES);
  const send = (fileId: string, email: string) => run<SubmitOut>(ctx, "forms.submit", { slug: f.slug, answers: { email, resume: { fileId } } });
  assert.equal(await code(send("fil_exe", "a@x.example")), "validation.bad_input");
  assert.equal(await code(send("fil_small_pdf", "b@x.example")), "none");
  assert.equal(await code(send("fil_png", "c@x.example")), "none");
  assert.equal(typeAllowed([".pdf"], "application/octet-stream", "CV.PDF"), true);
  assert.equal(typeAllowed([], "anything/at-all", "x"), true);
  assert.equal(typeAllowed(["image/*"], "imagery/x", "x"), false);
});

test("upload policy: a file the store does not know is refused, and with no policy a file answer is not looked up", async () => {
  const w = harness();
  const f = await uploadForm(w, { maxBytes: 1_000_000 });
  const ctx = withFiles(f.public, FILES);
  assert.equal(await code(run(ctx, "forms.submit", { slug: f.slug, answers: { email: "a@x.example", resume: { fileId: "fil_nope" } } })), "validation.bad_input");
  const w2 = harness();
  const open = await openForm(w2, { fields: [{ field: "email", mode: "ask" }, { field: "resume", mode: "ask" }] });
  const out = await submit(open, { answers: { email: "z@x.example", resume: { fileId: "fil_any" } } });
  assert.match(out.recordId, /^rec_/);
  assert.equal(w2.calls.filter((c) => c.cap === "files.get").length, 0);
});

// ---- consent and captcha ------------------------------------------------------------------------------------------

test("consent: a form with a consent statement refuses a submit that does not accept it", async () => {
  const w = harness();
  const f = await openForm(w, { consentText: "I agree to be contacted." });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" } })), "validation.bad_input");
  assert.equal(w.records.size, 0);
  const out = await submit(f, { answers: { email: "a@x.example", consent: true } });
  assert.deepEqual(w.records.get(out.recordId)?.fields, { email: "a@x.example" }, "the consent flag is never written to the record");
});

test("captcha: a missing or failed token is refused before any write, a good one passes", async () => {
  const w = harness();
  const f = await openForm(w, { captcha: true });
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" } })), "auth.invalid_code");
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, captcha: "robot" })), "auth.invalid_code");
  assert.equal(w.records.size, 0);
  assert.equal(await code(submit(f, { answers: { email: "a@x.example" }, captcha: "human" })), "none");
});

// ---- the page view and its snapshot -------------------------------------------------------------------------------

const quiet = (html: string): string => html.split("\n").filter((l) => l.trim() !== "").join("\n");
const between = (html: string, from: string, to: string): string => html.slice(html.indexOf(from), html.indexOf(to) + to.length);

test("publicFormView: only a published form of the right kind, with the questions a visitor sees", async () => {
  const w = harness();
  const f = await openForm(w, { fields: [{ field: "email", mode: "ask" }, { field: "plan", mode: "show" }, { field: "src", mode: "hide", prefillKey: "src" }, { field: "secret", mode: "hide" }, { field: "name", mode: "ask", step: 1 }], consentText: "OK?" });
  await run(w.ctx, "forms.design_set", { formId: f.formId, css: ".x{color:red}", theme: { accent: "#123456" }, thankYou: { text: "Thanks" }, logic: LOGIC });
  const v = publicFormView(f.public, f.slug, "form");
  assert.deepEqual(v.fields, [{ field: "email", hidden: false, step: 0 }, { field: "src", hidden: true, prefillKey: "src", step: 0 }, { field: "name", hidden: false, step: 1 }]);
  assert.equal(v.consentText, "OK?");
  assert.equal(v.css, ".x{color:red}");
  assert.deepEqual(v.thankYou, { text: "Thanks" });
  assert.equal(v.logic?.rules.length, 3);
  assert.throws(() => publicFormView(f.public, f.slug, "booking"), VyreErr);
  await run(w.ctx, "forms.unpublish", { formId: f.formId });
  assert.throws(() => publicFormView(f.public, f.slug, "form"), VyreErr);
});

test("rendered page snapshot: a plain form with a consent statement", () => {
  const view: PublicFormView = {
    slug: "intake", kind: "public", name: "Intake", captcha: false, consentText: "I agree to be contacted.",
    fields: [{ field: "email", hidden: false, step: 0 }, { field: "name", hidden: false, step: 0 }],
  };
  const html = quiet(renderFormPage({ view, page: "form", nonce: "N0NCE", uploads: false }));
  assert.equal(
    between(html, "<h1>", "</main>"),
    [
      "<h1>Intake</h1>",
      '<p id="vf-banner" class="vf-banner" role="status" hidden></p>',
      '<form id="vf-form" novalidate>',
      '<p id="vf-count" class="vf-steps" aria-live="polite"></p>',
      '<fieldset data-step="0" style="border:0;margin:0;padding:0"><div class="vf-field" data-for="email"><label for="vf-email">Email <span class="vf-req" hidden>(required)</span></label><input id="vf-email" type="email" data-field="email" maxlength="10000" autocomplete="email"></div><div class="vf-field" data-for="name"><label for="vf-name">Name <span class="vf-req" hidden>(required)</span></label><input id="vf-name" type="text" data-field="name" maxlength="10000" autocomplete="name"></div></fieldset>',
      '<div class="vf-consent"><input id="vf-consent" type="checkbox" data-always-required required><label for="vf-consent" style="font-weight:400;margin:0">I agree to be contacted.</label></div>',
      '<div class="vf-actions"><button type="button" id="vf-back" hidden>Back</button><button type="button" id="vf-next" class="vf-primary" hidden>Next</button><button type="submit" id="vf-send" class="vf-primary">Send</button></div>',
      "</form>",
      '<p id="vf-thanks" class="vf-banner" role="status" hidden></p>',
      "</main>",
    ].join("\n"),
  );
  assert.match(html, /<script type="application\/json" id="vf-data">\{"slug":"intake","kind":"public","captcha":false\}<\/script>/);
  assert.match(html, /<script nonce="N0NCE">/);
  assert.match(html, /<title>Intake<\/title>/);
});

test("rendered page: steps, captcha widget, file chooser, hidden prefill, theme and custom CSS", () => {
  const view: PublicFormView = {
    slug: "apply", kind: "public", name: "Apply <now>", captcha: true,
    fields: [{ field: "email", hidden: false, step: 0 }, { field: "src", hidden: true, prefillKey: "utm_x", step: 0 }, { field: "resume", hidden: false, step: 1 }],
    theme: { accent: "#123456", font: "url(http://evil.example/x)", radius: "4px;background:red", cover: "https://cdn.example/c.png" },
    css: "h1{color:red}</style><script>alert(1)</script>",
    upload: { fields: ["resume"], folderId: "fld_up", maxBytes: 1000, types: ["application/pdf"] },
    thankYou: { redirect: "/thanks" },
  };
  const html = renderFormPage({ view, page: "form", nonce: "N", uploads: true, captcha: { siteKey: "SITE", scriptUrl: "https://captcha.example/api.js", className: "cf-turnstile" } });
  assert.match(html, /<title>Apply &lt;now&gt;<\/title>/);
  assert.match(html, /<fieldset data-step="1" style="[^"]*" hidden>/, "a second step starts hidden");
  assert.match(html, /<input id="vf-resume" type="file" data-field="resume" accept="application\/pdf">/);
  assert.match(html, /<input type="hidden" data-field="src" data-prefill="utm_x">/);
  assert.match(html, /<div class="cf-turnstile" data-sitekey="SITE"><\/div>/);
  assert.match(html, /<script src="https:\/\/captcha\.example\/api\.js" async defer><\/script>/);
  assert.match(html, /:root\{--vf-accent:#123456\}/, "a safe theme value is kept");
  assert.doesNotMatch(html, /evil\.example/, "a theme value that loads something is dropped");
  assert.doesNotMatch(html, /background:red/, "a theme value cannot end its declaration");
  assert.match(html, /<img class="vf-cover" src="https:\/\/cdn\.example\/c\.png" alt="">/);
  assert.doesNotMatch(html, /<script>alert/, "custom CSS cannot close its style tag or bring a script");
  assert.ok(html.includes("h1{color:red}\\3c /style>"), "its angle brackets are written as CSS escapes");
  assert.match(html, /"thankYou":\{"redirect":"\/thanks"\}/);
});

// ---- the routes ---------------------------------------------------------------------------------------------------

interface Served { base: string; callers: PageCaller[]; close(): Promise<void> }

async function serve(w: World, o: { perMinute?: number; uploads?: boolean; clock?: () => number } = {}): Promise<Served> {
  const callers: PageCaller[] = [];
  const stored: { slug: string; name: string; type: string; size: number }[] = [];
  const route = createFormsPageRoute({
    async read(slug, page, caller) {
      callers.push(caller);
      try { return publicFormView(w.ctx, slug, page); } catch (e) { if (e instanceof VyreErr) return null; throw e; }
    },
    async link(slug, token) { return token === "good" ? { fields: [{ field: "name", step: 0 }] } : null; },
    ...(o.uploads ? { async upload(slug: string, file: { name: string; type: string; bytes: Uint8Array; folderId: string }) { stored.push({ slug, name: file.name, type: file.type, size: file.bytes.length }); return "fil_up_1"; } } : {}),
    ...(o.perMinute !== undefined ? { perMinute: o.perMinute } : {}),
    ...(o.clock ? { now: o.clock } : {}),
  });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(418); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, callers, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("GET /f/<slug> serves the page to a signed-out visitor as an actor, with a nonce policy and no caching", async () => {
  const w = harness();
  const f = await openForm(w, { consentText: "OK?" });
  const s = await serve(w);
  try {
    const r = await fetch(`${s.base}/f/${f.slug}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const csp = r.headers.get("content-security-policy") ?? "";
    const html = await r.text();
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce);
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /form-action 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(html, /data-field="email"/);
    const head = await fetch(`${s.base}/f/${f.slug}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(s.callers.length, 2);
    for (const c of s.callers) {
      assert.equal(c.kind, "actor", "a signed-out visitor is an actor, never a service (ruling 67)");
      assert.match(c.id, /^act_anon_[0-9a-f]{16}$/);
    }
    assert.equal(s.callers[0]?.id, s.callers[1]?.id, "the same source is the same actor");
    assert.notEqual(s.callers[0]?.id, formPrincipal(f.formId));
  } finally { await s.close(); }
});

test("a draft, closed or unknown form, or the wrong address for its kind, is the same 404", async () => {
  const w = harness();
  const draft = await openForm(w, { publish: false });
  const open = await openForm(w, { name: "Open one" });
  const s = await serve(w);
  try {
    for (const path of [`/f/${draft.slug}`, "/f/no-such-form", `/book/${open.slug}`]) {
      const r = await fetch(`${s.base}${path}`);
      assert.equal(r.status, 404, path);
      const j = (await r.json()) as { error: { code: string } };
      assert.equal(j.error.code, "validation.not_found");
    }
    await run(w.ctx, "forms.unpublish", { formId: open.formId });
    assert.equal((await fetch(`${s.base}/f/${open.slug}`)).status, 404);
  } finally { await s.close(); }
});

test("only GET and HEAD read a page, the capability addresses are left to the gateway, and other paths are not this route's", async () => {
  const w = harness();
  const f = await openForm(w);
  const s = await serve(w);
  try {
    assert.equal((await fetch(`${s.base}/f/${f.slug}`, { method: "POST", body: "{}" })).status, 405);
    assert.equal((await fetch(`${s.base}/f/${f.slug}`, { method: "DELETE" })).status, 405);
    for (const p of ["/book/availability", "/book/create", "/f/submit", "/f/partial", "/f/", "/other"]) assert.equal((await fetch(`${s.base}${p}`)).status, 418, p);
  } finally { await s.close(); }
});

test("page views are limited per source address, and a refusal says when to come back", async () => {
  const w = harness();
  const f = await openForm(w);
  let t = 1_000_000;
  const s = await serve(w, { perMinute: 2, clock: () => t });
  try {
    assert.equal((await fetch(`${s.base}/f/${f.slug}`)).status, 200);
    assert.equal((await fetch(`${s.base}/f/${f.slug}`)).status, 200);
    const refused = await fetch(`${s.base}/f/${f.slug}`);
    assert.equal(refused.status, 429);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "rate_limit.exceeded");
    assert.ok(Number(refused.headers.get("retry-after")) >= 1);
    const other = await fetch(`${s.base}/f/${f.slug}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal(other.status, 200, "a different source address has its own budget");
    assert.notEqual(s.callers[s.callers.length - 1]?.id, s.callers[0]?.id);
    t += 61_000;
    assert.equal((await fetch(`${s.base}/f/${f.slug}`)).status, 200);
  } finally { await s.close(); }
});

test("a one-use form opens only from its link, and the link narrows the questions", async () => {
  const w = harness();
  const f = await openForm(w, { kind: "one_use" });
  const s = await serve(w);
  try {
    assert.equal((await fetch(`${s.base}/f/${f.slug}`)).status, 403);
    assert.equal((await fetch(`${s.base}/f/${f.slug}?t=bad`)).status, 403);
    const ok = await fetch(`${s.base}/f/${f.slug}?t=good`);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /data-field="name"/);
    assert.doesNotMatch(html, /data-field="email"/);
    assert.match(html, /"token":"good"/);
  } finally { await s.close(); }
});

test("GET /book/<slug> serves a booking page with the day and time pickers", async () => {
  const w = harness();
  const made = await run<{ form: { formId: string; slug: string } }>(w.ctx, "bookings.page_create", { name: "Call", hostIds: ["usr_host1"], lengthMinutes: 30, recordType: "contact" });
  await run(w.ctx, "forms.publish", { formId: made.form.formId });
  const s = await serve(w);
  try {
    const r = await fetch(`${s.base}/book/${made.form.slug}`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /id="vf-days"/);
    assert.match(html, /id="vf-times"/);
    assert.match(html, /<form id="vf-form" novalidate hidden>/, "the questions appear once a time is picked");
    assert.match(html, /"kind":"booking"/);
    assert.match(html, />Book<\/button>/);
    assert.equal((await fetch(`${s.base}/f/${made.form.slug}`)).status, 404);
  } finally { await s.close(); }
});

test("POST /f/upload/<slug> applies the form's size and type policy before it stores anything", async () => {
  const w = harness();
  const f = await uploadForm(w, { fields: ["resume"], folderId: "fld_up", maxBytes: 100, types: ["application/pdf"] });
  const s = await serve(w, { uploads: true });
  try {
    const post = (body: string, type: string, name = "cv.pdf") => fetch(`${s.base}/f/upload/${f.slug}`, { method: "POST", headers: { "content-type": type, "x-file-name": encodeURIComponent(name) }, body });
    const page = await (await fetch(`${s.base}/f/${f.slug}`)).text();
    assert.match(page, /type="file" data-field="resume" accept="application\/pdf"/);
    const big = await post("x".repeat(101), "application/pdf");
    assert.equal(big.status, 413);
    assert.equal(((await big.json()) as { error: { code: string } }).error.code, "validation.too_large");
    const wrong = await post("x", "application/x-msdownload", "run.exe");
    assert.equal(wrong.status, 415);
    assert.equal((await post("", "application/pdf")).status, 400);
    const ok = await post("%PDF-1", "application/pdf");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { data: { fileId: "fil_up_1" } });
    assert.equal((await fetch(`${s.base}/f/upload/${f.slug}`)).status, 405);
  } finally { await s.close(); }
});

test("without an upload store the page draws no file chooser and the upload address is a 404", async () => {
  const w = harness();
  const f = await uploadForm(w, { fields: ["resume"], folderId: "fld_up" });
  const s = await serve(w);
  try {
    assert.doesNotMatch(await (await fetch(`${s.base}/f/${f.slug}`)).text(), /type="file"/);
    assert.equal((await fetch(`${s.base}/f/upload/${f.slug}`, { method: "POST", body: "x" })).status, 404);
  } finally { await s.close(); }
});
