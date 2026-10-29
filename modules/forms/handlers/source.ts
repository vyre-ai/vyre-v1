// The checks a form's source passes, in one place: a save (forms.design_set) and an agent's proposal (forms.ask_diff) are held to exactly the same rules.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { checkFormHtml, checkFormJs } from "../../../lib/form-source.ts";
import { fail, fieldsOf, isNull, str } from "../projections.ts";
import type { Row } from "../projections.ts";

export const CSS_MAX = 50_000;

export function validateCss(ctx: Ctx, css: string): void {
  if (css.length > CSS_MAX) fail(ctx, "validation.too_large", "The custom CSS is too large.", { field: "css" });
  if (/<\/?\s*style|<script|@import|javascript:|expression\s*\(/i.test(css)) fail(ctx, "validation.bad_input", "The custom CSS may not load other files or run script.", { field: "css" });
}

/** HTML is the template grammar, every placed field an asked question of this form, and one page (steps are flattened by custom HTML, so more than one is refused). */
export function validateHtml(ctx: Ctx, form: Row, html: string, who = "The form HTML"): void {
  if (html.length === 0) return;
  const checked = checkFormHtml(html);
  if (!checked.ok) fail(ctx, "validation.bad_input", `${who} is not valid: ${checked.reason}`, { field: "html" });
  const asked = fieldsOf(ctx, str(form.id)).filter((f) => f.mode === "ask");
  const names = new Set(asked.map((f) => str(f.field)));
  const unknown = checked.fields.filter((name) => !names.has(name));
  if (unknown.length > 0) fail(ctx, "validation.bad_input", `${unknown.join(", ")} ${unknown.length === 1 ? "is not a question" : "are not questions"} on this form. Ask for ${unknown.length === 1 ? "it" : "them"} in Build first.`, { field: "html" });
  const steps = new Set(asked.map((f) => (isNull(f.step) ? 0 : Number(f.step))));
  if (steps.size > 1) fail(ctx, "validation.precondition_failed", "Custom HTML places every question on one page. Put all questions on one step first.", { field: "html" });
}

export function validateJs(ctx: Ctx, js: string, who = "The form JavaScript"): void {
  const checked = js.length > 0 ? checkFormJs(js) : { ok: true as const };
  if (!checked.ok) fail(ctx, "validation.bad_input", `${who} is not valid: ${checked.reason}`, { field: "js" });
}
