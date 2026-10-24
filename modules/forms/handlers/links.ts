// forms: signed and one-use record links, revoking them, and saving partial answers against a link (spec 2.11 Forms API; ARCH 7.6).
// A link is made for one record. It asks only for the fields that record is missing (a gap check at creation), expires, and can be single-use.
// The token is `<linkId>.<signature>`, signed with the form's own key; only its SHA-256 is stored; no email or name appears in a URL.
// Partial answers wait on the link row and never reach the record until submit.
// @reads ../migrations/0001_forms.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { Row } from "../projections.ts";
import {
  fail, fieldsOf, flag, isNull, isRec, many, mustForm, nid, num, one, optBool, optInt, parseJson, publicUrl, publishedBySlug,
  rateLimit, rec, reqStr, safeEqual, sha256hex, signToken, str, strList,
} from "../projections.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const SINGLE_USE_HOURS = 72;
const SIGNED_HOURS = 24 * 7;
const MAX_HOURS = 24 * 90;
const PARTIAL_TTL_MS = 7 * DAY;
const PARTIAL_MAX_BYTES = 64 * 1024;

// ---- link helpers (also used by submit.ts and the public renderer) ------------------------------------------------

/**
 * Find the link a token names and check it: the signature, the form, not revoked, not used, not expired. Every failure is the same
 * `auth.invalid_code` so a stranger learns nothing about which part was wrong.
 */
export async function resolveLink(ctx: Ctx, form: Row, token: string): Promise<Row> {
  const bad = (): never => fail(ctx, "auth.invalid_code", "This link is not valid any more. Ask for a new one.");
  const dot = token.indexOf(".");
  if (dot < 1 || token.length > 300) return bad();
  const link = one(ctx, "SELECT * FROM forms_link WHERE id = ?", token.slice(0, dot));
  if (!link || link.form_id !== form.id) return bad();
  const expected = await signToken(str(form.signing_key), str(link.id), str(link.record_id), num(link.expires_at));
  if (!safeEqual(expected, token)) return bad();
  if (!safeEqual(await sha256hex(token), str(link.token_hash))) return bad();
  if (!isNull(link.revoked_at) || !isNull(link.consumed_at) || num(link.expires_at) <= ctx.now()) return bad();
  return link;
}

/** Mark a single-use link used. False when another call got there first. Multi-use links are never consumed. */
export function consumeLink(ctx: Ctx, link: Row): boolean {
  if (!flag(link.single_use)) return true;
  return ctx.db.run("UPDATE forms_link SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL", ctx.now(), str(link.id)).changes === 1;
}

/** Undo consumeLink after a failed write, so the person can try again. */
export function releaseLink(ctx: Ctx, link: Row): void {
  if (flag(link.single_use)) ctx.db.run("UPDATE forms_link SET consumed_at = ? WHERE id = ?", null, str(link.id));
}

/**
 * The fields an answer may set. Public form: every Ask field, plus Hide fields that have a prefill key (the URL fills them).
 * Link: only the fields the record was missing when the link was made.
 */
export function answerableFields(ctx: Ctx, form: Row, link: Row | null): Set<string> {
  const rows = fieldsOf(ctx, str(form.id));
  const open = new Set<string>();
  for (const f of rows) {
    if (f.mode === "ask" || (f.mode === "hide" && !isNull(f.prefill_key))) open.add(str(f.field));
  }
  if (!link) return open;
  const missing = strList(link.missing);
  if (missing.length === 0) return open;
  return new Set(missing.filter((m) => open.has(m)));
}

export interface LinkView {
  recordId: string;
  singleUse: boolean;
  expiresAt: number;
  /** the fields the renderer asks, in order, with their step */
  fields: { field: string; mode: string; step?: number }[];
  partial?: { answers: Record<string, unknown>; step?: number; expiresAt: number };
}

/** What the public renderer needs to draw a link form: the missing fields in order and any saved partial answers. */
export async function linkView(ctx: Ctx, slug: string, token: string): Promise<LinkView> {
  const form = publishedBySlug(ctx, slug);
  const link = await resolveLink(ctx, form, token);
  const allowed = answerableFields(ctx, form, link);
  const view: LinkView = {
    recordId: str(link.record_id),
    singleUse: flag(link.single_use),
    expiresAt: num(link.expires_at),
    fields: fieldsOf(ctx, str(form.id)).filter((f) => allowed.has(str(f.field))).map((f) => {
      const o: { field: string; mode: string; step?: number } = { field: str(f.field), mode: str(f.mode) };
      if (!isNull(f.step)) o.step = num(f.step);
      return o;
    }),
  };
  const saved = parseJson(link.partial);
  if (isRec(saved) && num(link.partial_expires_at) > ctx.now()) {
    const p: NonNullable<LinkView["partial"]> = { answers: saved, expiresAt: num(link.partial_expires_at) };
    if (!isNull(link.partial_step)) p.step = num(link.partial_step);
    view.partial = p;
  }
  return view;
}

// ---- capabilities ----------------------------------------------------------------------------------------------

async function linkCreate(ctx: Ctx, input: unknown): Promise<{ url: string; expiresAt?: number }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  if (form.kind === "booking") fail(ctx, "validation.precondition_failed", "A booking page has no record links.");
  const recordId = reqStr(ctx, o, "recordId");
  const singleUse = optBool(ctx, o, "singleUse");
  if (singleUse === undefined) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "singleUse" });
  const hours = optInt(ctx, o, "expiresInHours", 1, MAX_HOURS) ?? (singleUse ? SINGLE_USE_HOURS : SIGNED_HOURS);

  // The gap check: only fields the form asks and the record still lacks go on the link.
  const got = (await ctx.call("records.get", { type: str(form.record_type), recordId })) as { record?: { fields?: Record<string, unknown> } };
  const have = got.record?.fields ?? {};
  const asked = fieldsOf(ctx, str(form.id)).filter((f) => f.mode === "ask").map((f) => str(f.field));
  const empty = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
  const missing = asked.filter((f) => empty(have[f]));
  if (asked.length > 0 && missing.length === 0) fail(ctx, "validation.precondition_failed", "That record already has every answer this form asks for.");

  const now = ctx.now();
  const expiresAt = now + hours * HOUR;
  const linkId = nid(ctx, "lnk");
  const token = await signToken(str(form.signing_key), linkId, recordId, expiresAt);
  ctx.db.run(
    "INSERT INTO forms_link (id, form_id, record_id, token_hash, single_use, missing, expires_at, consumed_at, revoked_at, partial, partial_step, partial_expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    linkId, str(form.id), recordId, await sha256hex(token), singleUse ? 1 : 0, JSON.stringify(missing), expiresAt, null, null, null, null, null, ctx.principal.id, now,
  );
  ctx.emit("form.link_created", `form/${str(form.id)}`, { formId: str(form.id), recordId, expiresAt });
  return { url: `${publicUrl(form)}?t=${encodeURIComponent(token)}`, expiresAt };
}

async function linkRevoke(ctx: Ctx, input: unknown): Promise<{ revoked: boolean }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const token = reqStr(ctx, o, "token");
  const dot = token.indexOf(".");
  const link = dot < 1 ? undefined : one(ctx, "SELECT * FROM forms_link WHERE id = ?", token.slice(0, dot));
  if (!link || link.form_id !== form.id) fail(ctx, "validation.not_found", "That link does not exist.");
  if (!isNull(link.revoked_at)) return { revoked: true };
  ctx.db.run("UPDATE forms_link SET revoked_at = ?, partial = ?, partial_step = ?, partial_expires_at = ? WHERE id = ?", ctx.now(), null, null, null, str(link.id));
  return { revoked: true };
}

async function savePartial(ctx: Ctx, input: unknown): Promise<{ saved: boolean; expiresAt?: number }> {
  const o = rec(ctx, input);
  const form = publishedBySlug(ctx, reqStr(ctx, o, "slug"));
  const link = await resolveLink(ctx, form, reqStr(ctx, o, "token"));
  const answers = o.answers;
  if (!isRec(answers)) fail(ctx, "validation.bad_input", "The answers are not valid.", { field: "answers" });
  const step = optInt(ctx, o, "step", 0, 1000);
  rateLimit(ctx, `partial:${str(form.id)}`, str(link.id), 60, 60_000);
  const allowed = answerableFields(ctx, form, link);
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!allowed.has(k)) fail(ctx, "validation.bad_input", "That question is not on this form.", { field: `answers.${k}` });
    kept[k] = v;
  }
  const text = JSON.stringify(kept);
  if (new TextEncoder().encode(text).length > PARTIAL_MAX_BYTES) fail(ctx, "validation.too_large", "Those answers are too large to save.");
  const expiresAt = Math.min(num(link.expires_at), ctx.now() + PARTIAL_TTL_MS);
  ctx.db.run("UPDATE forms_link SET partial = ?, partial_step = ?, partial_expires_at = ? WHERE id = ?", text, step ?? null, expiresAt, str(link.id));
  return { saved: true, expiresAt };
}

/** The links of one form with their state. Used by the settings pane through the handlers' owner and by tests. */
export function linksOf(ctx: Ctx, formId: string): { id: string; recordId: string; state: "open" | "used" | "revoked" | "expired" }[] {
  return many(ctx, "SELECT * FROM forms_link WHERE form_id = ?", formId).map((l) => {
    let state: "open" | "used" | "revoked" | "expired" = "open";
    if (!isNull(l.revoked_at)) state = "revoked";
    else if (!isNull(l.consumed_at)) state = "used";
    else if (num(l.expires_at) <= ctx.now()) state = "expired";
    return { id: str(l.id), recordId: str(l.record_id), state };
  });
}

export const linkHandlers = {
  "forms.link_create": (ctx: Ctx, input: unknown) => linkCreate(ctx, input),
  "forms.link_revoke": (ctx: Ctx, input: unknown) => linkRevoke(ctx, input),
  "forms.save_partial": (ctx: Ctx, input: unknown) => savePartial(ctx, input),
};
