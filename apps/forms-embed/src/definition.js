// @ts-check
// The form definition the renderer draws (spec 2.11; ARCH 7.6). The host builds it for a published form from forms.get (the field modes, theme and logic), the record type's
// fields (label, type, options, required) and the form's settings (consent text, captcha, upload policy, thank-you), and puts it in the page as JSON. This file is the
// contract of that JSON: parseDefinition checks it and returns a normalised copy, or every problem as a sentence naming the path. Nothing else in the bundle trusts its input.
//
// field.mode: ask (the visitor fills it), show (read-only text), hide (never drawn). field.step groups fields into steps; no step means step 0.
// logic: { rules: [{ if: Cond, then: Action[] }] }
//   Cond   = { field, op, value? } | { all: Cond[] } | { any: Cond[] } | { not: Cond }       op: eq ne in contains gt gte lt lte empty notempty
//   Action = { show: string[] } | { hide: string[] } | { require: string[] } | { skipToStep: number }
//   A field named in any `show` action is hidden until a rule that shows it matches; `hide` hides it while its rule matches; `require` makes it required while its rule
//   matches; `skipToStep` jumps forward to that step when Next is pressed from a step and the rule matches.

export const KINDS = ["public", "one_use", "survey"];
export const MODES = ["ask", "show", "hide"];
export const TYPES = ["text", "longtext", "email", "phone", "number", "money", "date", "datetime", "url", "choice", "multichoice", "checkbox", "rating", "files", "sealed"];
export const OPS = ["eq", "ne", "in", "contains", "gt", "gte", "lt", "lte", "empty", "notempty"];
export const SKINS = ["paper", "dusk"];

const KEY = /^[a-z][a-z0-9_]*$/;
const SLUG = /^[a-z0-9-]+$/;

/**
 * @typedef {{ value: string, label: string }} Option
 * @typedef {{
 *   field: string, mode: "ask" | "show" | "hide", type: string, label: string, step: number, required: boolean,
 *   help?: string, placeholder?: string, prefillKey?: string, options?: Option[], min?: number, max?: number, maxLength?: number, value?: unknown
 * }} Field
 * @typedef {{ field: string, op: string, value?: unknown } | { all: Cond[] } | { any: Cond[] } | { not: Cond }} Cond
 * @typedef {{ show?: string[], hide?: string[], require?: string[], skipToStep?: number }} Action
 * @typedef {{ rules: { if: Cond, then: Action[] }[] }} Logic
 * @typedef {{
 *   skin?: string, accent?: string, background?: string, ink?: string, radius?: number, font?: string, cover?: string, logo?: string, width?: number
 * }} Theme
 * @typedef {{
 *   slug: string, name: string, kind: string, fields: Field[], logic: Logic, theme: Theme, css: string, intro?: string,
 *   thankYou: { text?: string, redirect?: string }, consentText?: string, captcha?: { siteKey: string }, uploadPolicy: { maxBytes: number, types: string[], max: number },
 *   submitLabel: string, token?: string, partial?: { answers: Record<string, unknown>, step: number }
 * }} FormDefinition
 */

export const FONTS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
};

const isObj = (/** @type {unknown} */ v) => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : undefined);
const isHttps = (/** @type {unknown} */ v) => { try { return typeof v === "string" && new URL(v).protocol === "https:"; } catch { return false; } };
const hex = (/** @type {unknown} */ v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);

/** A path on this site or a full https address; anything else (javascript:, data:, a protocol-relative address) is refused. */
export function safeRedirect(/** @type {unknown} */ v) {
  if (typeof v !== "string" || v.length === 0 || v.length > 2000) return undefined;
  if (v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")) return v;
  return isHttps(v) ? v : undefined;
}

/**
 * @param {unknown} raw
 * @returns {{ def: FormDefinition, problems: [] } | { def: null, problems: string[] }}
 */
export function parseDefinition(raw) {
  /** @type {string[]} */
  const problems = [];
  const bad = (/** @type {string} */ path, /** @type {string} */ message) => { problems.push(`${path}: ${message}`); };
  if (!isObj(raw)) return { def: null, problems: ["a form definition is an object"] };
  const r = /** @type {Record<string, any>} */ (raw);
  if (typeof r.slug !== "string" || !SLUG.test(r.slug)) bad("slug", "lowercase letters, digits and dashes");
  if (!text(r.name, 200)) bad("name", "a name of 1 to 200 characters");
  if (!KINDS.includes(r.kind)) bad("kind", "public, one_use or survey");

  /** @type {Field[]} */
  const fields = [];
  if (!Array.isArray(r.fields) || r.fields.length === 0 || r.fields.length > 200) bad("fields", "1 to 200 fields");
  else {
    const seen = new Set();
    r.fields.forEach((/** @type {any} */ f, /** @type {number} */ i) => {
      const at = `fields[${i}]`;
      if (!isObj(f)) { bad(at, "a field is an object"); return; }
      if (typeof f.field !== "string" || !KEY.test(f.field)) { bad(`${at}.field`, "lowercase letters, digits and underscores"); return; }
      if (seen.has(f.field)) { bad(`${at}.field`, `${f.field} is used twice`); return; }
      seen.add(f.field);
      const mode = f.mode ?? "ask";
      if (!MODES.includes(mode)) { bad(`${at}.mode`, "ask, show or hide"); return; }
      const type = f.type ?? "text";
      if (!TYPES.includes(type)) { bad(`${at}.type`, `one of ${TYPES.join(", ")}`); return; }
      const label = text(f.label, 200);
      if (!label && mode !== "hide") { bad(`${at}.label`, "a label of 1 to 200 characters"); return; }
      const step = f.step === undefined || f.step === null ? 0 : f.step;
      if (!Number.isInteger(step) || step < 0 || step > 100) { bad(`${at}.step`, "a whole number from 0 to 100"); return; }
      /** @type {Field} */
      const out = { field: f.field, mode, type, label: label ?? f.field, step, required: f.required === true };
      if (text(f.help, 500)) out.help = f.help;
      if (text(f.placeholder, 200)) out.placeholder = f.placeholder;
      if (f.prefillKey !== undefined && f.prefillKey !== null) {
        if (typeof f.prefillKey !== "string" || !KEY.test(f.prefillKey)) { bad(`${at}.prefillKey`, "lowercase letters, digits and underscores"); return; }
        out.prefillKey = f.prefillKey;
      }
      if (type === "choice" || type === "multichoice") {
        if (!Array.isArray(f.options) || f.options.length === 0 || f.options.length > 200 || !f.options.every((/** @type {any} */ o) => isObj(o) && typeof o.value === "string" && o.value.length > 0 && o.value.length <= 200 && text(o.label ?? o.value, 200))) { bad(`${at}.options`, "1 to 200 options with a value and a label"); return; }
        out.options = f.options.map((/** @type {any} */ o) => ({ value: o.value, label: o.label ?? o.value }));
      }
      for (const k of /** @type {const} */ (["min", "max", "maxLength"])) {
        if (f[k] === undefined || f[k] === null) continue;
        if (typeof f[k] !== "number" || !Number.isFinite(f[k])) { bad(`${at}.${k}`, "a number"); return; }
        out[k] = f[k];
      }
      if (mode === "show") out.value = f.value;
      fields.push(out);
    });
  }

  /** @type {Logic} */
  const logic = { rules: [] };
  if (r.logic !== undefined && r.logic !== null) {
    if (!isObj(r.logic) || !Array.isArray(r.logic.rules) || r.logic.rules.length > 200) bad("logic", "{ rules: [...] } with at most 200 rules");
    else {
      const names = new Set(fields.map(f => f.field));
      const cond = (/** @type {any} */ c, /** @type {string} */ at, /** @type {number} */ depth) => {
        if (depth > 8 || !isObj(c)) { bad(at, "a condition"); return false; }
        if (Array.isArray(c.all) || Array.isArray(c.any)) {
          const list = c.all ?? c.any;
          if (list.length === 0 || list.length > 50) { bad(at, "1 to 50 conditions"); return false; }
          return list.every((/** @type {any} */ x, /** @type {number} */ i) => cond(x, `${at}.${c.all ? "all" : "any"}[${i}]`, depth + 1));
        }
        if (c.not !== undefined) return cond(c.not, `${at}.not`, depth + 1);
        if (typeof c.field !== "string" || !names.has(c.field)) { bad(`${at}.field`, "names a field of this form"); return false; }
        if (!OPS.includes(c.op)) { bad(`${at}.op`, OPS.join(", ")); return false; }
        return true;
      };
      r.logic.rules.forEach((/** @type {any} */ rule, /** @type {number} */ i) => {
        const at = `logic.rules[${i}]`;
        if (!isObj(rule) || !Array.isArray(rule.then) || rule.then.length === 0) { bad(at, "a rule has if and a list of then actions"); return; }
        if (!cond(rule.if, `${at}.if`, 0)) return;
        /** @type {Action[]} */
        const then = [];
        for (const [j, a] of rule.then.entries()) {
          const ap = `${at}.then[${j}]`;
          if (!isObj(a)) { bad(ap, "an action is an object"); continue; }
          /** @type {Action} */
          const act = {};
          for (const k of /** @type {const} */ (["show", "hide", "require"])) {
            if (a[k] === undefined) continue;
            if (!Array.isArray(a[k]) || a[k].length === 0 || !a[k].every((/** @type {any} */ n) => typeof n === "string" && names.has(n))) { bad(`${ap}.${k}`, "names fields of this form"); continue; }
            act[k] = a[k];
          }
          if (a.skipToStep !== undefined) {
            if (!Number.isInteger(a.skipToStep) || a.skipToStep < 0 || a.skipToStep > 100) bad(`${ap}.skipToStep`, "a whole number from 0 to 100");
            else act.skipToStep = a.skipToStep;
          }
          if (Object.keys(act).length === 0) bad(ap, "show, hide, require or skipToStep");
          else then.push(act);
        }
        if (then.length > 0) logic.rules.push({ if: rule.if, then });
      });
    }
  }

  /** @type {Theme} */
  const theme = {};
  if (r.theme !== undefined && r.theme !== null) {
    if (!isObj(r.theme)) bad("theme", "an object");
    else {
      const t = /** @type {Record<string, any>} */ (r.theme);
      if (t.skin !== undefined) { if (SKINS.includes(t.skin)) theme.skin = t.skin; else bad("theme.skin", SKINS.join(" or ")); }
      for (const k of /** @type {const} */ (["accent", "background", "ink"])) {
        if (t[k] === undefined) continue;
        const h = hex(t[k]);
        if (h) theme[k] = h; else bad(`theme.${k}`, "a colour such as #5b5bd6");
      }
      if (t.radius !== undefined) { if (typeof t.radius === "number" && t.radius >= 0 && t.radius <= 32) theme.radius = t.radius; else bad("theme.radius", "a number from 0 to 32"); }
      if (t.width !== undefined) { if (typeof t.width === "number" && t.width >= 320 && t.width <= 960) theme.width = t.width; else bad("theme.width", "a number from 320 to 960"); }
      if (t.font !== undefined) { if (typeof t.font === "string" && Object.hasOwn(FONTS, t.font)) theme.font = t.font; else bad("theme.font", Object.keys(FONTS).join(", ")); }
      for (const k of /** @type {const} */ (["cover", "logo"])) {
        if (t[k] === undefined) continue;
        if (isHttps(t[k]) || (typeof t[k] === "string" && t[k].startsWith("/") && !t[k].startsWith("//"))) theme[k] = t[k]; else bad(`theme.${k}`, "an https address or a path on this site");
      }
    }
  }

  /** @type {FormDefinition["thankYou"]} */
  const thankYou = {};
  if (r.thankYou !== undefined && r.thankYou !== null) {
    if (!isObj(r.thankYou)) bad("thankYou", "{ text, redirect }");
    else {
      if (r.thankYou.text !== undefined) { if (text(r.thankYou.text, 5000)) thankYou.text = r.thankYou.text; else bad("thankYou.text", "text of at most 5000 characters"); }
      if (r.thankYou.redirect !== undefined) { const s = safeRedirect(r.thankYou.redirect); if (s) thankYou.redirect = s; else bad("thankYou.redirect", "a path on this site or a full https address"); }
    }
  }

  const policy = isObj(r.uploadPolicy) ? r.uploadPolicy : {};
  const uploadPolicy = {
    maxBytes: typeof policy.maxBytes === "number" && policy.maxBytes > 0 ? Math.min(policy.maxBytes, 100 * 1024 * 1024) : 10 * 1024 * 1024,
    types: Array.isArray(policy.types) ? policy.types.filter((/** @type {unknown} */ x) => typeof x === "string" && /^[a-z0-9.*\/+-]{1,100}$/i.test(x)) : [],
    max: typeof policy.max === "number" && Number.isInteger(policy.max) && policy.max > 0 ? Math.min(policy.max, 20) : 5,
  };

  if (problems.length > 0) return { def: null, problems };
  /** @type {FormDefinition} */
  const def = {
    slug: r.slug, name: r.name, kind: r.kind, fields, logic, theme, css: typeof r.css === "string" ? r.css.slice(0, 20_000) : "", thankYou, uploadPolicy,
    submitLabel: text(r.submitLabel, 60) ?? "Send",
  };
  if (text(r.intro, 2000)) def.intro = r.intro;
  if (text(r.consentText, 2000)) def.consentText = r.consentText;
  if (isObj(r.captcha) && text(r.captcha.siteKey, 200)) def.captcha = { siteKey: r.captcha.siteKey };
  else if (r.captcha === true) def.captcha = { siteKey: "" };
  if (typeof r.token === "string" && r.token.length > 0 && r.token.length <= 500) def.token = r.token;
  if (isObj(r.partial) && isObj(r.partial.answers)) def.partial = { answers: /** @type {Record<string, unknown>} */ (r.partial.answers), step: Number.isInteger(r.partial.step) && r.partial.step >= 0 ? r.partial.step : 0 };
  return { def, problems: [] };
}
