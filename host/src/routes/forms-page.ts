// The public form pages (spec 2.11; ARCH 7.6): the host serves GET /f/<slug> (public, one-use and survey forms) and GET /book/<slug> (booking pages) as one self-contained HTML page.
// The page draws the form's questions in order, in the form's theme and custom CSS, with its consent statement, captcha, steps and conditional logic, and sends the answers to the capabilities that
// already exist: POST /f/submit, POST /book/create, GET /book/availability. Nothing is decided in the browser that the capability does not decide again; the page only saves a round trip.
//   1. who is asking: nobody signed in. The caller is an `actor` principal named by source address (ruling 67: act_anon_<16 hex of sha256(address)>), never a service, and each address has its
//      own page-view budget (ruling 64: the per-source rate scope). Over budget is 429 with Retry-After.
//   2. what is served: the module's read (deps.read) answers for a form that is published and of the right kind; anything else is the same 404 whether the slug never existed, is a draft or is closed.
//   3. one-use forms open from a link: GET /f/<slug>?t=<token> asks deps.link for the questions that link still needs and the answers saved so far; without a token a one-use form says so.
//   4. uploads: POST /f/upload/<slug> takes one file as the raw body (x-file-name names it), refuses it over the form's size or type policy before storing a byte, and returns { data: { fileId } }
//      for the answer. The store behind it is deps.upload and the folder is the form's upload policy folderId; without both the page draws no file chooser.
// The page is served with a strict content security policy (its own nonce for its one script, no outside scripts but the captcha's), no-store caching and nosniff. Anything else on these paths
// is 405 (GET and HEAD only; upload takes POST). The route is a request hook like the blob route: true when it answered, false when the daemon should carry on.
import type http from "node:http";
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { sourceOf } from "../daemon/preauth.ts";
import { makeError } from "./errors.ts";

/** What the forms module's publicFormView answers (modules/forms/handlers/submit.ts); the host takes it as data, so the two sides meet only in this shape. */
export interface PublicFormView {
  slug: string;
  kind: "public" | "one_use" | "booking" | "survey";
  name: string;
  fields: { field: string; hidden: boolean; prefillKey?: string; step: number }[];
  theme?: Record<string, unknown>;
  css?: string;
  consentText?: string;
  captcha: boolean;
  logic?: { rules: unknown[] };
  thankYou?: { text?: string; redirect?: string };
  upload?: { fields: string[]; folderId?: string; maxBytes?: number; types: string[] };
  lengthMinutes?: number;
}

/** Types are MIME types ("application/pdf"), families ("image/*") or extensions (".pdf"); none listed means any. Same rule as the module's upload check. */
function typeAllowed(types: readonly string[], mime: string, name: string): boolean {
  if (types.length === 0) return true;
  const m = mime.toLowerCase();
  const n = name.toLowerCase();
  return types.some((t) => (t.startsWith(".") ? n.endsWith(t) : t.endsWith("/*") ? m.startsWith(t.slice(0, -1)) : m === t));
}

export interface PageCaller { kind: "actor"; id: string }
export interface LinkQuestions { fields: { field: string; step?: number }[]; partial?: { answers: Record<string, unknown>; step?: number } }
export interface CaptchaWidget {
  /** the provider's public site key */
  siteKey: string;
  /** the provider's script, for example https://challenges.cloudflare.com/turnstile/v0/api.js; its origin is the only outside script the page may load */
  scriptUrl: string;
  /** the widget's CSS class, for example cf-turnstile (Turnstile), h-captcha, g-recaptcha */
  className: string;
}

export interface FormsPageDeps {
  /** The form for this address, or null when it is not open. Runs as the given principal. */
  read(slug: string, page: "form" | "booking", caller: PageCaller): Promise<PublicFormView | null>;
  /** One-use forms: what a link still asks. Null when the link is not valid. */
  link?(slug: string, token: string, caller: PageCaller): Promise<LinkQuestions | null>;
  /** Store an uploaded file for a form; the policy was already applied to the size and declared type. Returns the file's id. */
  upload?(slug: string, file: { name: string; type: string; bytes: Uint8Array; folderId: string }, caller: PageCaller): Promise<string>;
  captcha?: CaptchaWidget;
  /** Page views per source address per minute; default 120. */
  perMinute?: number;
  now?(): number;
}

const TRACE = "0".repeat(32);
const PAGE = /^\/(f|book)\/([a-z0-9][a-z0-9-]{0,63})\/?$/;
const UPLOAD = /^\/f\/upload\/([a-z0-9][a-z0-9-]{0,63})$/;
/** /book/availability and /book/create are capabilities, not pages; they are never a slug. */
const RESERVED = new Set(["availability", "create", "submit", "partial", "upload"]);
const DEFAULT_PER_MINUTE = 120;
const UPLOAD_CAP = 25 * 1024 * 1024;

const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
/** JSON inside a script tag: no `<` can close the tag, and the two line separators stay escaped. */
const jsonIn = (v: unknown): string => JSON.stringify(v).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

function humanize(field: string): string {
  const words = field.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function inputType(field: string): { tag: "input" | "textarea"; type: string; autocomplete?: string } {
  const f = field.toLowerCase();
  if (f === "email" || f.endsWith("_email")) return { tag: "input", type: "email", autocomplete: "email" };
  if (/(^|_)(phone|mobile|tel)(_|$)/.test(f)) return { tag: "input", type: "tel", autocomplete: "tel" };
  if (/(^|_)date(_|$)|_at$|^dob$/.test(f)) return { tag: "input", type: "date" };
  if (/(^|_)(message|notes?|description|comments?|details|summary)(_|$)/.test(f)) return { tag: "textarea", type: "text" };
  if (f === "name" || f === "full_name") return { tag: "input", type: "text", autocomplete: "name" };
  return { tag: "input", type: "text" };
}

// ---- theme -------------------------------------------------------------------------------------------------------

/** A theme value goes into a CSS custom property, so it may not carry anything that could end the declaration or load something. */
const SAFE_VALUE = /^[#\w\s.,%()'"/-]{1,80}$/;
const safeCss = (v: unknown): string | undefined => (typeof v === "string" && SAFE_VALUE.test(v) && !/url\s*\(|expression|@import/i.test(v) ? v.trim() : undefined);
const safeImage = (v: unknown): string | undefined => (typeof v === "string" && /^(https:\/\/|\/)[^\s"'<>()\\]{1,500}$/.test(v) && !v.startsWith("//") ? v : undefined);

function themeVars(theme: Record<string, unknown> | undefined): string {
  const t = theme ?? {};
  const pairs: [string, string | undefined][] = [
    ["--vf-accent", safeCss(t.accent)], ["--vf-bg", safeCss(t.background)], ["--vf-text", safeCss(t.text)],
    ["--vf-font", safeCss(t.font)], ["--vf-radius", safeCss(t.radius)], ["--vf-width", safeCss(t.maxWidth)],
  ];
  return pairs.filter((p): p is [string, string] => p[1] !== undefined).map(([k, v]) => `${k}:${v}`).join(";");
}

const BASE_CSS = `
:root{--vf-accent:#3b6ef6;--vf-bg:#fff;--vf-text:#1d1d1f;--vf-muted:#6e6e73;--vf-line:#d2d2d7;--vf-radius:8px;--vf-width:560px;--vf-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-themed]){--vf-bg:#1c1c1e;--vf-text:#f5f5f7;--vf-muted:#98989d;--vf-line:#3a3a3c}}
*{box-sizing:border-box}
body{margin:0;background:var(--vf-bg);color:var(--vf-text);font:16px/1.45 var(--vf-font)}
main{max-width:var(--vf-width);margin:0 auto;padding:32px 16px 64px}
.vf-cover{width:100%;max-height:200px;object-fit:cover;border-radius:var(--vf-radius);margin-bottom:20px}
h1{font-size:26px;line-height:1.2;margin:0 0 20px}
.vf-field{margin:0 0 16px}
label,.vf-label{display:block;font-weight:600;font-size:14px;margin:0 0 6px}
input,textarea,select{width:100%;padding:10px 12px;font:inherit;color:inherit;background:transparent;border:1px solid var(--vf-line);border-radius:var(--vf-radius)}
textarea{min-height:110px;resize:vertical}
input:focus,textarea:focus,select:focus,button:focus-visible{outline:2px solid var(--vf-accent);outline-offset:1px}
.vf-req{color:var(--vf-muted);font-weight:400}
.vf-consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--vf-muted);margin:0 0 16px}
.vf-consent input{width:auto;margin-top:3px}
.vf-actions{display:flex;gap:10px;justify-content:space-between;margin-top:8px}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:var(--vf-radius);border:1px solid var(--vf-line);background:transparent;color:inherit;cursor:pointer}
button.vf-primary{background:var(--vf-accent);border-color:var(--vf-accent);color:#fff;margin-left:auto}
button:disabled{opacity:.55;cursor:default}
.vf-error{color:#c9342b;font-size:14px;margin:6px 0 0}
.vf-banner{border:1px solid var(--vf-line);border-radius:var(--vf-radius);padding:12px 14px;margin:0 0 16px}
.vf-steps{color:var(--vf-muted);font-size:13px;margin:0 0 12px}
.vf-days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin:0 0 12px}
.vf-days button[aria-pressed=true],.vf-times button[aria-pressed=true]{background:var(--vf-accent);border-color:var(--vf-accent);color:#fff}
.vf-times{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
[hidden]{display:none!important}
`;

// ---- the page script ---------------------------------------------------------------------------------------------
// One script for both pages; the page's data arrives as JSON in #vf-data. It mirrors modules/forms/handlers/submit.ts logicState (the module decides again at submit).
// No template literals here: the source is plain strings so nothing in it can be mistaken for the host's own interpolation.

const SCRIPT = String.raw`
(function () {
  var D = JSON.parse(document.getElementById("vf-data").textContent);
  var form = document.getElementById("vf-form");
  var banner = document.getElementById("vf-banner");
  var q = new URLSearchParams(location.search);
  var answers = {};
  var files = {};
  var step = 0;
  var slot = null;
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function say(msg, bad) { banner.textContent = msg; banner.hidden = !msg; banner.style.color = bad ? "#c9342b" : ""; }
  function empty(v) { return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0); }
  function text(v) { return Array.isArray(v) ? v.join(",") : v === undefined || v === null ? "" : String(v); }
  function holds(c, a) {
    if (!c || typeof c !== "object") return false;
    if (Array.isArray(c.all)) return c.all.every(function (x) { return holds(x, a); });
    if (Array.isArray(c.any)) return c.any.some(function (x) { return holds(x, a); });
    if ("not" in c) return !holds(c.not, a);
    var have = a[c.field], want = c.value;
    switch (c.op) {
      case "empty": return empty(have);
      case "not_empty": return !empty(have);
      case "eq": return Array.isArray(have) ? have.indexOf(text(want)) >= 0 : text(have) === text(want);
      case "ne": return Array.isArray(have) ? have.indexOf(text(want)) < 0 : text(have) !== text(want);
      case "in": return Array.isArray(want) && want.map(text).indexOf(text(have)) >= 0;
      case "contains": return text(have).toLowerCase().indexOf(text(want).toLowerCase()) >= 0;
      case "gt": case "gte": case "lt": case "lte": {
        var x = Number(have), y = Number(want);
        if (empty(have) || !isFinite(x) || !isFinite(y)) return false;
        return c.op === "gt" ? x > y : c.op === "gte" ? x >= y : c.op === "lt" ? x < y : x <= y;
      }
    }
    return false;
  }
  function state() {
    var rules = (D.logic && D.logic.rules) || [];
    var starts = {}; rules.forEach(function (r) { (r.show || []).forEach(function (f) { starts[f] = 1; }); });
    var hidden = Object.assign({}, starts), required = {};
    for (var pass = 0; pass < 8; pass++) {
      var seen = {}; Object.keys(answers).forEach(function (k) { if (!hidden[k]) seen[k] = answers[k]; });
      var next = Object.assign({}, starts), need = {};
      rules.forEach(function (r) { if (holds(r.when, seen)) (r.show || []).forEach(function (f) { delete next[f]; }); });
      rules.forEach(function (r) { if (holds(r.when, seen)) { (r.hide || []).forEach(function (f) { next[f] = 1; }); (r.require || []).forEach(function (f) { need[f] = 1; }); } });
      var same = Object.keys(next).length === Object.keys(hidden).length && Object.keys(next).every(function (f) { return hidden[f]; });
      hidden = next; required = need;
      if (same) break;
    }
    Object.keys(hidden).forEach(function (f) { delete required[f]; });
    return { hidden: hidden, required: required };
  }
  function read() {
    $all("[data-field]").forEach(function (el) {
      var f = el.getAttribute("data-field");
      if (el.type === "file") { if (files[f]) answers[f] = files[f]; else delete answers[f]; return; }
      answers[f] = el.value;
    });
  }
  function apply() {
    read();
    var s = state();
    $all(".vf-field").forEach(function (w) {
      var f = w.getAttribute("data-for");
      var hide = !!s.hidden[f];
      w.hidden = hide;
      var el = w.querySelector("[data-field]");
      if (el && el.type !== "file") el.required = !!s.required[f] || el.hasAttribute("data-always-required");
      var mark = w.querySelector(".vf-req");
      if (mark) mark.hidden = !!s.required[f];
    });
    return s;
  }
  function stepsOf() { return $all("fieldset[data-step]"); }
  function show(n) {
    var all = stepsOf(); step = Math.max(0, Math.min(n, all.length - 1));
    all.forEach(function (fs, i) { fs.hidden = i !== step; });
    var back = document.getElementById("vf-back"), next = document.getElementById("vf-next"), send = document.getElementById("vf-send"), count = document.getElementById("vf-count");
    if (all.length > 1) { count.textContent = "Step " + (step + 1) + " of " + all.length; }
    back.hidden = step === 0; next.hidden = step >= all.length - 1; send.hidden = step < all.length - 1;
  }
  function fieldError(f, msg) {
    $all(".vf-error").forEach(function (e) { e.remove(); });
    var w = f && document.querySelector('[data-for="' + f + '"]');
    if (w) { var p = document.createElement("p"); p.className = "vf-error"; p.textContent = msg; w.appendChild(p); var i = w.querySelector("[data-field]"); if (i) i.focus(); }
    else say(msg, true);
  }
  function stepValid() {
    var fs = stepsOf()[step]; if (!fs) return true;
    var bad = $all("[data-field]", fs).filter(function (el) { return !el.closest(".vf-field").hidden && !el.checkValidity(); })[0];
    if (bad) { bad.reportValidity(); return false; }
    return true;
  }
  function attribution(consent) {
    var a = { consent: consent };
    [["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"]].forEach(function (p) { if (q.get(p[0])) a[p[1]] = q.get(p[0]); });
    if (document.referrer) a.referrer = document.referrer;
    var ids = {}; ["gclid", "fbclid", "msclkid", "ttclid"].forEach(function (k) { if (q.get(k)) ids[k] = q.get(k); });
    if (Object.keys(ids).length) a.clickIds = ids;
    a.landingPage = location.origin + location.pathname;
    return a;
  }
  function captchaToken() {
    var el = document.querySelector('[name$="-response"]');
    return el && el.value ? el.value : undefined;
  }
  function done() {
    var t = D.thankYou || {};
    if (t.redirect && /^(https?:\/\/|\/)/.test(t.redirect) && t.redirect.indexOf("//") !== 0) { location.href = t.redirect; return; }
    form.hidden = true;
    var h = document.getElementById("vf-thanks"); h.textContent = t.text || (D.kind === "booking" ? "You are booked. A confirmation is on its way." : "Thank you. Your answers were sent."); h.hidden = false;
    say("");
  }
  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.error) { var e = j.error || {}; var err = new Error(e.message || "That did not go through. Try again."); err.field = e.details && e.details.field; throw err; } return j.data; });
    });
  }
  function submit(ev) {
    ev.preventDefault();
    var s = apply();
    if (!stepValid()) return;
    var out = {};
    Object.keys(answers).forEach(function (k) { if (!s.hidden[k]) out[k] = answers[k]; });
    var consentBox = document.getElementById("vf-consent");
    var consent = consentBox ? consentBox.checked : false;
    if (consentBox) out.consent = consent;
    if (consentBox && !consentBox.checked) { say("Please accept the consent statement to continue.", true); return; }
    var cap = captchaToken(); if (D.captcha && !cap) { say("Complete the captcha to continue.", true); return; }
    var send = document.getElementById("vf-send"); send.disabled = true; say("");
    var body, url;
    if (D.kind === "booking") {
      if (!slot) { say("Pick a time first.", true); send.disabled = false; return; }
      url = "/book/create"; body = { slug: D.slug, startsAt: slot, answers: out, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    } else {
      url = "/f/submit"; body = { slug: D.slug, answers: out, attribution: attribution(consent) };
      if (D.token) body.token = D.token;
    }
    if (cap) body.captcha = cap;
    post(url, body).then(done, function (e) { send.disabled = false; fieldError(e.field ? String(e.field).replace(/^answers\./, "") : null, e.message); });
  }
  function upload(el) {
    var f = el.getAttribute("data-field"), file = el.files && el.files[0], hint = el.parentNode.querySelector(".vf-hint");
    delete files[f]; if (!file) return;
    var u = D.upload || {};
    if (u.maxBytes !== undefined && file.size > u.maxBytes) { el.value = ""; fieldError(f, "That file is over the " + Math.floor(u.maxBytes / 1024) + " KB limit."); return; }
    fetch("/f/upload/" + encodeURIComponent(D.slug), { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error((j.error && j.error.message) || "The file did not upload."); return j.data; }); })
      .then(function (d) { files[f] = { fileId: d.fileId }; if (hint) hint.textContent = file.name; }, function (e) { el.value = ""; fieldError(f, e.message); });
  }
  // prefill: a visible question takes its value from the saved partial answers; a hidden one from the address
  var partial = D.partial || {};
  $all("[data-field]").forEach(function (el) {
    var f = el.getAttribute("data-field"), k = el.getAttribute("data-prefill");
    if (el.type === "file") return;
    if (partial[f] !== undefined && partial[f] !== null) el.value = String(partial[f]);
    else if (k && q.get(k) !== null) el.value = q.get(k);
  });
  form.addEventListener("input", apply);
  form.addEventListener("change", function (e) { if (e.target && e.target.type === "file") upload(e.target); apply(); });
  form.addEventListener("submit", submit);
  document.getElementById("vf-next").addEventListener("click", function () { apply(); if (stepValid()) show(step + 1); });
  document.getElementById("vf-back").addEventListener("click", function () { show(step - 1); });
  apply();
  show(D.partialStep || 0);
  if (D.kind === "booking") {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone, days = document.getElementById("vf-days"), times = document.getElementById("vf-times");
    var from = Date.now(), to = from + 14 * 86400000, byDay = {};
    var fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: tz });
    var fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
    function showDay(key, btn) {
      $all("button", days).forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      times.textContent = ""; slot = null;
      byDay[key].forEach(function (s) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = fmtTime.format(s.startsAt); b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () { $all("button", times).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); slot = s.startsAt; form.hidden = false; say(""); });
        times.appendChild(b);
      });
    }
    fetch("/book/availability?slug=" + encodeURIComponent(D.slug) + "&tz=" + encodeURIComponent(tz) + "&from=" + from + "&to=" + to).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !j.data || !j.data.available) { say("Booking is not available right now. Please try again later.", true); return; }
      var slots = j.data.slots; if (!slots.length) { say("There are no open times in the next two weeks."); return; }
      var order = [];
      slots.forEach(function (s) { var k = fmtDay.format(s.startsAt); if (!byDay[k]) { byDay[k] = []; order.push(k); } byDay[k].push(s); });
      order.forEach(function (k, i) { var b = document.createElement("button"); b.type = "button"; b.textContent = k; b.setAttribute("aria-pressed", "false"); b.addEventListener("click", function () { showDay(k, b); }); days.appendChild(b); if (i === 0) showDay(k, b); });
    }, function () { say("Booking is not available right now. Please try again later.", true); });
  }
})();
`;

// ---- rendering ---------------------------------------------------------------------------------------------------

export interface RenderOpts { view: PublicFormView; page: "form" | "booking"; nonce: string; captcha?: CaptchaWidget | undefined; uploads: boolean; link?: LinkQuestions | null; token?: string | undefined }

function fieldHtml(view: PublicFormView, f: PublicFormView["fields"][number], uploads: boolean): string {
  const name = esc(f.field);
  const prefill = f.prefillKey ? ` data-prefill="${esc(f.prefillKey)}"` : "";
  if (f.hidden) return `<div class="vf-field" data-for="${name}" hidden><input type="hidden" data-field="${name}"${prefill}></div>`;
  const label = `<label for="vf-${name}">${esc(humanize(f.field))} <span class="vf-req" hidden>(required)</span></label>`;
  if (uploads && view.upload?.folderId !== undefined && view.upload.fields.includes(f.field)) {
    const accept = view.upload.types.length > 0 ? ` accept="${esc(view.upload.types.join(","))}"` : "";
    return `<div class="vf-field" data-for="${name}">${label}<input id="vf-${name}" type="file" data-field="${name}"${accept}${prefill}><span class="vf-hint"></span></div>`;
  }
  const t = inputType(f.field);
  const auto = t.autocomplete ? ` autocomplete="${t.autocomplete}"` : "";
  const control = t.tag === "textarea"
    ? `<textarea id="vf-${name}" data-field="${name}" maxlength="10000"${prefill}></textarea>`
    : `<input id="vf-${name}" type="${t.type}" data-field="${name}" maxlength="10000"${auto}${prefill}>`;
  return `<div class="vf-field" data-for="${name}">${label}${control}</div>`;
}

/** The whole page as a string. Pure: the same view renders the same bytes, which is what the snapshot test holds. */
export function renderFormPage(o: RenderOpts): string {
  const { view, nonce } = o;
  const link = o.link ?? null;
  let fields = view.fields;
  if (link) {
    const asked = new Map(link.fields.map((f) => [f.field, f.step]));
    fields = fields.filter((f) => asked.has(f.field)).map((f) => ({ ...f, step: asked.get(f.field) ?? f.step }));
  }
  const steps = [...new Set(fields.map((f) => f.step))].sort((a, b) => a - b);
  const groups = (steps.length > 0 ? steps : [0]).map((n) => fields.filter((f) => f.step === n));
  const body = groups.map((g, i) => `<fieldset data-step="${i}" style="border:0;margin:0;padding:0"${i === 0 ? "" : " hidden"}>${g.map((f) => fieldHtml(view, f, o.uploads)).join("")}</fieldset>`).join("");
  const cap = o.captcha && view.captcha ? o.captcha : undefined;
  const data = {
    slug: view.slug, kind: view.kind, captcha: view.captcha,
    ...(view.logic ? { logic: view.logic } : {}), ...(view.thankYou ? { thankYou: view.thankYou } : {}), ...(view.upload ? { upload: { maxBytes: view.upload.maxBytes, types: view.upload.types } } : {}),
    ...(o.token ? { token: o.token } : {}), ...(link?.partial ? { partial: link.partial.answers, partialStep: link.partial.step ?? 0 } : {}),
  };
  const vars = themeVars(view.theme);
  const cover = safeImage(view.theme?.cover);
  const custom = (view.css ?? "").replaceAll("<", "\\3c ");
  const booking = o.page === "booking";
  const consent = view.consentText
    ? `<div class="vf-consent"><input id="vf-consent" type="checkbox" data-always-required required><label for="vf-consent" style="font-weight:400;margin:0">${esc(view.consentText)}</label></div>` : "";
  return `<!doctype html>
<html lang="en"${vars ? " data-themed" : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(view.name)}</title>
<style>${BASE_CSS}</style>
${vars ? `<style>:root{${vars}}</style>` : ""}
${custom ? `<style>${custom}</style>` : ""}
</head><body><main>
${cover ? `<img class="vf-cover" src="${esc(cover)}" alt="">` : ""}
<h1>${esc(view.name)}</h1>
<p id="vf-banner" class="vf-banner" role="status" hidden></p>
${booking ? `<div id="vf-days" class="vf-days" role="group" aria-label="Pick a day"></div><div id="vf-times" class="vf-times" role="group" aria-label="Pick a time"></div>` : ""}
<form id="vf-form" novalidate${booking ? " hidden" : ""}>
<p id="vf-count" class="vf-steps" aria-live="polite"></p>
${body}
${consent}
${cap ? `<div class="${esc(cap.className)}" data-sitekey="${esc(cap.siteKey)}"></div>` : ""}
<div class="vf-actions"><button type="button" id="vf-back" hidden>Back</button><button type="button" id="vf-next" class="vf-primary" hidden>Next</button><button type="submit" id="vf-send" class="vf-primary">${booking ? "Book" : "Send"}</button></div>
</form>
<p id="vf-thanks" class="vf-banner" role="status" hidden></p>
</main>
<script type="application/json" id="vf-data">${jsonIn(data)}</script>
${cap ? `<script src="${esc(cap.scriptUrl)}" async defer></script>` : ""}
<script nonce="${nonce}">${SCRIPT}</script>
</body></html>
`;
}

// ---- the route ---------------------------------------------------------------------------------------------------

function policyHeader(nonce: string, cap?: CaptchaWidget): string {
  const origin = cap ? new URL(cap.scriptUrl).origin : "";
  return [
    "default-src 'none'", `script-src 'nonce-${nonce}'${origin ? ` ${origin}` : ""}`, "style-src 'unsafe-inline'", "img-src 'self' https: data:", "font-src data:",
    "connect-src 'self'", `frame-src ${origin || "'none'"}`, "form-action 'none'", "base-uri 'none'", "frame-ancestors *",
  ].join("; ");
}

export function createFormsPageRoute(deps: FormsPageDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  const perMinute = deps.perMinute ?? DEFAULT_PER_MINUTE;
  const clock = deps.now ?? Date.now;
  const hits = new Map<string, number[]>();

  /** Per-source page budget (ruling 64): one address cannot spend another's. A refused view is not counted, so a flood does not extend its own wait. */
  function allowed(source: string): number {
    const t = clock();
    const mine = (hits.get(source) ?? []).filter((at) => at > t - 60_000);
    if (mine.length >= perMinute) { hits.set(source, mine); return Math.max(1, Math.ceil(((mine[0] as number) + 60_000 - t) / 1000)); }
    mine.push(t);
    hits.set(source, mine);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((at) => at > t - 60_000)) hits.delete(k);
    return 0;
  }

  function reply(res: http.ServerResponse, code: ErrorCode, status: number, message?: string, extra: Record<string, string> = {}): void {
    const body = JSON.stringify({ error: makeError(code, TRACE, message ? { message } : {}) });
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...extra });
    res.end(body);
  }

  function callerOf(req: http.IncomingMessage): { caller: PageCaller; source: string } {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
    headers["x-vyre-remote"] = req.socket.remoteAddress ?? "";
    const source = sourceOf(headers);
    return { caller: { kind: "actor", id: `act_anon_${sha256Hex(source).slice(0, 16)}` }, source };
  }

  async function page(req: http.IncomingMessage, res: http.ServerResponse, method: string, kind: "f" | "book", slug: string, query: URLSearchParams): Promise<void> {
    const { caller, source } = callerOf(req);
    const wait = allowed(source);
    if (wait > 0) return reply(res, "rate_limit.exceeded", 429, "Too many page views just now. Try again in a minute.", { "retry-after": String(wait) });
    const view = await deps.read(slug, kind === "f" ? "form" : "booking", caller);
    if (!view) return reply(res, "validation.not_found", 404, "That form is not open.");
    let link: LinkQuestions | null = null;
    const token = query.get("t") ?? undefined;
    if (view.kind === "one_use" || token !== undefined) {
      if (token === undefined || !deps.link) return reply(res, "auth.invalid_code", 403, "This form opens only from the link that was sent to you.");
      link = await deps.link(slug, token, caller);
      if (!link) return reply(res, "auth.invalid_code", 403, "This link is not valid any more. Ask for a new one.");
    }
    const nonce = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64");
    const html = renderFormPage({ view, page: kind === "f" ? "form" : "booking", nonce, captcha: deps.captcha, uploads: deps.upload !== undefined, link, token });
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html), "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": policyHeader(nonce, view.captcha ? deps.captcha : undefined), "referrer-policy": "strict-origin-when-cross-origin",
    });
    res.end(method === "HEAD" ? undefined : html);
  }

  async function upload(req: http.IncomingMessage, res: http.ServerResponse, slug: string): Promise<void> {
    const { caller, source } = callerOf(req);
    const wait = allowed(source);
    if (wait > 0) return reply(res, "rate_limit.exceeded", 429, "Too many uploads just now. Try again in a minute.", { "retry-after": String(wait) });
    const view = await deps.read(slug, "form", caller);
    if (!view || !deps.upload || !view.upload?.folderId) return reply(res, "validation.not_found", 404, "That form is not open.");
    const policy = view.upload;
    const cap = Math.min(policy?.maxBytes ?? UPLOAD_CAP, UPLOAD_CAP);
    const declared = Number(req.headers["content-length"] ?? "NaN");
    if (Number.isFinite(declared) && declared > cap) return reply(res, "validation.too_large", 413, `That file is over the ${Math.floor(cap / 1024)} KB limit.`);
    let name = "upload";
    try { name = decodeURIComponent(String(req.headers["x-file-name"] ?? "upload")).replace(/[\\/\0]/g, "_").slice(0, 200) || "upload"; } catch { /* keep the default */ }
    const type = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
    if (policy && !typeAllowed(policy.types, type, name)) return reply(res, "validation.bad_input", 415, "That kind of file is not accepted here.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > cap) { req.destroy(); return reply(res, "validation.too_large", 413, `That file is over the ${Math.floor(cap / 1024)} KB limit.`); }
      chunks.push(c as Buffer);
    }
    if (size === 0) return reply(res, "validation.bad_input", 400, "That file is empty.");
    const fileId = await deps.upload(slug, { name, type, bytes: new Uint8Array(Buffer.concat(chunks)), folderId: view.upload.folderId }, caller);
    const body = JSON.stringify({ data: { fileId } });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
    res.end(body);
  }

  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://vyred");
      const method = (req.method ?? "GET").toUpperCase();
      const up = UPLOAD.exec(url.pathname);
      const m = PAGE.exec(url.pathname);
      if (!up && !m) return false;
      if (m && RESERVED.has(m[2] as string)) return false;
      const fail500 = (): void => { if (!res.headersSent) reply(res, "internal.unexpected", 500); else res.end(); };
      if (up) {
        if (method !== "POST") { reply(res, "validation.bad_input", 405, "Files are sent with POST.", { allow: "POST" }); return true; }
        void upload(req, res, up[1] as string).catch(fail500);
        return true;
      }
      if (method !== "GET" && method !== "HEAD") {
        // POST /f/submit and /book/create are the gateway's; only the page's own address is refused here
        reply(res, "validation.bad_input", 405, "This address is read with GET.", { allow: "GET, HEAD" });
        return true;
      }
      void page(req, res, method, (m as RegExpExecArray)[1] as "f" | "book", (m as RegExpExecArray)[2] as string, url.searchParams).catch(fail500);
      return true;
    },
  };
}
