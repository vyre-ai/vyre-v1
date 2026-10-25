// Import: preview (spec 2.9 Lifecycle). The rows to create, update or skip, the rows that cannot be converted and why, the fields the import would add, and a token for this exact plan.
// A preview reads the staged rows, the record type and (for a match) the records that exist; it writes no record and changes no record type. The plan it checked is kept with the staged
// import under the token, and commit takes only that token.
import { compileTransform, convert, IMPORTABLE } from "../mapping.ts";
import type { FieldInfo, Transform } from "../mapping.ts";
import { call, clean, hashOf, raise, saveSession, stable, staged, tableOf } from "../projections.ts";
import type { ImportCtx, In, Mapping, NewField, Plan, RowError, Session, Table } from "../projections.ts";
import { fieldsOf } from "./parse.ts";

export const ERRORS_SHOWN = 50;
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;

export interface Built { fields: Record<string, unknown> | undefined; errors: RowError[]; blank: boolean }

/** The transforms of a mapping, checked once. */
export function compileAll(ctx: ImportCtx, mapping: readonly Mapping[]): Map<Mapping, Transform | undefined> {
  const out = new Map<Mapping, Transform | undefined>();
  for (const m of mapping) {
    if (m.transform === undefined || m.transform.trim() === "") { out.set(m, undefined); continue; }
    const c = compileTransform(m.transform);
    if (!c.ok) raise(ctx, "validation.bad_input", `The transform for ${m.column}: ${c.message}`, { column: m.column, transform: m.transform });
    out.set(m, c);
  }
  return out;
}

/** Every data row of a table as the fields of a record, or the reasons it cannot be one. Pure and repeatable: commit builds the same rows from the same plan. */
export function buildRows(table: Table, mapping: readonly Mapping[], fields: ReadonlyMap<string, FieldInfo>, transforms: ReadonlyMap<Mapping, Transform | undefined>): Built[] {
  const at = new Map(table.columns.map((c, i) => [c.name, i] as const));
  return table.rows.map((row, i) => {
    const rec: Record<string, unknown> = {};
    const errors: RowError[] = [];
    let anyCell = false;
    for (const m of mapping) {
      const raw = row[at.get(m.column) as number] ?? "";
      if (raw.trim() !== "") anyCell = true;
      const f = fields.get(m.field) as FieldInfo;
      const t = transforms.get(m);
      const out = convert(f, t ? t.run(raw) : raw);
      if (!out.ok) errors.push({ row: i + 1, column: m.column, message: out.message });
      else if (!("empty" in out)) rec[m.field] = out.value;
    }
    if (errors.length === 0) {
      for (const f of fields.values()) {
        if (f.required === true && f.hasDefault !== true && rec[f.key] === undefined && mapping.some((m) => m.field === f.key) && anyCell) errors.push({ row: i + 1, column: mapping.find((m) => m.field === f.key)?.column, message: `${f.title ?? f.key} is required.` });
      }
    }
    return { fields: errors.length === 0 && anyCell ? rec : undefined, errors, blank: !anyCell && errors.length === 0 };
  });
}

const keyOf = (fields: Record<string, unknown>, match: readonly string[]): string | undefined => {
  const vals = match.map((k) => fields[k]);
  return vals.some((v) => v === undefined) ? undefined : stable(vals);
};

/** Which of these rows already exist: records of the type whose match fields equal the row's, asked in chunks. */
async function existing(ctx: ImportCtx, type: string, match: readonly string[], rows: readonly Built[]): Promise<Set<string>> {
  const wanted = new Map<string, Record<string, unknown>>();
  for (const b of rows) {
    if (!b.fields) continue;
    const k = keyOf(b.fields, match);
    if (k !== undefined && !wanted.has(k)) wanted.set(k, b.fields);
  }
  const found = new Set<string>();
  const list = [...wanted.values()];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const filter = { or: chunk.map((f) => ({ and: match.map((k) => ({ field: k, op: "eq", value: f[k] })) })) };
    const res = await call<{ rows?: Array<{ fields?: Record<string, unknown> }> }>(ctx, "records.query", { type, filter, fields: [...match], limit: 5000 });
    for (const r of res.rows ?? []) { const k = r.fields ? keyOf(r.fields, match) : undefined; if (k !== undefined) found.add(k); }
  }
  return found;
}

/** What each row would do: c create, u update, s skip, e error. */
export async function classify(ctx: ImportCtx, type: string, match: readonly string[], onMatch: Plan["onMatch"], rows: readonly Built[]): Promise<string> {
  const have = match.length > 0 ? await existing(ctx, type, match, rows) : new Set<string>();
  const seen = new Set<string>();
  let out = "";
  for (const b of rows) {
    if (b.errors.length > 0) { out += "e"; continue; }
    if (!b.fields) { out += "s"; continue; }
    const k = match.length > 0 ? keyOf(b.fields, match) : undefined;
    const exists = k !== undefined && (have.has(k) || seen.has(k));
    if (k !== undefined) seen.add(k);
    out += !exists ? "c" : onMatch === "skip" ? "s" : onMatch === "create" ? "c" : "u";
  }
  return out;
}

/** The plan without its per-row actions: what the token covers. */
export const planBase = (p: Plan): Omit<Plan, "actions"> => ({ table: p.table, type: p.type, mapping: p.mapping, match: p.match, onMatch: p.onMatch, createFields: p.createFields, runAutomations: p.runAutomations, newFields: p.newFields });
export const tokenFor = (s: Pick<Session, "importId" | "dataHash">, plan: Omit<Plan, "actions">): string => `pv_${hashOf(stable({ importId: s.importId, dataHash: s.dataHash, plan }))}`;

export async function preview(ctx: ImportCtx, input: In): Promise<unknown> {
  const s = staged(ctx, input.importId, "validation.not_found");
  if (s.state !== "staged") raise(ctx, "validation.bad_input", "That import was already written.", { state: s.state });
  const table = tableOf(ctx, s, input.table);
  const fields = new Map((await fieldsOf(ctx, input.type)).map((f) => [f.key, f] as const));
  const mapping = (input.mapping as Mapping[]).map((m) => clean({ column: m.column, field: m.field, transform: m.transform }) as Mapping);
  if (mapping.length === 0) raise(ctx, "validation.bad_input", "Map at least one column to a field.");
  const columns = new Map(table.columns.map((c) => [c.name, c] as const));
  const createFields = input.createFields === true;
  const newFields: NewField[] = [];
  const fed = new Set<string>();
  for (const m of mapping) {
    const col = columns.get(m.column);
    if (!col) raise(ctx, "validation.bad_input", `This table has no column called ${m.column}.`, { column: m.column });
    if (!FIELD_KEY.test(m.field)) raise(ctx, "validation.bad_input", `${m.field} is not a field key.`, { field: m.field });
    if (fed.has(m.field)) raise(ctx, "validation.bad_input", `Two columns feed ${m.field}.`, { field: m.field });
    fed.add(m.field);
    if (!fields.has(m.field)) {
      if (!createFields) raise(ctx, "validation.bad_input", `${m.field} is not a field of ${input.type}. Tick create fields to add it.`, { field: m.field });
      const type = col.inferred === "choice" ? "text" : col.inferred;
      newFields.push({ key: m.field, type, title: m.column });
      fields.set(m.field, { key: m.field, type, title: m.column });
    }
    const f = fields.get(m.field) as FieldInfo;
    if (!IMPORTABLE.has(f.type)) raise(ctx, "validation.bad_input", `${f.title ?? f.key} is a ${f.type} field, which an import cannot fill.`, { field: m.field });
  }
  const match: string[] = input.match ?? [];
  for (const k of match) if (!fed.has(k)) raise(ctx, "validation.bad_input", `${k} identifies existing records, so a column must feed it.`, { field: k });
  const missing = [...fields.values()].filter((f) => f.required === true && f.hasDefault !== true && !fed.has(f.key) && !newFields.some((n) => n.key === f.key));
  if (missing.length > 0) raise(ctx, "validation.bad_input", `${missing.map((f) => f.title ?? f.key).join(", ")} ${missing.length === 1 ? "is" : "are"} required and no column feeds ${missing.length === 1 ? "it" : "them"}.`, { fields: missing.map((f) => f.key) });

  const rows = buildRows(table, mapping, fields, compileAll(ctx, mapping));
  const onMatch: Plan["onMatch"] = input.onMatch ?? "update";
  const actions = await classify(ctx, input.type, match, onMatch, rows);
  const count = (c: string): number => [...actions].filter((x) => x === c).length;
  const errors = rows.flatMap((b) => b.errors);
  const base: Omit<Plan, "actions"> = { table: table.name, type: input.type, mapping, match, onMatch, createFields, runAutomations: input.runAutomations === true, newFields };
  const previewToken = tokenFor(s, base);
  s.type = input.type;
  s.plan = { ...base, actions };
  s.previewToken = previewToken;
  saveSession(ctx.db, s);
  return {
    previewToken, creates: count("c"), updates: count("u"), skips: count("s"),
    errors: errors.slice(0, ERRORS_SHOWN).map((e) => clean({ row: e.row, column: e.column, message: e.message })), errorCount: errors.length,
    newFields: newFields.map((n) => ({ key: n.key, type: n.type })), samples: rows.filter((b) => b.fields).slice(0, 5).map((b) => b.fields as Record<string, unknown>),
  };
}
