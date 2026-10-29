// Ask Vyre on a form's source (the forms builder's Code tab): an agent proposes changes to the HTML, CSS or JavaScript, and the author accepts or rejects each one. The same Ask driver as the email builder
// (host/src/seams/email-ask.ts) runs one real agent turn as the asker; whatever it answers is held to exactly the rules of a save, and nothing is written here. The proposal comes back as a per-field diff.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { fail, fieldsOf, formsConfig, isNull, mustForm, optStr, rec, reqStr, str } from "../projections.ts";
import { validateCss, validateHtml, validateJs } from "./source.ts";

/** What the host's driver offers; structural, the host owns it. */
export interface FormAskDriver {
  propose(req: { instruction: string; agentId: string | null; doc: Record<string, unknown>; principal: { kind: "person" | "agent" | "service"; id: string }; actingFor?: string; signal?: AbortSignal }): Promise<Record<string, unknown>>;
  cancel?(asker: string, formId: string): number;
}
let driver: FormAskDriver | null = null;
/** The host calls this once at start with the driver that runs an agent turn in the Ask pane. Null clears it. */
export function configureFormsAsk(o: { ask: FormAskDriver | null } | null): void { driver = o?.ask ?? null; }

const SOURCE_KEYS = ["html", "css", "js"] as const;

export async function askDiff(ctx: Ctx, input: unknown): Promise<{ changes: { path: string; before: string; after: string }[] }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const instruction = reqStr(ctx, o, "instruction");
  if (instruction.length > 4000) fail(ctx, "validation.too_large", "An instruction is at most 4000 characters.", { field: "instruction" });
  if (!driver) fail(ctx, "validation.precondition_failed", "No agent is connected to answer. Open Settings and add a model.");
  const agentId = optStr(ctx, o, "agentId") ?? null;
  const current = { html: isNull(form.html) ? "" : str(form.html), css: isNull(form.css) ? "" : str(form.css), js: isNull(form.js) ? "" : str(form.js) };
  const schema = formsConfig().schemaFields ? await formsConfig().schemaFields!(str(form.record_type)).catch(() => []) : [];
  const questions = fieldsOf(ctx, str(form.id)).filter((f) => f.mode === "ask").map((f) => ({ key: str(f.field), title: schema.find((s) => s.key === str(f.field))?.title ?? str(f.field) }));
  let proposal: Record<string, unknown>;
  try {
    proposal = await driver.propose({ instruction, agentId, doc: { formId: str(form.id), ...current, questions }, principal: { kind: ctx.principal.kind, id: ctx.principal.id }, ...(ctx.actingFor ? { actingFor: ctx.actingFor } : {}) });
  } catch (e) {
    // the driver says why in an error code of the catalogue; anything else is told plainly, never as a stack
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "string" && ERROR_CODES.some((c) => c.code === code)) fail(ctx, code as ErrorCode, e instanceof Error ? e.message : undefined);
    fail(ctx, "internal.unexpected", "The agent could not answer. Try again.");
  }
  const changes: { path: string; before: string; after: string }[] = [];
  for (const key of Object.keys(proposal)) if (!(SOURCE_KEYS as readonly string[]).includes(key)) fail(ctx, "validation.bad_input", `The agent proposed a change to ${key}, which is not part of the form's source. Try again.`);
  for (const key of SOURCE_KEYS) {
    const after = proposal[key];
    if (after === undefined) continue;
    if (typeof after !== "string") fail(ctx, "validation.bad_input", `The agent's ${key} was not text. Try again.`);
    if (after === current[key]) continue;
    // the same rules as a save, and a refusal says it was the agent's proposal
    if (key === "html") validateHtml(ctx, form, after as string, "The agent's HTML");
    else if (key === "css") validateCss(ctx, after as string);
    else validateJs(ctx, after as string, "The agent's JavaScript");
    changes.push({ path: `/${key}`, before: current[key], after: after as string });
  }
  return { changes };
}

export async function askCancel(ctx: Ctx, input: unknown): Promise<{ cancelled: number }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  // only the caller's own Asks (the driver keys them by person and subject)
  return { cancelled: driver?.cancel?.(ctx.actingFor ?? ctx.principal.id, str(form.id)) ?? 0 };
}
