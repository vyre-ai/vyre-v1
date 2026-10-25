// Import: read an import, list them, drop a staged one, and the CSV template of a record type (spec 2.9).
import { call, clean, ensure, findSession, dropSession, listSessions, page, raise } from "../projections.ts";
import type { ImportCtx, In, Session } from "../projections.ts";
import { IMPORTABLE } from "../mapping.ts";

// DECISION: an import that has not been previewed has no record type yet; it shows the type `pending`.
const row = (s: Session) => clean({
  importId: s.importId, source: s.source, type: s.type ?? "pending", state: s.state, runId: s.runId, by: s.createdBy, at: s.createdAt, created: s.created, updated: s.updated, skipped: s.skipped, failed: s.failed,
  ranAutomations: s.ranAutomations, errorsFileId: s.errorsFileId,
});

export async function get(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const s = findSession(ctx.db, input.importId);
  if (!s) raise(ctx, "validation.bad_input", "That import does not exist.", { importId: input.importId });
  return { import: row(s) };
}

export async function list(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const pg = page(listSessions(ctx.db, input.type), input.cursor, input.limit);
  return clean({ imports: pg.rows.map(row), next: pg.next, total: pg.total });
}

export async function discard(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const s = findSession(ctx.db, input.importId);
  if (!s) raise(ctx, "validation.bad_input", "That import does not exist.", { importId: input.importId });
  // only what was never written can be dropped; a written import stays as the record of what happened
  if (s.state !== "staged") return { discarded: false };
  return { discarded: dropSession(ctx.db, s.importId) };
}

const EXAMPLE: Record<string, string> = {
  text: "Example", longtext: "A longer note", number: "42", money: "$1,200.00", datetime: "2026-01-31", duration: "90", checkbox: "yes", rating: "4", email: "name@example.com",
  phone: "+1 555 010 0100", url: "https://example.com", person: "usr_a1b2c3", multichoice: "one; two",
};
const quote = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function template(ctx: ImportCtx, input: In): Promise<unknown> {
  const r = await call<{ type?: { fields?: Array<{ key: string; type: string; title?: string; options?: Record<string, unknown> }> } }>(ctx, "schema.types.get", { type: input.type });
  const fields = (r.type?.fields ?? []).filter((f) => IMPORTABLE.has(f.type));
  const first = (f: { type: string; options?: Record<string, unknown> }): string => {
    const choices = (f.options?.["choices"] ?? f.options?.["stages"]) as Array<{ key?: string; title?: string }> | undefined;
    if ((f.type === "choice" || f.type === "status" || f.type === "multichoice") && Array.isArray(choices) && choices.length > 0) return String(choices[0]?.title ?? choices[0]?.key ?? "");
    return EXAMPLE[f.type] ?? "Example";
  };
  return { text: `${fields.map((f) => quote(f.title ?? f.key)).join(",")}\n${fields.map((f) => quote(first(f))).join(",")}\n` };
}
