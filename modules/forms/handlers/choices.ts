// Publisher-approved choices for a public relation or person question. A public form cannot ask a visitor to pick a record or a person unless the publisher has published a bounded list of them: the visitor
// sees only each choice's display label under an opaque key, and a submit must name one of those keys. The record or person behind a key is looked up here, never sent out, and the publisher's authority is
// asked again at every submit, so a record that is deleted, re-labelled above the public ceiling or no longer visible to them simply stops being offered.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { fail, fieldsOf, formsConfig, many, mustForm, optStr, randomToken, rec, reqStr, str } from "../projections.ts";
import type { FormSchemaField, Row } from "../projections.ts";

export const MAX_CHOICES = 200;
export const CHOICE_KEY = /^chc_[A-Za-z0-9_-]{8,40}$/;

export interface Choice { key: string; refId: string; kind: "record" | "person"; label: string }

/** Is this question one that needs published choices on a public form? */
export const needsChoices = (field: FormSchemaField): boolean => field.type === "relation" || field.type === "person";

export function choicesOf(ctx: Ctx, formId: string, field?: string): Choice[] {
  return many(ctx, "SELECT * FROM forms_choice WHERE form_id = ?", formId)
    .filter((r) => field === undefined || r.field === field)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => ({ key: str(r.key), refId: str(r.ref_id), kind: str(r.kind) as Choice["kind"], label: str(r.label), ...(field === undefined ? { field: str(r.field) } : {}) }) as Choice);
}

export function choiceByKey(ctx: Ctx, formId: string, field: string, key: string): (Choice & { setBy: string }) | null {
  const r = many(ctx, "SELECT * FROM forms_choice WHERE form_id = ? AND field = ? AND key = ?", formId, field, key)[0];
  return r ? { key: str(r.key), refId: str(r.ref_id), kind: str(r.kind) as Choice["kind"], label: str(r.label), setBy: str(r.set_by) } : null;
}

async function schemaField(ctx: Ctx, form: Row, field: string): Promise<FormSchemaField> {
  const reader = formsConfig().schemaFields;
  if (!reader) fail(ctx, "internal.unavailable", "The schema is not available to read this question.");
  const found = (await reader!(str(form.record_type))).find((f) => f.key === field);
  if (!found) fail(ctx, "validation.bad_input", `${field} is not a field of this form's record type.`, { field: "field" });
  if (!needsChoices(found!)) fail(ctx, "validation.bad_input", `${found!.title} is not a record or person question, so it has no choices to publish.`, { field: "field" });
  const asked = fieldsOf(ctx, str(form.id)).some((f) => f.field === field && f.mode === "ask");
  if (!asked) fail(ctx, "validation.precondition_failed", `Ask ${found!.title} in Build first.`, { field: "field" });
  return found!;
}

function source(ctx: Ctx) {
  const s = formsConfig().choiceSource;
  if (!s) fail(ctx, "internal.unavailable", "This server cannot look up records to publish as choices.");
  return s!;
}

/** Publish (replace) the list for one question. Every entry is looked up as the person asking, and the whole call is refused, naming the entry, if any one cannot be offered. */
export async function choicesSet(ctx: Ctx, input: unknown): Promise<{ choices: Choice[] }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const fieldKey = reqStr(ctx, o, "field");
  const list = o.choices;
  if (!Array.isArray(list)) fail(ctx, "validation.bad_input", "The choices are a list.", { field: "choices" });
  if ((list as unknown[]).length > MAX_CHOICES) fail(ctx, "validation.too_large", `A question can offer at most ${MAX_CHOICES} choices.`, { field: "choices" });
  const field = await schemaField(ctx, form, fieldKey);
  const ids: string[] = [];
  for (const item of list as unknown[]) {
    const id = typeof item === "object" && item !== null ? (item as Record<string, unknown>)["refId"] : undefined;
    if (typeof id !== "string" || id.length === 0 || id.length > 80) fail(ctx, "validation.bad_input", "Each choice names a record or person by refId.", { field: "choices" });
    if (!ids.includes(id as string)) ids.push(id as string);
  }
  const who = ctx.actingFor ?? ctx.principal.id;
  const resolved: { refId: string; label: string }[] = [];
  for (const refId of ids) {
    const info = await source(ctx).describe(who, field, refId);
    if (!info.ok) fail(ctx, "validation.precondition_failed", info.reason, { field: "choices", refId });
    resolved.push({ refId, label: (info as { label: string }).label });
  }
  // a choice that stays keeps its key (a page already open keeps working); a new one gets a fresh opaque key
  const have = new Map(many(ctx, "SELECT * FROM forms_choice WHERE form_id = ? AND field = ?", str(form.id), fieldKey).map((r) => [str(r.ref_id), str(r.key)]));
  ctx.db.run("DELETE FROM forms_choice WHERE form_id = ? AND field = ?", str(form.id), fieldKey);
  const kind = field.type === "person" ? "person" : "record";
  resolved.forEach((c, position) => {
    const key = have.get(c.refId) ?? `chc_${randomToken(12)}`;
    ctx.db.run("INSERT INTO forms_choice (form_id, field, key, ref_id, kind, label, position, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", str(form.id), fieldKey, key, c.refId, kind, c.label, position, who, ctx.now());
  });
  ctx.emit("form.choices_changed", `form/${str(form.id)}`, { formId: str(form.id), field: fieldKey, count: resolved.length });
  return { choices: choicesOf(ctx, str(form.id), fieldKey) };
}

/** What the publisher could offer for a question: records they can see, or members, label only. */
export async function choicesCandidates(ctx: Ctx, input: unknown): Promise<{ candidates: { refId: string; label: string }[] }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const field = await schemaField(ctx, form, reqStr(ctx, o, "field"));
  const q = optStr(ctx, o, "q");
  return { candidates: (await source(ctx).candidates(ctx.actingFor ?? ctx.principal.id, field, q)).slice(0, MAX_CHOICES) };
}
