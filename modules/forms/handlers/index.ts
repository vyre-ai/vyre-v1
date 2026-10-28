// Handlers for the forms module (lane L8): form definitions here, then links.ts, submit.ts and bookings.ts.
// A form is a view of a record type: every input maps to a field with a mode (Ask, Show, Hide), an optional prefill key and a step.
// Definitions are owner calls (forms.publish permission is checked by the host). The public calls are in submit.ts, links.ts and bookings.ts.
// @reads ../migrations/0001_forms.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { FieldMode, FormKind } from "../projections.ts";
import {
  fail, fieldsOf, formOut, insertForm, isNull, isRec, many, mustForm, num, one, optBool, optInt, optStr, pageOf, parseJson, publicUrl, rec, reqStr, str,
} from "../projections.ts";
import { bookingHandlers } from "./bookings.ts";
import { linkHandlers } from "./links.ts";
import { submitHandlers } from "./submit.ts";

const KINDS: FormKind[] = ["public", "one_use", "booking", "survey"];
const MODES: FieldMode[] = ["ask", "show", "hide"];
const RECORD_TYPE = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const PREFILL_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const NAME_MAX = 120;
const CSS_MAX = 50_000;
const SECTIONS = ["personal", "shared", "space"];

function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function create(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const name = reqStr(ctx, o, "name").trim();
  const recordType = reqStr(ctx, o, "recordType");
  const kind = reqStr(ctx, o, "kind") as FormKind;
  if (name.length === 0 || name.length > NAME_MAX) fail(ctx, "validation.bad_input", "Give the form a name.", { field: "name" });
  if (!RECORD_TYPE.test(recordType)) fail(ctx, "validation.bad_input", "That record type is not valid.", { field: "recordType" });
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "That kind of form is not known.", { field: "kind" });
  if (kind === "booking") fail(ctx, "validation.precondition_failed", "Make a booking page with bookings.page_create.");
  const form = insertForm(ctx, { name, recordType, kind });
  ctx.emit("form.created", `form/${str(form.id)}`, { formId: str(form.id), name, kind });
  return { form: formOut(ctx, form) };
}

async function get(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const out: Record<string, unknown> = {
    form: formOut(ctx, form),
    settings: { consentText: str(form.consent_text), captcha: Number(form.captcha) === 1, rateLimit: Number(form.rate_limit), ...(parseJson(form.thank_you) ? { thankYou: parseJson(form.thank_you) } : {}) },
    fields: fieldsOf(ctx, str(form.id)).map((f) => {
      const row: Record<string, unknown> = { field: str(f.field), mode: str(f.mode) };
      if (!isNull(f.prefill_key)) row.prefillKey = str(f.prefill_key);
      if (!isNull(f.step)) row.step = Number(f.step);
      return row;
    }),
  };
  if (!isNull(form.css)) out.css = str(form.css);
  const theme = parseJson(form.theme);
  if (isRec(theme)) out.theme = theme;
  const logic = parseJson(form.logic);
  if (logic !== undefined) out.logic = logic;
  return out;
}

async function list(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const section = optStr(ctx, o, "section");
  const folderId = optStr(ctx, o, "folderId");
  if (section !== undefined && !SECTIONS.includes(section)) fail(ctx, "validation.bad_input", "That section is not known.", { field: "section" });
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM forms_form")
    .filter((r) => isNull(r.deleted_at) && (section === undefined || r.section === section) && (folderId === undefined || r.folder_id === folderId))
    .sort((a, b) => num(b.created_at) - num(a.created_at) || str(b.id).localeCompare(str(a.id)));
  const out: { forms: ReturnType<typeof formOut>[]; next?: string; total: number } = { forms: rows.slice(offset, offset + limit).map((r) => formOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function update(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const sets: [string, unknown][] = [];
  const name = optStr(ctx, o, "name");
  if (name !== undefined) {
    if (name.trim().length === 0 || name.length > NAME_MAX) fail(ctx, "validation.bad_input", "Give the form a name.", { field: "name" });
    sets.push(["name", name.trim()]);
  }
  if (o.matchRule !== undefined && o.matchRule !== null) {
    const m = o.matchRule;
    if (!Array.isArray(m) || m.length === 0 || m.length > 5 || !m.every((x) => typeof x === "string" && FIELD_NAME.test(x))) {
      fail(ctx, "validation.bad_input", "The match rule needs one to five field names.", { field: "matchRule" });
    }
    sets.push(["match_rule", JSON.stringify([...new Set(m as string[])])]);
  }
  const consent = optStr(ctx, o, "consentText");
  if (consent !== undefined) {
    if (consent.length > 2000) fail(ctx, "validation.too_large", "The consent text is too long.", { field: "consentText" });
    sets.push(["consent_text", consent.trim().length > 0 ? consent : null]);
  }
  const captcha = optBool(ctx, o, "captcha");
  if (captcha !== undefined) sets.push(["captcha", captcha ? 1 : 0]);
  if (o.uploadPolicy !== undefined && o.uploadPolicy !== null) {
    if (!isRec(o.uploadPolicy)) fail(ctx, "validation.bad_input", "The upload policy is not valid.", { field: "uploadPolicy" });
    sets.push(["upload_policy", JSON.stringify(o.uploadPolicy)]);
  }
  const rate = optInt(ctx, o, "rateLimit", 1, 10_000);
  if (rate !== undefined) sets.push(["rate_limit", rate]);
  if (sets.length > 0) {
    sets.push(["updated_at", ctx.now()]);
    ctx.db.run(`UPDATE forms_form SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`, ...sets.map(([, v]) => v), str(form.id));
  }
  return { form: formOut(ctx, mustForm(ctx, str(form.id))) };
}

async function fieldsSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const fields = o.fields;
  if (!Array.isArray(fields) || fields.length > 200) fail(ctx, "validation.bad_input", "The fields are not valid.", { field: "fields" });
  const seen = new Set<string>();
  const keys = new Set<string>();
  const rows = fields.map((f, i) => {
    if (!isRec(f)) fail(ctx, "validation.bad_input", "The fields are not valid.", { field: `fields.${i}` });
    const field = typeof f.field === "string" ? f.field : "";
    const mode = f.mode as FieldMode;
    if (!FIELD_NAME.test(field) || seen.has(field)) fail(ctx, "validation.bad_input", "Each field needs its own valid name.", { field: `fields.${i}.field` });
    if (!MODES.includes(mode)) fail(ctx, "validation.bad_input", "A field is Ask, Show or Hide.", { field: `fields.${i}.mode` });
    seen.add(field);
    let prefill: string | null = null;
    if (f.prefillKey !== undefined && f.prefillKey !== null) {
      if (typeof f.prefillKey !== "string" || !PREFILL_KEY.test(f.prefillKey) || keys.has(f.prefillKey)) {
        fail(ctx, "validation.bad_input", "A prefill key is lower case letters, digits and underscores, and used once.", { field: `fields.${i}.prefillKey` });
      }
      keys.add(f.prefillKey);
      prefill = f.prefillKey;
    }
    let step: number | null = null;
    if (f.step !== undefined && f.step !== null) {
      if (typeof f.step !== "number" || !Number.isInteger(f.step) || f.step < 0 || f.step > 100) fail(ctx, "validation.bad_input", "The step is not valid.", { field: `fields.${i}.step` });
      step = f.step;
    }
    return { field, mode, prefill, step, position: i };
  });
  if (form.kind === "booking" && !rows.some((r) => r.field === "email" && r.mode === "ask")) {
    fail(ctx, "validation.precondition_failed", "A booking page must ask for an email address.", { field: "fields" });
  }
  ctx.db.run("DELETE FROM forms_field WHERE form_id = ?", str(form.id));
  for (const r of rows) {
    ctx.db.run("INSERT INTO forms_field (form_id, field, mode, prefill_key, step, position) VALUES (?, ?, ?, ?, ?, ?)", str(form.id), r.field, r.mode, r.prefill, r.step, r.position);
  }
  ctx.db.run("UPDATE forms_form SET updated_at = ? WHERE id = ?", ctx.now(), str(form.id));
  return { ok: true };
}

function safeTarget(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]*$/.test(url);
}

async function designSet(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const sets: [string, unknown][] = [];
  if (o.theme !== undefined && o.theme !== null) {
    if (!isRec(o.theme)) fail(ctx, "validation.bad_input", "The theme is not valid.", { field: "theme" });
    sets.push(["theme", JSON.stringify(o.theme)]);
  }
  const css = optStr(ctx, o, "css");
  if (css !== undefined) {
    if (css.length > CSS_MAX) fail(ctx, "validation.too_large", "The custom CSS is too large.", { field: "css" });
    if (/<\/?\s*style|<script|@import|javascript:|expression\s*\(/i.test(css)) fail(ctx, "validation.bad_input", "The custom CSS may not load other files or run script.", { field: "css" });
    sets.push(["css", css.length > 0 ? css : null]);
  }
  if (o.logic !== undefined) sets.push(["logic", o.logic === null ? null : JSON.stringify(o.logic)]);
  if (o.thankYou !== undefined && o.thankYou !== null) {
    const t = o.thankYou;
    if (!isRec(t)) fail(ctx, "validation.bad_input", "The thank-you page is not valid.", { field: "thankYou" });
    const text = t.text;
    const redirect = t.redirect;
    if (text !== undefined && (typeof text !== "string" || text.length > 5000)) fail(ctx, "validation.bad_input", "The thank-you text is not valid.", { field: "thankYou.text" });
    if (redirect !== undefined && (typeof redirect !== "string" || !safeTarget(redirect))) {
      fail(ctx, "validation.bad_input", "A redirect is a full https address or a path on this site.", { field: "thankYou.redirect" });
    }
    sets.push(["thank_you", JSON.stringify({ ...(text !== undefined ? { text } : {}), ...(redirect !== undefined ? { redirect } : {}) })]);
  }
  if (sets.length > 0) {
    sets.push(["updated_at", ctx.now()]);
    ctx.db.run(`UPDATE forms_form SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`, ...sets.map(([, v]) => v), str(form.id));
  }
  return { ok: true };
}

async function publish(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  if (form.kind === "booking") {
    if (!one(ctx, "SELECT * FROM forms_booking_page WHERE form_id = ?", str(form.id))) fail(ctx, "validation.precondition_failed", "This booking page has no hosts yet.");
  } else if (!fieldsOf(ctx, str(form.id)).some((f) => f.mode === "ask")) {
    fail(ctx, "validation.precondition_failed", "Ask for at least one field before publishing.");
  }
  if (form.state !== "published") {
    ctx.db.run("UPDATE forms_form SET state = ?, updated_at = ? WHERE id = ?", "published", ctx.now(), str(form.id));
    ctx.emit("form.published", `form/${str(form.id)}`, { formId: str(form.id), slug: str(form.slug) });
  }
  const url = publicUrl(form);
  return { url, embed: `<iframe src="${esc(url)}" title="${esc(str(form.name))}" style="width:100%;border:0" loading="lazy"></iframe>` };
}

async function unpublish(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  if (form.state === "published") ctx.db.run("UPDATE forms_form SET state = ?, updated_at = ? WHERE id = ?", "closed", ctx.now(), str(form.id));
  return { ok: true };
}

async function remove(ctx: Ctx, input: unknown) {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  ctx.db.run("UPDATE forms_form SET state = ?, deleted_at = ?, updated_at = ? WHERE id = ?", "closed", ctx.now(), ctx.now(), str(form.id));
  return { deleted: true };
}

export const handlers = {
  "forms.create": (ctx: Ctx, input: unknown) => create(ctx, input),
  "forms.get": (ctx: Ctx, input: unknown) => get(ctx, input),
  "forms.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "forms.update": (ctx: Ctx, input: unknown) => update(ctx, input),
  "forms.fields_set": (ctx: Ctx, input: unknown) => fieldsSet(ctx, input),
  "forms.design_set": (ctx: Ctx, input: unknown) => designSet(ctx, input),
  "forms.publish": (ctx: Ctx, input: unknown) => publish(ctx, input),
  "forms.unpublish": (ctx: Ctx, input: unknown) => unpublish(ctx, input),
  "forms.delete": (ctx: Ctx, input: unknown) => remove(ctx, input),
  ...linkHandlers,
  ...submitHandlers,
  ...bookingHandlers,
};

export { configureForms } from "../projections.ts";
export type { CaptchaVerifier, FormsConfig } from "../projections.ts";
export { linkView } from "./links.ts";
export type { LinkView } from "./links.ts";
