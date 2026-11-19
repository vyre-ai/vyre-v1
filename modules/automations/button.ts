// A button trigger starts when someone presses a Button field on a record, so its record type must have one (r40 audit, gap 6).
import type { AutoCtx, Definition } from "./projections.ts";

/** The record type a button trigger is for: the one the press names, else the one the trigger is set to. */
export const buttonType = (def: Definition, pressed?: unknown): string | undefined => {
  if (typeof pressed === "string" && pressed) return pressed;
  const t = def.triggers.find((x) => x.key === "button")?.config?.["type"];
  return typeof t === "string" && t ? t : undefined;
};

/** The line for a record type that has no Button field, or nothing when it has one (or the type cannot be read, which does not stop a press). */
export async function noButtonLine(ctx: Pick<AutoCtx, "call">, type: string): Promise<string | undefined> {
  if (!ctx.call) return undefined;
  try {
    const d = (await ctx.call("schema.describe", { type })) as {
      types?: { title?: string; fields?: { type?: string }[] }[];
    } | null;
    const t = d?.types?.[0];
    if (!t || !Array.isArray(t.fields) || t.fields.some((f) => f.type === "button")) return undefined;
    const name = t.title ?? type;
    return `${name} has no Button field, so nothing can press this trigger. Add a Button field to ${name} in its record type, then press it on a record.`;
  } catch {
    return undefined;
  }
}
