// forms: the public submit, submissions, survey results, First/Latest source and Source rules (spec 2.11, 3.6; ARCH 7.6).
// /f/<slug> reaches forms.submit on the public listener. The gateway authenticates the call as service principal svc_form_<id>; the write goes through
// records.create / records.update as that principal, so every value is counted as coming from the link holder.
// Order of checks: form open, principal, rate limit, consent, captcha, link, answers (conditional logic), uploads (upload_policy), duplicate, then the write. A refused call writes nothing.
// A single-use link is consumed before the write and released if the write fails, so one link can never make two records.
// @reads ../migrations/0001_forms.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { Attribution, FormKind, Row } from "../projections.ts";
import {
  attributionOf, cleanAttribution, DEFAULT_RATE_LIMIT, fail, fieldsOf, flag, formsConfig, isRec, many, matchRuleOf, mustForm, nid, num, optStr,
  isNull, one, pageOf, parseJson, publishedBySlug, rateLimit, rec, recordAttribution, reqStr, sha256hex, sourceRules, str,
} from "../projections.ts";
import { answerableFields, consumeLink, releaseLink, resolveLink } from "./links.ts";

const ANSWERS_MAX_BYTES = 128 * 1024;
const TEXT_ANSWER_MAX = 10_000;
const DUPLICATE_WINDOW_MS = 60_000;
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
/** Answer keys the renderer sends beside the form fields; they are never written to the record. */
const RESERVED = new Set(["consent", "captcha"]);

export function formPrincipal(formId: string): string {
  return `svc_form_${formId.replace(/^frm_/, "")}`;
}

type Answer = string | number | boolean | null | string[] | { fileId: string };

function cleanAnswer(ctx: Ctx, key: string, v: unknown): Answer {
  const bad = (): never => fail(ctx, "validation.bad_input", "That answer is not valid.", { field: `answers.${key}` });
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : bad();
  if (typeof v === "string") {
    if (v.length > TEXT_ANSWER_MAX) fail(ctx, "validation.too_large", "That answer is too long.", { field: `answers.${key}` });
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > 200 || !v.every((x) => typeof x === "string" && x.length <= 500)) return bad();
    return v as string[];
  }
  if (isRec(v) && typeof v.fileId === "string" && Object.keys(v).length === 1) return { fileId: v.fileId };
  return bad();
}

const isEmptyAnswer = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

// ---- conditional logic -----------------------------------------------------------------------------------------
// forms.design_set stores `logic` as { rules: [{ when, show?, hide?, require? }] }. `when` is { field, op, value? } or { all: [...] } / { any: [...] } / { not: ... }; ops are
// eq, ne, in, contains, empty, not_empty, gt, gte, lt, lte. A question named in any rule's `show` starts hidden and appears while a rule that shows it matches; a matching `hide` rule
// hides it again; a matching `require` rule makes it required while it is visible. The public page runs the same rules in the browser; this is the one that counts.

export interface LogicRule { when: unknown; show?: string[]; hide?: string[]; require?: string[] }

const LOGIC_PASSES = 8;
const nameList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function rulesOf(logic: unknown): LogicRule[] {
  const list = isRec(logic) && Array.isArray(logic.rules) ? logic.rules : [];
  return list.filter(isRec).map((r) => {
    const rule: LogicRule = { when: r.when };
    const show = nameList(r.show), hide = nameList(r.hide), require = nameList(r.require);
    if (show.length > 0) rule.show = show;
    if (hide.length > 0) rule.hide = hide;
    if (require.length > 0) rule.require = require;
    return rule;
  });
}

const textOf = (v: unknown): string => (Array.isArray(v) ? v.join(",") : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function holds(cond: unknown, answers: Record<string, unknown>): boolean {
  if (!isRec(cond)) return false;
  if (Array.isArray(cond.all)) return cond.all.every((c) => holds(c, answers));
  if (Array.isArray(cond.any)) return cond.any.some((c) => holds(c, answers));
  if ("not" in cond) return !holds(cond.not, answers);
  const have = answers[str(cond.field)];
  const want = cond.value;
  switch (cond.op) {
    case "empty": return isEmptyAnswer(have);
    case "not_empty": return !isEmptyAnswer(have);
    case "eq": return Array.isArray(have) ? have.includes(textOf(want)) : textOf(have) === textOf(want);
    case "ne": return Array.isArray(have) ? !have.includes(textOf(want)) : textOf(have) !== textOf(want);
    case "in": return Array.isArray(want) && want.map(textOf).includes(textOf(have));
    case "contains": return textOf(have).toLowerCase().includes(textOf(want).toLowerCase());
    case "gt": case "gte": case "lt": case "lte": {
      const a = Number(have), b = Number(want);
      if (isEmptyAnswer(have) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
      return cond.op === "gt" ? a > b : cond.op === "gte" ? a >= b : cond.op === "lt" ? a < b : a <= b;
    }
    default: return false;
  }
}

/** Which questions are hidden and which are required for these answers. A hidden question's answer does not feed a rule, so the rules are settled in a few passes. */
export function logicState(logic: unknown, answers: Record<string, unknown>): { hidden: Set<string>; required: Set<string> } {
  const rules = rulesOf(logic);
  const startsHidden = new Set(rules.flatMap((r) => r.show ?? []));
  let hidden = new Set(startsHidden);
  let required = new Set<string>();
  for (let pass = 0; pass < LOGIC_PASSES; pass++) {
    const seen: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) if (!hidden.has(k)) seen[k] = v;
    const next = new Set(startsHidden);
    const need = new Set<string>();
    for (const r of rules) {
      if (!holds(r.when, seen)) continue;
      for (const f of r.show ?? []) next.delete(f);
    }
    for (const r of rules) {
      if (!holds(r.when, seen)) continue;
      for (const f of r.hide ?? []) next.add(f);
      for (const f of r.require ?? []) need.add(f);
    }
    const same = next.size === hidden.size && [...next].every((f) => hidden.has(f));
    hidden = next;
    required = need;
    if (same) break;
  }
  for (const f of hidden) required.delete(f);
  return { hidden, required };
}

/** Check the answers against the form: unknown questions are refused, read-only (Show) questions are ignored, email-like fields are tidied, questions the logic hides are dropped and the ones it requires must be filled. */
export function checkAnswers(ctx: Ctx, form: Row, link: Row | null, raw: Record<string, unknown>): Record<string, Answer> {
  const allowed = answerableFields(ctx, form, link);
  const modes = new Map(fieldsOf(ctx, str(form.id)).map((f) => [str(f.field), str(f.mode)]));
  const out: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED.has(key)) continue;
    if (modes.get(key) === "show") continue;
    if (!allowed.has(key)) fail(ctx, "validation.bad_input", "That question is not on this form.", { field: `answers.${key}` });
    let a = cleanAnswer(ctx, key, value);
    if (key === "email" && typeof a === "string") {
      a = a.trim().toLowerCase();
      if (a.length > 0 && (a.length > 254 || !EMAIL.test(a))) fail(ctx, "validation.bad_input", "That does not look like an email address.", { field: `answers.${key}` });
    }
    out[key] = a;
  }
  const logic = parseJson(form.logic);
  if (logic !== undefined) {
    const { hidden, required } = logicState(logic, out);
    for (const key of hidden) delete out[key];
    for (const key of required) {
      if (allowed.has(key) && isEmptyAnswer(out[key])) fail(ctx, "validation.bad_input", "This question needs an answer.", { field: `answers.${key}` });
    }
  }
  return out;
}

// ---- upload policy ---------------------------------------------------------------------------------------------
// forms.update stores `upload_policy` as { fields?: string[], maxBytes?: number, types?: string[] }. `types` hold MIME types ("application/pdf"), MIME families ("image/*") or
// extensions (".pdf"); `maxBytes` is the most one file may be. The policy covers every answer that is a file ({ fileId }), whatever the question; `fields` names the questions the public
// page draws as a file chooser. Each file is looked up as the form's service principal (files.get), so the size and type checked are the stored ones, not what the browser claimed.

export interface UploadPolicy { fields: string[]; maxBytes?: number; types: string[] }

export function uploadPolicyOf(form: Row): UploadPolicy | undefined {
  const p = parseJson(form.upload_policy);
  if (!isRec(p)) return undefined;
  const out: UploadPolicy = { fields: nameList(p.fields), types: nameList(p.types).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0) };
  if (typeof p.maxBytes === "number" && Number.isFinite(p.maxBytes) && p.maxBytes >= 0) out.maxBytes = p.maxBytes;
  return out;
}

/** Does this stored file fit the allowed types? No types listed means any. */
export function typeAllowed(types: readonly string[], mime: string, name: string): boolean {
  if (types.length === 0) return true;
  const m = mime.toLowerCase();
  const n = name.toLowerCase();
  return types.some((t) => (t.startsWith(".") ? n.endsWith(t) : t.endsWith("/*") ? m.startsWith(t.slice(0, -1)) : m === t));
}

export async function checkUploads(ctx: Ctx, form: Row, answers: Record<string, Answer>): Promise<void> {
  const policy = uploadPolicyOf(form);
  if (!policy) return;
  for (const [key, a] of Object.entries(answers)) {
    if (a === null || typeof a !== "object" || Array.isArray(a)) continue;
    const field = `answers.${key}`;
    let file: Row | undefined;
    try {
      const got = (await ctx.call("files.get", { fileId: a.fileId })) as { file?: unknown };
      file = isRec(got.file) ? got.file : undefined;
    } catch {
      file = undefined;
    }
    if (!file) fail(ctx, "validation.bad_input", "That file could not be found. Choose it again.", { field });
    if (policy.maxBytes !== undefined && num(file.size) > policy.maxBytes) {
      fail(ctx, "validation.too_large", `That file is over the ${Math.floor(policy.maxBytes / 1024)} KB limit.`, { field, maxBytes: policy.maxBytes });
    }
    if (!typeAllowed(policy.types, str(file.mime), str(file.name))) fail(ctx, "validation.bad_input", "That kind of file is not accepted here.", { field, types: policy.types });
  }
}

export function principalOk(ctx: Ctx, form: Row): void {
  const p = ctx.principal;
  if (p.kind === "service" && p.id.startsWith("svc_form_") && p.id !== formPrincipal(str(form.id))) {
    fail(ctx, "permission.no_grant", "This form cannot be submitted from here.");
  }
}

function consentOf(raw: Record<string, unknown>, attribution: unknown): boolean {
  if (isRec(attribution) && attribution.consent === true) return true;
  return raw.consent === true || raw.consent === "true";
}

async function digestOf(form: Row, link: Row | null, answers: Record<string, Answer>): Promise<string> {
  const keys = Object.keys(answers).sort();
  return sha256hex(JSON.stringify([form.id, link ? link.id : null, keys.map((k) => [k, answers[k]])]));
}

export interface WriteResult {
  recordId: string;
  created: boolean;
  matched: boolean;
}

const unwrapId = (v: unknown): string => {
  const r = isRec(v) && isRec(v.record) ? v.record : undefined;
  return r && typeof r.id === "string" ? r.id : "";
};

/**
 * Write answers to a record as the form's service principal. With a link the link's record is updated. Without one the match rule decides:
 * no match creates, one match updates, several matches create a record and put the doubt in Needs you (nothing is merged by guess).
 */
export async function writeAnswers(ctx: Ctx, form: Row, answers: Record<string, Answer>, link: Row | null, key: string): Promise<WriteResult> {
  const type = str(form.record_type);
  if (link) {
    const recordId = str(link.record_id);
    if (Object.keys(answers).length > 0) await ctx.call("records.update", { type, recordId, patch: answers });
    return { recordId, created: false, matched: true };
  }
  const keys = matchRuleOf(form);
  const present = keys.filter((k) => !isEmptyAnswer(answers[k]));
  let found: string[] = [];
  if (present.length === keys.length) {
    const filter = { and: keys.map((k) => ({ field: k, op: "eq", value: answers[k] })) };
    const res = (await ctx.call("records.query", { type, filter, limit: 2 })) as { rows?: { id?: unknown }[] };
    found = (res.rows ?? []).map((r) => (typeof r.id === "string" ? r.id : "")).filter((x) => x.length > 0);
  }
  if (found.length === 1 && found[0]) {
    const patch: Record<string, Answer> = {};
    for (const [k, v] of Object.entries(answers)) if (!isEmptyAnswer(v)) patch[k] = v;
    if (Object.keys(patch).length > 0) await ctx.call("records.update", { type, recordId: found[0], patch });
    return { recordId: found[0], created: false, matched: true };
  }
  const made = unwrapId(await ctx.call("records.create", { idempotencyKey: `${key}:records.create`, type, fields: answers }));
  if (made === "") fail(ctx, "internal.unexpected", "The record could not be created.");
  if (found.length > 1) {
    await ctx.call("tasks.create", {
      idempotencyKey: `${key}:duplicate-task`,
      title: `Possible duplicate from the form ${str(form.name)}`,
      summary: `A submission matched more than one ${type}. A new record was created; check whether it should be merged.`,
      assigned: { kind: "person", id: str(form.created_by) },
      recordId: made,
      source: { kind: "manual", id: str(form.id) },
    });
  }
  return { recordId: made, created: true, matched: false };
}

/**
 * The checks every public write shares: the per-form rate limit, the consent statement and the captcha. Returns whether consent was given.
 * Nothing is written before these pass. `scope` keeps submit and booking counts apart.
 */
export async function publicChecks(ctx: Ctx, form: Row, rawAnswers: Record<string, unknown>, o: Record<string, unknown>, scope: "submit" | "book"): Promise<boolean> {
  rateLimit(ctx, `${scope}:${str(form.id)}`, "*", num(form.rate_limit) > 0 ? num(form.rate_limit) : DEFAULT_RATE_LIMIT, 60_000);

  const consentText = str(form.consent_text).trim();
  const consent = consentOf(rawAnswers, o.attribution);
  if (consentText.length > 0 && !consent) fail(ctx, "validation.bad_input", "Please accept the consent statement to continue.", { field: "consent" });

  if (flag(form.captcha)) {
    // forms.submit has a captcha input; bookings.book does not, so a booking page reads it from the reserved answer key
    const inAnswers = rawAnswers.captcha;
    const captcha = optStr(ctx, o, "captcha") ?? (typeof inAnswers === "string" && inAnswers.length > 0 ? inAnswers : undefined);
    const verifier = formsConfig().captcha;
    if (!verifier) fail(ctx, "validation.precondition_failed", "This form needs a captcha check that is not set up on this server.");
    if (!captcha) fail(ctx, "auth.invalid_code", "Complete the captcha to continue.");
    let human = false;
    try {
      human = await verifier.verify(captcha, ctx);
    } catch (e) {
      ctx.log.warn("forms: captcha check failed to run", { error: e instanceof Error ? e.message : String(e) });
      fail(ctx, "provider.unavailable", "The captcha check could not run. Try again in a moment.");
    }
    if (!human) fail(ctx, "auth.invalid_code", "The captcha check failed. Try again.");
  }
  return consent;
}

async function submit(ctx: Ctx, input: unknown): Promise<{ recordId: string; thankYou?: string }> {
  const o = rec(ctx, input);
  const form = publishedBySlug(ctx, reqStr(ctx, o, "slug"), ["public", "one_use", "survey"]);
  const formId = str(form.id);
  principalOk(ctx, form);
  const rawAnswers = o.answers;
  if (!isRec(rawAnswers)) fail(ctx, "validation.bad_input", "The answers are not valid.", { field: "answers" });
  if (new TextEncoder().encode(JSON.stringify(rawAnswers)).length > ANSWERS_MAX_BYTES) fail(ctx, "validation.too_large", "Those answers are too large.");

  const consent = await publicChecks(ctx, form, rawAnswers, o, "submit");

  const token = optStr(ctx, o, "token") ?? optStr(ctx, o, "code");
  let link: Row | null = null;
  if (token !== undefined) link = await resolveLink(ctx, form, token);
  else if (form.kind === "one_use") fail(ctx, "auth.invalid_code", "This form opens only from the link that was sent to you.");

  const answers = checkAnswers(ctx, form, link, rawAnswers);
  await checkUploads(ctx, form, answers);
  const attribution = cleanAttribution(ctx, o.attribution, consent);

  const digest = await digestOf(form, link, answers);
  const now = ctx.now();
  for (const s of many(ctx, "SELECT * FROM forms_submission WHERE form_id = ?", formId)) {
    if (s.digest === digest && num(s.at) > now - DUPLICATE_WINDOW_MS) fail(ctx, "validation.duplicate", "This was already sent.");
  }

  if (link && !consumeLink(ctx, link)) fail(ctx, "auth.invalid_code", "This link is not valid any more. Ask for a new one.");
  let written: WriteResult;
  try {
    written = await writeAnswers(ctx, form, answers, link, `forms.submit:${formId}:${digest}:${ctx.trace.traceId}`);
  } catch (e) {
    if (link) releaseLink(ctx, link);
    throw e;
  }

  ctx.db.run(
    "INSERT INTO forms_submission (id, form_id, record_id, at, matched, principal, link_id, consent, digest, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    nid(ctx, "sub"), formId, written.recordId, now, written.matched ? 1 : 0, formPrincipal(formId), link ? str(link.id) : null, consent ? 1 : 0, digest,
    form.kind === "survey" ? JSON.stringify(answers) : null,
  );
  if (attribution) recordAttribution(ctx, written.recordId, attribution, written.created);
  if (link) ctx.db.run("UPDATE forms_link SET partial = ?, partial_step = ?, partial_expires_at = ? WHERE id = ?", null, null, null, str(link.id));
  ctx.emit("form.submitted", `form/${formId}`, { formId, recordId: written.recordId, type: str(form.record_type), matched: written.matched });

  const thanks = parseJson(form.thank_you);
  const out: { recordId: string; thankYou?: string } = { recordId: written.recordId };
  if (isRec(thanks)) {
    const t = typeof thanks.redirect === "string" && thanks.redirect.length > 0 ? thanks.redirect : typeof thanks.text === "string" ? thanks.text : "";
    if (t.length > 0) out.thankYou = t;
  }
  return out;
}

// ---- the public page's view of a form --------------------------------------------------------------------------

export interface PublicFormView {
  slug: string;
  kind: FormKind;
  name: string;
  /** the questions a visitor sees, in order: Ask, plus Hide ones that a link or the page address fills (prefillKey) */
  fields: { field: string; hidden: boolean; prefillKey?: string; step: number }[];
  theme?: Record<string, unknown>;
  css?: string;
  consentText?: string;
  captcha: boolean;
  logic?: { rules: LogicRule[] };
  thankYou?: { text?: string; redirect?: string };
  upload?: UploadPolicy;
  /** booking pages: the meeting length the visitor is picking a slot for */
  lengthMinutes?: number;
}

/**
 * What GET /f/<slug> and GET /book/<slug> draw. A closed, draft, deleted or wrong-kind form is not found, like every public read. `page` is which address was asked:
 * /f/ serves public, one-use and survey forms, /book/ serves booking pages.
 */
export function publicFormView(ctx: Ctx, slug: string, page: "form" | "booking"): PublicFormView {
  const form = publishedBySlug(ctx, slug, page === "booking" ? ["booking"] : ["public", "one_use", "survey"]);
  const view: PublicFormView = {
    slug: str(form.slug),
    kind: str(form.kind) as FormKind,
    name: str(form.name),
    fields: fieldsOf(ctx, str(form.id))
      .filter((f) => f.mode === "ask" || (f.mode === "hide" && !isNull(f.prefill_key)))
      .map((f) => {
        const row: PublicFormView["fields"][number] = { field: str(f.field), hidden: f.mode === "hide", step: isNull(f.step) ? 0 : num(f.step) };
        if (!isNull(f.prefill_key)) row.prefillKey = str(f.prefill_key);
        return row;
      }),
    captcha: flag(form.captcha),
  };
  const theme = parseJson(form.theme);
  if (isRec(theme)) view.theme = theme;
  if (typeof form.css === "string" && form.css.length > 0) view.css = form.css;
  if (str(form.consent_text).trim().length > 0) view.consentText = str(form.consent_text);
  const logic = rulesOf(parseJson(form.logic));
  if (logic.length > 0) view.logic = { rules: logic };
  const thanks = parseJson(form.thank_you);
  if (isRec(thanks)) {
    const t: NonNullable<PublicFormView["thankYou"]> = {};
    if (typeof thanks.text === "string" && thanks.text.length > 0) t.text = thanks.text;
    if (typeof thanks.redirect === "string" && thanks.redirect.length > 0) t.redirect = thanks.redirect;
    if (t.text !== undefined || t.redirect !== undefined) view.thankYou = t;
  }
  const upload = uploadPolicyOf(form);
  if (upload) view.upload = upload;
  if (page === "booking") {
    const bp = one(ctx, "SELECT * FROM forms_booking_page WHERE form_id = ?", str(form.id));
    if (bp) view.lengthMinutes = num(bp.length_minutes);
  }
  return view;
}

async function submissions(ctx: Ctx, input: unknown): Promise<{ rows: { recordId: string; at: number; matched: boolean }[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM forms_submission WHERE form_id = ?", str(form.id)).sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  const out: { rows: { recordId: string; at: number; matched: boolean }[]; next?: string; total: number } = {
    rows: rows.slice(offset, offset + limit).map((r) => ({ recordId: str(r.record_id), at: num(r.at), matched: flag(r.matched) })),
    total: rows.length,
  };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function surveyResults(ctx: Ctx, input: unknown): Promise<{ responses: number; questions: { field: string; summary: unknown }[] }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  if (form.kind !== "survey") fail(ctx, "validation.precondition_failed", "Only a survey has results.");
  const subs = many(ctx, "SELECT * FROM forms_submission WHERE form_id = ?", str(form.id));
  const parsed = subs.map((s) => parseJson(s.answers)).filter(isRec);
  const questions = fieldsOf(ctx, str(form.id)).filter((f) => f.mode === "ask").map((f) => {
    const field = str(f.field);
    const values = parsed.map((a) => a[field]).filter((v) => !isEmptyAnswer(v));
    const nums = values.filter((v): v is number => typeof v === "number");
    if (values.length > 0 && nums.length === values.length) {
      const dist: Record<string, number> = {};
      for (const n of nums) dist[String(n)] = (dist[String(n)] ?? 0) + 1;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { field, summary: { kind: "number", answered: nums.length, average: Math.round(avg * 100) / 100, min: Math.min(...nums), max: Math.max(...nums), distribution: dist } };
    }
    const counts = new Map<string, number>();
    for (const v of values) for (const item of Array.isArray(v) ? v : [v]) {
      const key = typeof item === "string" ? item : JSON.stringify(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 50).map(([value, count]) => ({ value, count }));
    return { field, summary: { kind: "choice", answered: values.length, counts: top } };
  });
  return { responses: subs.length, questions };
}

async function attributionGet(ctx: Ctx, input: unknown): Promise<{ first?: Attribution; latest?: Attribution }> {
  const o = rec(ctx, input);
  return attributionOf(ctx, reqStr(ctx, o, "recordId"));
}

async function sourceRulesList(ctx: Ctx, _input: unknown): Promise<{ rules: { ruleId: string; match: Record<string, unknown>; channel: string; order: number }[] }> {
  return { rules: sourceRules(ctx) };
}

async function sourceRulesSet(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const o = rec(ctx, input);
  const rules = o.rules;
  if (!Array.isArray(rules) || rules.length > 200) fail(ctx, "validation.bad_input", "The rules are not valid.", { field: "rules" });
  const clean: { match: Record<string, unknown>; channel: string }[] = [];
  rules.forEach((r, i) => {
    if (!isRec(r) || !isRec(r.match) || Object.keys(r.match).length === 0) fail(ctx, "validation.bad_input", "A rule needs something to match.", { field: `rules.${i}.match` });
    const channel = typeof r.channel === "string" ? r.channel.trim() : "";
    if (channel.length === 0 || channel.length > 60) fail(ctx, "validation.bad_input", "A rule needs a channel name.", { field: `rules.${i}.channel` });
    clean.push({ match: r.match, channel });
  });
  ctx.db.run("DELETE FROM forms_source_rule");
  clean.forEach((r, i) => {
    ctx.db.run("INSERT INTO forms_source_rule (id, position, match_json, channel) VALUES (?, ?, ?, ?)", nid(ctx, "srl"), i, JSON.stringify(r.match), r.channel);
  });
  return { ok: true };
}

export const submitHandlers = {
  "forms.submit": (ctx: Ctx, input: unknown) => submit(ctx, input),
  "forms.submissions": (ctx: Ctx, input: unknown) => submissions(ctx, input),
  "forms.survey_results": (ctx: Ctx, input: unknown) => surveyResults(ctx, input),
  "forms.attribution_get": (ctx: Ctx, input: unknown) => attributionGet(ctx, input),
  "source_rules.list": (ctx: Ctx, input: unknown) => sourceRulesList(ctx, input),
  "source_rules.set": (ctx: Ctx, input: unknown) => sourceRulesSet(ctx, input),
};
