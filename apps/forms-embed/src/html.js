// @ts-check
// Drawing the form (spec 2.11): renderForm turns a definition and the controller's state into HTML for the current step; renderDocument wraps the first render, the styles and the
// bootstrap script into the page the host serves. Strings only, so the host can render on the server and the browser can render again on every change; every value that came from
// a person or from the form author is escaped.

import { fieldsOfStep, nextStep, stepList } from "./steps.js";
import { skinFor, styleSheet } from "./theme.js";

/** @typedef {import("./definition.js").FormDefinition} FormDefinition @typedef {import("./definition.js").Field} Field */
/**
 * @typedef {{
 *   status: "editing" | "sending" | "done", step: number, history: number[], answers: Record<string, unknown>, errors: Record<string, string>,
 *   banner?: string, consent: boolean, captcha?: string, thanks?: { text?: string, redirect?: string }
 * }} State
 */

const ENTITIES = /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
export const esc = (/** @type {unknown} */ v) => String(v ?? "").replace(/[&<>"']/g, c => /** @type {string} */ (ENTITIES[c]));

const id = (/** @type {string} */ f) => `vf-${f}`;

/** @param {Field} f @param {unknown} v @param {string | undefined} error */
function control(f, v, error) {
  const describedBy = [f.help ? `${id(f.field)}-help` : "", error ? `${id(f.field)}-err` : ""].filter(Boolean).join(" ");
  const common = `id="${id(f.field)}" name="${esc(f.field)}"${f.required ? " required" : ""}${error ? ' aria-invalid="true"' : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""}`;
  const val = v === undefined || v === null ? "" : String(v);
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
  const ml = f.maxLength ? ` maxlength="${Math.floor(f.maxLength)}"` : "";
  switch (f.type) {
    case "longtext": return `<textarea class="vf-textarea" ${common}${ph}${ml} rows="5">${esc(val)}</textarea>`;
    case "email": return `<input class="vf-input" type="email" autocomplete="email" inputmode="email" ${common}${ph} value="${esc(val)}">`;
    case "phone": return `<input class="vf-input" type="tel" autocomplete="tel" inputmode="tel" ${common}${ph} value="${esc(val)}">`;
    case "number": case "money":
      return `<input class="vf-input" type="number" inputmode="decimal" step="${f.type === "money" ? "0.01" : "any"}"${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""} ${common}${ph} value="${esc(val)}">`;
    case "date": return `<input class="vf-input" type="date" ${common} value="${esc(val)}">`;
    case "datetime": return `<input class="vf-input" type="datetime-local" ${common} value="${esc(val)}">`;
    case "url": return `<input class="vf-input" type="url" inputmode="url" ${common}${ph} value="${esc(val)}">`;
    case "sealed": return `<input class="vf-input" type="password" autocomplete="off" spellcheck="false" ${common}${ph} value="${esc(val)}">`;
    case "files": return `<input class="vf-input" type="file" multiple ${common}>`;
    case "choice": {
      const opts = f.options ?? [];
      if (opts.length > 6) return `<select class="vf-select" ${common}><option value="">Choose</option>${opts.map(o => `<option value="${esc(o.value)}"${o.value === val ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
      return `<div class="vf-opts" role="radiogroup" aria-labelledby="${id(f.field)}-label"${error ? ' aria-invalid="true"' : ""}>${opts.map((o, i) => `<label class="vf-opt"><input type="radio" name="${esc(f.field)}" id="${id(f.field)}-${i}" value="${esc(o.value)}"${o.value === val ? " checked" : ""}><span>${esc(o.label)}</span></label>`).join("")}</div>`;
    }
    case "multichoice": {
      const picked = Array.isArray(v) ? v.map(String) : [];
      return `<div class="vf-opts" role="group" aria-labelledby="${id(f.field)}-label"${error ? ' aria-invalid="true"' : ""}>${(f.options ?? []).map((o, i) => `<label class="vf-opt"><input type="checkbox" name="${esc(f.field)}" id="${id(f.field)}-${i}" value="${esc(o.value)}"${picked.includes(o.value) ? " checked" : ""}><span>${esc(o.label)}</span></label>`).join("")}</div>`;
    }
    case "checkbox": return `<label class="vf-opt"><input type="checkbox" ${common} value="true"${v === true ? " checked" : ""}><span>${esc(f.placeholder ?? f.label)}</span></label>`;
    case "rating": {
      const lo = f.min ?? 1, hi = Math.min(f.max ?? 5, 10);
      const items = [];
      for (let n = lo; n <= hi; n++) items.push(`<label class="vf-opt"><input type="radio" name="${esc(f.field)}" id="${id(f.field)}-${n}" value="${n}"${String(n) === val ? " checked" : ""}><span>${n}</span></label>`);
      return `<div class="vf-rating" role="radiogroup" aria-labelledby="${id(f.field)}-label"${error ? ' aria-invalid="true"' : ""}>${items.join("")}</div>`;
    }
    default: return `<input class="vf-input" type="text" autocomplete="off" ${common}${ph}${ml} value="${esc(val)}">`;
  }
}

/** @param {Field} f @param {State} s @param {boolean} required */
function fieldHtml(f, s, required) {
  const error = s.errors[f.field];
  if (f.mode === "show") {
    return `<div class="vf-field" data-field="${esc(f.field)}"><span class="vf-label">${esc(f.label)}</span><div class="vf-show">${esc(f.value ?? s.answers[f.field] ?? "")}</div></div>`;
  }
  const grouped = f.type === "choice" && (f.options ?? []).length <= 6 || f.type === "multichoice" || f.type === "rating";
  const label = f.type === "checkbox" ? "" : `<${grouped ? "span" : "label"} class="vf-label" id="${id(f.field)}-label"${grouped ? "" : ` for="${id(f.field)}"`}>${esc(f.label)}${required ? "" : ' <span class="vf-req">(optional)</span>'}</${grouped ? "span" : "label"}>`;
  return `<div class="vf-field" data-field="${esc(f.field)}">${label}${control({ ...f, required }, s.answers[f.field], error)}${f.help ? `<p class="vf-help" id="${id(f.field)}-help">${esc(f.help)}</p>` : ""}${error ? `<p class="vf-error" id="${id(f.field)}-err" role="alert">${esc(error)}</p>` : ""}</div>`;
}

/** The form for the current step, or the thank-you once it is sent. @param {FormDefinition} def @param {State} s @param {Set<string>} [requiredNow] */
export function renderForm(def, s, requiredNow = new Set(def.fields.filter(f => f.required).map(f => f.field))) {
  const head = `${def.theme.cover ? `<img class="vf-cover" src="${esc(def.theme.cover)}" alt="">` : ""}${def.theme.logo ? `<img class="vf-logo" src="${esc(def.theme.logo)}" alt="">` : ""}<header class="vf-head"><h1 class="vf-title" id="vf-title">${esc(def.name)}</h1>${def.intro && s.status !== "done" ? `<p class="vf-intro">${esc(def.intro)}</p>` : ""}</header>`;
  if (s.status === "done") {
    const t = s.thanks ?? {};
    const link = t.redirect ? `<p><a href="${esc(t.redirect)}">Continue</a></p>` : "";
    return `<div class="vf-wrap" data-status="done">${head}<div class="vf-thanks" role="status" tabindex="-1" id="vf-thanks"><h2>Thank you</h2>${t.text ? `<p>${esc(t.text)}</p>` : "<p>Your answers were sent.</p>"}${link}</div></div>`;
  }
  const steps = stepList(def, s.answers);
  const at = Math.max(0, steps.indexOf(s.step));
  const fields = fieldsOfStep(def, s.answers, s.step);
  const last = nextStep(def, s.answers, s.step) === null;
  const progress = steps.length > 1
    ? `<ol class="vf-progress" aria-label="Progress">${steps.map((n, i) => `<li data-state="${i < at ? "done" : i === at ? "now" : "todo"}"${i === at ? ' aria-current="step"' : ""}><span class="vf-sr">Step ${i + 1}</span></li>`).join("")}</ol><p class="vf-step-label">Step ${at + 1} of ${steps.length}</p>`
    : "";
  const consent = last && def.consentText
    ? `<div class="vf-consent${s.errors.consent ? " vf-has-error" : ""}"><label class="vf-opt"><input type="checkbox" id="vf-consent" name="consent" value="true"${s.consent ? " checked" : ""}${s.errors.consent ? ' aria-invalid="true" aria-describedby="vf-consent-err"' : ""}><span>${esc(def.consentText)}</span></label>${s.errors.consent ? `<p class="vf-error" id="vf-consent-err" role="alert">${esc(s.errors.consent)}</p>` : ""}</div>`
    : "";
  const captcha = last && def.captcha ? `<div class="vf-captcha" id="vf-captcha" data-sitekey="${esc(def.captcha.siteKey)}">${s.errors.captcha ? `<p class="vf-error" role="alert">${esc(s.errors.captcha)}</p>` : ""}</div>` : "";
  const sending = s.status === "sending";
  const back = s.history.length > 0 ? `<button class="vf-btn" type="button" data-action="back"${sending ? " disabled" : ""}>Back</button>` : "<span></span>";
  const primary = last ? `<button class="vf-btn" type="submit" data-primary data-action="submit"${sending ? " disabled" : ""}>${sending ? "Sending" : esc(def.submitLabel)}</button>` : `<button class="vf-btn" type="submit" data-primary data-action="next">Next</button>`;
  const banner = s.banner ? `<div class="vf-banner" role="alert">${esc(s.banner)}</div>` : "";
  return `<div class="vf-wrap" data-status="${s.status}">${head}<form class="vf-form" novalidate aria-labelledby="vf-title" data-step="${s.step}">${banner}${progress}${fields.map(f => fieldHtml(f, s, requiredNow.has(f.field))).join("")}${consent}${captcha}<div class="vf-actions">${back}${primary}</div></form></div>`;
}

/** JSON that is safe inside a script element. */
export function safeJson(/** @type {unknown} */ v) {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The headers' policy for the page: scripts and styles only by nonce, images over https, answers back to the same site, framing allowed (a form is an embed). */
export function contentSecurityPolicy(/** @type {{ nonce: string, captchaHosts?: string[] }} */ o) {
  const extra = (o.captchaHosts ?? []).filter(h => /^https:\/\/[a-z0-9.-]+$/i.test(h)).join(" ");
  return [
    "default-src 'none'", `script-src 'self' 'nonce-${o.nonce}'${extra ? ` ${extra}` : ""}`, `style-src 'nonce-${o.nonce}'`, "img-src 'self' https: data:", "font-src 'self' https:",
    "connect-src 'self'", `frame-src ${extra || "'none'"}`, "form-action 'self'", "base-uri 'none'", "frame-ancestors *",
  ].join("; ");
}

/**
 * The page the host serves at /f/<slug>. The first render is in the page so the form is there before the script runs; the script takes it over.
 * @param {FormDefinition} def @param {{ scriptUrl: string, nonce: string }} o
 */
export function renderDocument(def, o) {
  const skin = skinFor(def.theme.skin);
  const first = renderForm(def, { status: "editing", step: stepList(def, {})[0] ?? 0, history: [], answers: {}, errors: {}, consent: false });
  return `<!doctype html><html lang="en" data-skin="${skin}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="${skin === "dusk" ? "dark" : "light"}"><title>${esc(def.name)}</title><style nonce="${esc(o.nonce)}">${styleSheet(def)}</style></head><body><div id="vyre-form-root">${first}</div><noscript><p class="vf-wrap">This form needs JavaScript to send your answers.</p></noscript><script type="application/json" id="vyre-form">${safeJson(def)}</script><script type="module" src="${esc(o.scriptUrl)}" nonce="${esc(o.nonce)}"></script></body></html>`;
}
