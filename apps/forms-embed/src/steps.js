// @ts-check
// Steps and validation (spec 2.11): fields group into steps; a step is shown only while it has a visible field; Next skips empty steps and follows a matching skipToStep rule
// forward; each step validates before Next, and the whole form validates before it is sent. Only visible, asked fields are ever sent.

import { resolve } from "./logic.js";

/** @typedef {import("./definition.js").FormDefinition} FormDefinition @typedef {import("./definition.js").Field} Field */

const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
export const TEXT_MAX = 5000;
export const SHORT_MAX = 500;

/** The step numbers that have at least one visible field, in order. @param {FormDefinition} def @param {Record<string, unknown>} answers */
export function stepList(def, answers) {
  const { visible } = resolve(def, answers);
  return [...new Set(def.fields.filter(f => visible.has(f.field)).map(f => f.step))].sort((a, b) => a - b);
}

/** The visible fields of one step, in the order they were defined. */
export function fieldsOfStep(/** @type {FormDefinition} */ def, /** @type {Record<string, unknown>} */ answers, /** @type {number} */ step) {
  const { visible } = resolve(def, answers);
  return def.fields.filter(f => f.step === step && visible.has(f.field));
}

/**
 * The step after `from`: the target of a matching skipToStep rule when it is ahead, else the next step that has a visible field; null after the last.
 * @returns {number | null}
 */
export function nextStep(/** @type {FormDefinition} */ def, /** @type {Record<string, unknown>} */ answers, /** @type {number} */ from) {
  const steps = stepList(def, answers).filter(s => s > from);
  if (steps.length === 0) return null;
  const { skips } = resolve(def, answers);
  const jump = skips.filter(s => s > from).sort((a, b) => a - b)[0];
  if (jump !== undefined) {
    const landing = steps.find(s => s >= jump);
    return landing === undefined ? null : landing;
  }
  return steps[0] ?? null;
}

/** The step before `from` that has a visible field, or null. */
export function prevStep(/** @type {FormDefinition} */ def, /** @type {Record<string, unknown>} */ answers, /** @type {number} */ from, /** @type {number[]} */ history = []) {
  const earlier = history.filter(s => s < from);
  if (earlier.length > 0) return /** @type {number} */ (earlier[earlier.length - 1]);
  const steps = stepList(def, answers).filter(s => s < from);
  return steps.length > 0 ? /** @type {number} */ (steps[steps.length - 1]) : null;
}

const humanSize = (/** @type {number} */ n) => (n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isEmpty = (/** @type {unknown} */ v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** One field's error sentence, or null. @param {Field} f @param {unknown} v @param {boolean} required @param {FormDefinition} def */
export function fieldError(f, v, required, def) {
  if (isEmpty(v)) return required ? (f.type === "checkbox" ? "Please tick this box to continue." : "This is required.") : null;
  switch (f.type) {
    case "text": case "sealed":
      return typeof v === "string" && v.length <= (f.maxLength ?? SHORT_MAX) ? null : `Use at most ${f.maxLength ?? SHORT_MAX} characters.`;
    case "longtext":
      return typeof v === "string" && v.length <= (f.maxLength ?? TEXT_MAX) ? null : `Use at most ${f.maxLength ?? TEXT_MAX} characters.`;
    case "email":
      return typeof v === "string" && v.trim().length <= 254 && EMAIL.test(v.trim()) ? null : "That does not look like an email address.";
    case "phone":
      return typeof v === "string" && /^[+()\-.\s\d]{7,25}$/.test(v) && (v.match(/\d/g) ?? []).length >= 7 && (v.match(/\d/g) ?? []).length <= 15 ? null : "Enter a phone number with 7 to 15 digits.";
    case "number": case "money": case "rating": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || (typeof v === "string" && v.trim() === "")) return "Enter a number.";
      const lo = f.type === "rating" ? (f.min ?? 1) : f.min, hi = f.type === "rating" ? (f.max ?? 5) : f.max;
      if (f.type === "rating" && !Number.isInteger(n)) return "Choose a rating.";
      if (lo !== undefined && n < lo) return `Use ${lo} or more.`;
      if (hi !== undefined && n > hi) return `Use ${hi} or less.`;
      return null;
    }
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v) ? null : "Enter a date.";
    case "datetime":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? null : "Enter a date and time.";
    case "url":
      try { return typeof v === "string" && ["http:", "https:"].includes(new URL(v).protocol) && v.length <= 2000 ? null : "Enter a web address starting with https://."; } catch { return "Enter a web address starting with https://."; }
    case "choice":
      return typeof v === "string" && (f.options ?? []).some(o => o.value === v) ? null : "Choose one of the options.";
    case "multichoice":
      return Array.isArray(v) && v.every(x => (f.options ?? []).some(o => o.value === x)) && new Set(v).size === v.length ? null : "Choose from the options.";
    case "checkbox":
      return v === true || v === false ? null : "Tick or leave empty.";
    case "files": {
      const list = Array.isArray(v) ? v : [v];
      if (list.length > def.uploadPolicy.max) return `Attach at most ${def.uploadPolicy.max} files.`;
      for (const x of list) {
        if (typeof x !== "object" || x === null) return "Attach a file.";
        const file = /** @type {{ name?: unknown, size?: unknown, type?: unknown, fileId?: unknown }} */ (x);
        if (typeof file.fileId === "string") continue;
        if (typeof file.size === "number" && file.size > def.uploadPolicy.maxBytes) return `Each file can be at most ${humanSize(def.uploadPolicy.maxBytes)}.`;
        const types = def.uploadPolicy.types;
        if (types.length > 0 && !types.some(t => (t.endsWith("/*") ? String(file.type ?? "").startsWith(t.slice(0, -1)) : t.startsWith(".") ? String(file.name ?? "").toLowerCase().endsWith(t.toLowerCase()) : String(file.type ?? "") === t))) return "That kind of file is not accepted.";
      }
      return null;
    }
    default: return null;
  }
}

/**
 * Errors by field for the given fields (a step) or the whole form.
 * @returns {Record<string, string>}
 */
export function validate(/** @type {FormDefinition} */ def, /** @type {Record<string, unknown>} */ answers, /** @type {string[] | null} */ only = null) {
  const { visible, required } = resolve(def, answers);
  /** @type {Record<string, string>} */
  const errors = {};
  for (const f of def.fields) {
    if (f.mode !== "ask" || !visible.has(f.field) || (only && !only.includes(f.field))) continue;
    const e = fieldError(f, answers[f.field], required.has(f.field), def);
    if (e) errors[f.field] = e;
  }
  return errors;
}

/** The answers that are sent: asked, visible fields with a value. Text is trimmed; an empty checkbox is false; a hidden field is never sent. */
export function submission(/** @type {FormDefinition} */ def, /** @type {Record<string, unknown>} */ answers) {
  const { visible } = resolve(def, answers);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const f of def.fields) {
    if (f.mode !== "ask" || !visible.has(f.field)) continue;
    let v = answers[f.field];
    if (f.type === "checkbox") { out[f.field] = v === true; continue; }
    if (isEmpty(v)) continue;
    if (typeof v === "string") v = v.trim();
    if ((f.type === "number" || f.type === "money" || f.type === "rating") && typeof v === "string") v = Number(v);
    if (f.type === "files") {
      // the records API takes one file as { fileId } and several as a list of file ids
      const ids = (Array.isArray(v) ? v : [v]).map(x => String(/** @type {any} */ (x).fileId));
      v = ids.length === 1 ? { fileId: ids[0] } : ids;
    }
    out[f.field] = v;
  }
  return out;
}
