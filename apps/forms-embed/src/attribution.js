// @ts-check
// What the URL and the browser tell the form (spec 2.11): prefill and hide by URL key, and attribution (UTMs, click ids, referrer, landing page, device, time zone) that is
// captured with no setup and is consent-aware. Without consent only the UTMs and the referrer's host are sent, which is also all the server keeps (forms.submit).

import { fieldError } from "./steps.js";

/** @typedef {import("./definition.js").FormDefinition} FormDefinition */

export const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "twclid", "li_fat_id", "dclid"];
const clip = (/** @type {string} */ s, n = 500) => s.trim().slice(0, n);

/**
 * `?<key>=value` fills the field whose prefillKey (or field name) is key, when the value is valid for that field; `?hide=a,b` hides those fields from the page while keeping
 * their prefilled values in what is sent. Unknown keys, values that fail the field's own check and values for fields the form shows read-only are ignored.
 * @param {string} search @param {FormDefinition} def
 * @returns {{ prefill: Record<string, unknown>, hide: Set<string> }}
 */
export function readUrlKeys(search, def) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  /** @type {Record<string, unknown>} */
  const prefill = {};
  for (const f of def.fields) {
    if (f.mode !== "ask") continue;
    const key = f.prefillKey ?? f.field;
    if (!params.has(key)) continue;
    const all = params.getAll(key);
    /** @type {unknown} */
    let v = f.type === "multichoice" ? all.flatMap(x => x.split(",")).map(x => x.trim()).filter(Boolean) : all[0];
    if (f.type === "checkbox") v = all[0] === "true" || all[0] === "1";
    if ((f.type === "number" || f.type === "money" || f.type === "rating") && typeof v === "string" && v.trim() !== "") v = Number(v);
    if (f.type === "files" || f.type === "sealed") continue;
    if (v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (fieldError(f, v, false, def) === null) prefill[f.field] = v;
  }
  /** @type {Set<string>} */
  const hide = new Set();
  const names = clip(params.get("hide") ?? "", 2000).split(",").map(x => x.trim()).filter(Boolean);
  for (const f of def.fields) if (f.mode === "ask" && (names.includes(f.prefillKey ?? "") || names.includes(f.field)) && f.field in prefill) hide.add(f.field);
  return { prefill, hide };
}

/** mobile, tablet or desktop from the user agent. */
export function deviceClass(/** @type {string} */ ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * @param {{ search: string, referrer: string, href: string, userAgent: string, timeZone?: string, consent: boolean }} o
 * @returns {Record<string, unknown>}
 */
export function captureAttribution(o) {
  const params = new URLSearchParams(o.search.startsWith("?") ? o.search.slice(1) : o.search);
  /** @type {Record<string, unknown>} */
  const out = { consent: o.consent };
  for (const [from, to] of /** @type {const} */ ([["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"]])) {
    const v = params.get(from);
    if (v && clip(v)) out[to] = clip(v);
  }
  if (o.referrer) {
    try {
      const u = new URL(o.referrer);
      // without consent only the host of the referring site; with consent the address without its query or fragment
      out.referrer = o.consent ? `${u.origin}${u.pathname}`.slice(0, 500) : u.hostname;
    } catch { /* not an address */ }
  }
  if (!o.consent) return out;
  try {
    const u = new URL(o.href);
    out.landingPage = `${u.origin}${u.pathname}`.slice(0, 500);
  } catch { /* not an address */ }
  /** @type {Record<string, string>} */
  const ids = {};
  for (const k of CLICK_IDS) { const v = params.get(k); if (v && clip(v, 200)) ids[k] = clip(v, 200); }
  if (Object.keys(ids).length > 0) out.clickIds = ids;
  out.device = deviceClass(o.userAgent);
  if (o.timeZone) out.location = clip(o.timeZone, 100);
  return out;
}
