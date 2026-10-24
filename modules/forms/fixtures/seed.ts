// Test helpers: call a handler by name, read the error code of a refused call, and open a form in one line.

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { formPrincipal } from "../handlers/submit.ts";
import type { World } from "./world.ts";

type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
export type Cap = keyof typeof handlers;

export async function run<T>(ctx: Ctx, cap: Cap, input: unknown): Promise<T> {
  return (await (handlers[cap] as Fn)(ctx, input)) as T;
}

/** The error code of a refused call, or "none" when it was accepted. Anything that is not a VyreErr is a test failure. */
export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VyreErr) return e.error.code;
    throw e;
  }
  return "none";
}

export interface OpenForm { formId: string; slug: string; public: Ctx }

export interface FormOpts {
  kind?: "public" | "one_use" | "survey";
  name?: string;
  recordType?: string;
  fields?: { field: string; mode: "ask" | "show" | "hide"; prefillKey?: string; step?: number }[];
  consentText?: string;
  captcha?: boolean;
  rateLimit?: number;
  matchRule?: string[];
  publish?: boolean;
}

/** Create a form, set its fields and settings, and publish it. Returns the public ctx: the same world as svc_form_<id>. */
export async function openForm(w: World, o: FormOpts = {}): Promise<OpenForm> {
  const made = await run<{ form: { formId: string; slug: string } }>(w.ctx, "forms.create", { name: o.name ?? "Intake", recordType: o.recordType ?? "contact", kind: o.kind ?? "public" });
  const formId = made.form.formId;
  await run(w.ctx, "forms.fields_set", { formId, fields: o.fields ?? [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }, { field: "phone", mode: "ask" }] });
  const settings: Record<string, unknown> = { formId };
  if (o.consentText !== undefined) settings.consentText = o.consentText;
  if (o.captcha !== undefined) settings.captcha = o.captcha;
  if (o.rateLimit !== undefined) settings.rateLimit = o.rateLimit;
  if (o.matchRule !== undefined) settings.matchRule = o.matchRule;
  if (Object.keys(settings).length > 1) await run(w.ctx, "forms.update", settings);
  if (o.publish !== false) await run(w.ctx, "forms.publish", { formId });
  return { formId, slug: made.form.slug, public: w.as({ kind: "service", id: formPrincipal(formId) }) };
}
