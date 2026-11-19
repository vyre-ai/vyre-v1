// mail.template.* (lane r42-email-in): named email templates with merge fields, a live preview on a real record, and a document's own version of one.
//
// Which text a send uses, in order: the document's own version of the key, else the Space's template, else the one that ships with Vyre. Text carries
// {{field}} or {{field|fallback}}; the same tokens the email builder uses. A preview fills them from a real record (read as the caller, so a record the caller
// may not see is not found) and from `vars` a caller passes (vars win), and says which fields would go out blank. A Space template is edited by people who hold
// comms.templates; a document's version by people who may edit the document.
import { fail } from "../../../../host/src/routes/errors.ts";
import { findRecord } from "../../../../lib/record-type.ts";
import { fillTokens, tokensIn } from "../../../../lib/merge-tokens.ts";
import { bad, first, missing, newId, num, rowsOf, statements, str, strOrNull } from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureAll } from "./common.ts";
import { BUILTINS } from "./template-builtins.ts";

const SQL = readFileSync(fileURLToPath(new URL("../../migrations/0008_templates.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();

export function ensureTemplates(ctx: Pick<MailCtx, "db">): void {
  ensureAll(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "documentId" FROM mail_template_doc WHERE "documentId" = ?`, "probe");
  } catch {
    for (const statement of statements(SQL)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/;
const FILE = /^fil_[a-z0-9]+$/;
export const MAX_SUBJECT = 300;
export const MAX_TEXT = 100_000;
export const MAX_HTML = 1_000_000;

export interface TemplateOut {
  key: string;
  title: string;
  subject: string;
  text: string;
  html?: string;
  source: "document" | "space" | "builtin";
  recordType?: string;
  version: number;
  updatedAt?: number;
  fields: { key: string; fallback?: string }[];
}

const keyOf = (ctx: MailCtx, v: unknown): string => {
  if (typeof v !== "string" || v.length > 60 || !KEY.test(v))
    bad(ctx, "A template key is lower-case words joined by dots, like signature.request.");
  return v;
};
const documentOf = (ctx: MailCtx, v: unknown): string => {
  if (typeof v !== "string" || !FILE.test(v)) bad(ctx, "Document id is not valid.");
  return v;
};

interface Body {
  subject: string;
  text: string;
  html?: string;
}

function bodyOf(ctx: MailCtx, input: Record<string, unknown>): Body {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (subject === "") bad(ctx, "A template needs a subject.");
  if (subject.length > MAX_SUBJECT) bad(ctx, `A subject is at most ${MAX_SUBJECT} characters.`);
  if (/[\r\n]/.test(subject)) bad(ctx, "A subject is one line.");
  const text = typeof input.text === "string" ? input.text : "";
  if (text.trim() === "") bad(ctx, "A template needs a body.");
  if (text.length > MAX_TEXT) bad(ctx, "The body is too long.");
  const html = input.html;
  if (html !== undefined && typeof html !== "string") bad(ctx, "The html body is text.");
  if (typeof html === "string" && html.length > MAX_HTML) bad(ctx, "The html body is over 1 MB.");
  return { subject, text, ...(typeof html === "string" && html !== "" ? { html } : {}) };
}

const fieldsOf = (b: Body): TemplateOut["fields"] => {
  const seen = new Map<string, { key: string; fallback?: string }>();
  for (const part of [b.subject, b.text, b.html ?? ""]) for (const t of tokensIn(part)) if (!seen.has(t.key)) seen.set(t.key, t);
  return [...seen.values()];
};

function spaceRow(ctx: MailCtx, key: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_template WHERE key = ? AND deleted_at IS NULL`, key));
}
function docRow(ctx: MailCtx, documentId: string, key: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM mail_template_doc WHERE "documentId" = ? AND key = ?`, documentId, key));
}

function shape(row: Row | null, source: TemplateOut["source"], key: string, title: string, b: Body, extra: Partial<TemplateOut> = {}): TemplateOut {
  const out: TemplateOut = { key, title, subject: b.subject, text: b.text, source, version: row ? num(row, "version") : 1, fields: fieldsOf(b), ...extra };
  if (b.html) out.html = b.html;
  return out;
}

/** The text a send for `key` uses: the document's own, else the Space's, else the one that ships. Undefined when the key names nothing. */
export function resolve(ctx: MailCtx, key: string, documentId?: string): TemplateOut | undefined {
  ensureTemplates(ctx);
  const builtin = BUILTINS.find((b) => b.key === key);
  const space = spaceRow(ctx, key);
  const title = space ? str(space, "title") : (builtin?.title ?? key);
  if (documentId) {
    const d = docRow(ctx, documentId, key);
    if (d) {
      const b: Body = { subject: str(d, "subject"), text: str(d, "text"), ...(strOrNull(d, "html") ? { html: str(d, "html") } : {}) };
      return { ...shape(null, "document", key, title, b), updatedAt: num(d, "updated_at") };
    }
  }
  if (space) {
    const b: Body = { subject: str(space, "subject"), text: str(space, "text"), ...(strOrNull(space, "html") ? { html: str(space, "html") } : {}) };
    const out = shape(space, "space", key, title, b, { updatedAt: num(space, "updated_at") });
    const rt = strOrNull(space, "recordType");
    if (rt) out.recordType = rt;
    return out;
  }
  if (builtin) return shape(null, "builtin", key, builtin.title, { subject: builtin.subject, text: builtin.text });
  return undefined;
}

// ---- reads

export async function list(ctx: MailCtx): Promise<{
  templates: { key: string; title: string; subject: string; source: "space" | "builtin"; customised: boolean; updatedAt?: number }[];
}> {
  ensureTemplates(ctx);
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_template WHERE deleted_at IS NULL`));
  const byKey = new Map(rows.map((r) => [str(r, "key"), r]));
  const out: Awaited<ReturnType<typeof list>>["templates"] = [];
  for (const b of BUILTINS) {
    const r = byKey.get(b.key);
    out.push(
      r
        ? { key: b.key, title: str(r, "title"), subject: str(r, "subject"), source: "space", customised: true, updatedAt: num(r, "updated_at") }
        : { key: b.key, title: b.title, subject: b.subject, source: "builtin", customised: false },
    );
    byKey.delete(b.key);
  }
  for (const r of [...byKey.values()].sort((a, c) => str(a, "title").localeCompare(str(c, "title"))))
    out.push({ key: str(r, "key"), title: str(r, "title"), subject: str(r, "subject"), source: "space", customised: false, updatedAt: num(r, "updated_at") });
  return { templates: out };
}

export async function get(ctx: MailCtx, input: { key: string; documentId?: string }): Promise<{ template: TemplateOut }> {
  const key = keyOf(ctx, input.key);
  const documentId = input.documentId === undefined ? undefined : documentOf(ctx, input.documentId);
  const t = resolve(ctx, key, documentId);
  if (!t) return missing(ctx, "There is no template with that key.");
  return { template: t };
}

// ---- writes

export async function save(
  ctx: MailCtx,
  input: { key: string; title?: string; subject: string; text: string; html?: string; recordType?: string },
): Promise<{ template: TemplateOut }> {
  ensureTemplates(ctx);
  const key = keyOf(ctx, input.key);
  const body = bodyOf(ctx, input as unknown as Record<string, unknown>);
  const builtin = BUILTINS.find((b) => b.key === key);
  const title = (typeof input.title === "string" ? input.title.trim() : "") || builtin?.title || key;
  if (title.length > 120) bad(ctx, "A title is at most 120 characters.");
  if (input.recordType !== undefined && !/^[a-z][a-z0-9_]*$/.test(input.recordType)) bad(ctx, "Record type is not valid.");
  const now = ctx.now();
  const existing = spaceRow(ctx, key);
  const unchanged =
    existing &&
    str(existing, "title") === title &&
    str(existing, "subject") === body.subject &&
    str(existing, "text") === body.text &&
    (strOrNull(existing, "html") ?? "") === (body.html ?? "") &&
    (strOrNull(existing, "recordType") ?? "") === (input.recordType ?? "");
  if (existing && !unchanged) {
    ctx.db.run(
      `UPDATE mail_template SET title = ?, subject = ?, text = ?, html = ?, "recordType" = ?, version = ?, "updatedBy" = ?, updated_at = ? WHERE id = ?`,
      title, body.subject, body.text, body.html ?? null, input.recordType ?? null, num(existing, "version") + 1, ctx.actingFor ?? ctx.principal.id, now, str(existing, "id"),
    );
  } else if (!existing) {
    ctx.db.run(
      `INSERT INTO mail_template (id, key, title, subject, text, html, "recordType", version, "updatedBy", updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("mtp", now), key, title, body.subject, body.text, body.html ?? null, input.recordType ?? null, 1, ctx.actingFor ?? ctx.principal.id, now, null,
    );
  }
  return { template: resolve(ctx, key) as TemplateOut };
}

/** Remove the Space's version: the one that ships comes back, or (a template of the Space's own) the key is gone. */
export async function reset(ctx: MailCtx, input: { key: string }): Promise<{ reset: boolean }> {
  ensureTemplates(ctx);
  const key = keyOf(ctx, input.key);
  const existing = spaceRow(ctx, key);
  if (!existing) return { reset: false };
  ctx.db.run(`UPDATE mail_template SET deleted_at = ?, updated_at = ? WHERE id = ?`, ctx.now(), ctx.now(), str(existing, "id"));
  return { reset: true };
}

export async function forDocumentGet(ctx: MailCtx, input: { documentId: string; key: string }): Promise<{ override: boolean; template: TemplateOut }> {
  ensureTemplates(ctx);
  const key = keyOf(ctx, input.key);
  const documentId = documentOf(ctx, input.documentId);
  const t = resolve(ctx, key, documentId);
  if (!t) return missing(ctx, "There is no template with that key.");
  return { override: t.source === "document", template: t };
}

export async function forDocumentSet(
  ctx: MailCtx,
  input: { documentId: string; key: string; subject: string; text: string; html?: string },
): Promise<{ template: TemplateOut }> {
  ensureTemplates(ctx);
  const key = keyOf(ctx, input.key);
  const documentId = documentOf(ctx, input.documentId);
  if (!BUILTINS.some((b) => b.key === key) && !spaceRow(ctx, key)) return missing(ctx, "There is no template with that key.");
  const body = bodyOf(ctx, input as unknown as Record<string, unknown>);
  const by = ctx.actingFor ?? ctx.principal.id;
  if (docRow(ctx, documentId, key))
    ctx.db.run(
      `UPDATE mail_template_doc SET subject = ?, text = ?, html = ?, "updatedBy" = ?, updated_at = ? WHERE "documentId" = ? AND key = ?`,
      body.subject, body.text, body.html ?? null, by, ctx.now(), documentId, key,
    );
  else
    ctx.db.run(
      `INSERT INTO mail_template_doc ("documentId", key, subject, text, html, "updatedBy", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      documentId, key, body.subject, body.text, body.html ?? null, by, ctx.now(),
    );
  return { template: resolve(ctx, key, documentId) as TemplateOut };
}

export async function forDocumentClear(ctx: MailCtx, input: { documentId: string; key: string }): Promise<{ cleared: boolean }> {
  ensureTemplates(ctx);
  const key = keyOf(ctx, input.key);
  const documentId = documentOf(ctx, input.documentId);
  if (!docRow(ctx, documentId, key)) return { cleared: false };
  ctx.db.run(`DELETE FROM mail_template_doc WHERE "documentId" = ? AND key = ?`, documentId, key);
  return { cleared: true };
}

// ---- rendering

export interface Rendered {
  subject: string;
  text: string;
  html?: string;
  source: TemplateOut["source"] | "draft";
  blanks: string[];
  fallbacks: string[];
}

function valuesOf(fields: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof fields !== "object" || fields === null) return out;
  for (const [k, v] of Object.entries(fields as Record<string, unknown>))
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k.toLowerCase()] = String(v);
  return out;
}

/**
 * Fill a template. Values come from the record (read as the caller) and from `vars`, which win. Nothing is sent from here: mail.send takes the result.
 * A subject never keeps a line break, whatever a value held.
 */
export async function render(
  ctx: MailCtx,
  input: { key?: string; documentId?: string; subject?: string; text?: string; html?: string; recordId?: string; vars?: Record<string, unknown> },
): Promise<Rendered> {
  ensureTemplates(ctx);
  let source: Rendered["source"];
  let body: Body;
  if (input.key !== undefined) {
    const key = keyOf(ctx, input.key);
    const documentId = input.documentId === undefined ? undefined : documentOf(ctx, input.documentId);
    const t = resolve(ctx, key, documentId);
    if (!t) return missing(ctx, "There is no template with that key.");
    source = t.source;
    body = { subject: t.subject, text: t.text, ...(t.html ? { html: t.html } : {}) };
  } else {
    source = "draft";
    body = bodyOf(ctx, input as unknown as Record<string, unknown>);
  }
  const values: Record<string, string> = {};
  if (input.recordId !== undefined) {
    if (typeof input.recordId !== "string" || !/^rec_[a-z0-9]+$/.test(input.recordId)) bad(ctx, "Record id is not valid.");
    const found = await findRecord((cap, i) => ctx.call(cap, i), input.recordId);
    if (!found) return missing(ctx, "That record does not exist.");
    Object.assign(values, valuesOf(found.record.fields));
  }
  if (input.vars !== undefined) {
    if (typeof input.vars !== "object" || input.vars === null || Array.isArray(input.vars)) bad(ctx, "Vars is a list of names and values.");
    for (const [k, v] of Object.entries(input.vars)) {
      if (!/^[a-z][a-z0-9_]*$/i.test(k)) bad(ctx, `${k} is not a field name.`);
      if (v === null || v === undefined) continue;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") bad(ctx, `${k} must be text, a number or yes or no.`);
      values[k.toLowerCase()] = String(v);
    }
  }
  const subject = fillTokens(body.subject, values);
  const text = fillTokens(body.text, values);
  const html = body.html === undefined ? undefined : fillTokens(body.html, values, { html: true });
  const blanks = [...new Set([...subject.blanks, ...text.blanks, ...(html?.blanks ?? [])])];
  const fallbacks = [...new Set([...subject.fallbacks, ...text.fallbacks, ...(html?.fallbacks ?? [])])];
  return {
    subject: subject.text.replace(/\s*[\r\n]+\s*/g, " ").trim(),
    text: text.text,
    ...(html ? { html: html.text } : {}),
    source,
    blanks,
    fallbacks,
  };
}

export const preview = render;

/**
 * The send input with its template filled in: subject, text and html set, the template fields removed. Refuses, saying which fields, when any would go out
 * blank, and when the caller also wrote their own subject or text (one source of words, never two).
 */
export async function fillSend<T extends { templateKey?: string; documentId?: string; recordId?: string; vars?: Record<string, unknown>; subject?: string; text?: string; html?: string }>(
  ctx: MailCtx,
  input: T,
): Promise<Omit<T, "templateKey" | "documentId" | "recordId" | "vars"> & { subject: string }> {
  if (input.subject !== undefined || input.text !== undefined || input.html !== undefined)
    bad(ctx, "Send either a template or your own subject and text, not both.");
  const r = await render(ctx, {
    key: input.templateKey as string,
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    ...(input.recordId !== undefined ? { recordId: input.recordId } : {}),
    ...(input.vars !== undefined ? { vars: input.vars } : {}),
  });
  if (r.blanks.length > 0) {
    const list = r.blanks.join(", ");
    throw fail("validation.precondition_failed", ctx.trace.traceId, {
      message: `Not sent. The template ${input.templateKey} still needs a value for ${list}.`,
    });
  }
  const { templateKey: _k, documentId: _d, recordId: _r, vars: _v, ...rest } = input;
  return { ...rest, subject: r.subject, text: r.text, ...(r.html ? { html: r.html } : {}) };
}
