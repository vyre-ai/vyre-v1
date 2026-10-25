// Import: stage a source (spec 2.9 Lifecycle, 2.10) and suggest a mapping. A parse reads the source into a session that expires after 24 hours and reports its tables and columns with what they
// look like; it changes no record and no record type. suggest_mapping offers which column feeds which field of a record type, and which columns could become new fields.
import { airtable, notion, sheets } from "../providers.ts";
import { call, clean, codeOf, createSession, ensure, raise, staged, tableOf } from "../projections.ts";
import type { ImportCtx, In, Session, Table } from "../projections.ts";
import { suggest, slug } from "../mapping.ts";
import type { FieldInfo } from "../mapping.ts";
import { csvTablesFromZip, detectDelimiter, isZip, parseCsvText, readXlsx, tableFrom } from "../sources.ts";

const summary = (s: Session) => ({
  importId: s.importId, source: s.source, expiresAt: s.expiresAt,
  tables: s.tables.map((t) => ({ name: t.name, rowCount: t.rows.length, columns: t.columns.map((c) => ({ name: c.name, inferred: c.inferred, sample: c.sample, distinct: c.distinct, empty: c.empty })) })),
});

/** A table with nothing to import is refused early, with a message a person can act on. */
function nonEmpty(ctx: ImportCtx, tables: readonly Table[], what: string): void {
  if (tables.length === 0 || tables.every((t) => t.columns.length === 0)) raise(ctx, "validation.bad_input", `${what} has nothing in it to import.`);
}

async function readText(ctx: ImportCtx, fileId: string): Promise<string> {
  try { return (await call<{ text?: string }>(ctx, "files.read", { fileId, as: "text" })).text ?? ""; } catch (e) {
    if (codeOf(e) === "validation.not_found") raise(ctx, "validation.bad_input", "That file does not exist.", { fileId });
    throw e;
  }
}
async function readBytes(ctx: ImportCtx, fileId: string): Promise<Uint8Array> {
  const r = await call<{ base64?: string }>(ctx, "files.read", { fileId, as: "base64" });
  return new Uint8Array(Buffer.from(r.base64 ?? "", "base64"));
}

// ---- parse_csv ----

export async function parseCsv(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  if ((input.fileId === undefined) === (input.text === undefined)) raise(ctx, "validation.bad_input", "Give the CSV as a file or as text, one of the two.");
  const text: string = input.text !== undefined ? String(input.text) : await readText(ctx, input.fileId);
  const delimiter: string = input.delimiter !== undefined ? String(input.delimiter) : detectDelimiter(text);
  const grid = parseCsvText(text, delimiter);
  const table = tableFrom("CSV", grid, input.hasHeader !== false);
  nonEmpty(ctx, [table], "That CSV");
  return summary(createSession(ctx, "csv", [table]));
}

// ---- parse_excel ----

export async function parseExcel(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const bytes = await readBytes(ctx, input.fileId);
  let book: ReturnType<typeof readXlsx>;
  try { book = readXlsx(bytes); } catch (e) { raise(ctx, "validation.bad_input", e instanceof Error ? e.message : "That is not an Excel file.", { fileId: input.fileId }); }
  const wanted: string[] | undefined = input.sheets;
  const picked = wanted && wanted.length > 0 ? book.filter((s) => wanted.includes(s.name)) : book;
  if (wanted && wanted.length > 0 && picked.length === 0) raise(ctx, "validation.bad_input", "That workbook has no sheet by that name.", { sheets: book.map((s) => s.name) });
  const tables = picked.map((s) => tableFrom(s.name, s.rows)).filter((t) => t.columns.length > 0);
  nonEmpty(ctx, tables, "That workbook");
  return summary(createSession(ctx, "excel", tables));
}

// ---- parse_airtable, parse_notion, parse_google_sheets ----

export async function parseAirtable(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const tables = await airtable(ctx, input.baseUrl, input.key, input.tables);
  nonEmpty(ctx, tables, "That base");
  return summary(createSession(ctx, "airtable", tables));
}

export async function parseNotion(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  if ((input.url === undefined) === (input.exportFileId === undefined)) raise(ctx, "validation.bad_input", "Give a Notion database address or an export file, one of the two.");
  let tables: Table[];
  if (input.url !== undefined) {
    if (input.key === undefined) raise(ctx, "validation.bad_input", "Reading a Notion database needs a key from the Vault.");
    tables = await notion(ctx, input.url, input.key);
  } else {
    const bytes = await readBytes(ctx, input.exportFileId);
    if (isZip(bytes)) {
      try { tables = csvTablesFromZip(bytes); } catch { raise(ctx, "validation.bad_input", "That export could not be opened.", { fileId: input.exportFileId }); }
    } else {
      const text = new TextDecoder().decode(bytes);
      tables = [tableFrom("Notion", parseCsvText(text, detectDelimiter(text)))];
    }
  }
  nonEmpty(ctx, tables, "That Notion export");
  return summary(createSession(ctx, "notion", tables));
}

export async function parseGoogleSheets(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const tables = await sheets(ctx, input.url, input.tabs);
  nonEmpty(ctx, tables, "That sheet");
  return summary(createSession(ctx, "google_sheets", tables));
}

// ---- suggest_mapping ----

interface TypeOut { fields?: Array<{ key: string; type: string; title?: string; required?: boolean; default?: unknown; options?: Record<string, unknown> }> }
export async function fieldsOf(ctx: ImportCtx, type: string): Promise<FieldInfo[]> {
  const r = await call<{ type?: TypeOut }>(ctx, "schema.types.get", { type });
  return (r.type?.fields ?? []).map((f) => clean({ key: f.key, type: f.type, title: f.title, required: f.required, hasDefault: f.default !== undefined, options: f.options }) as FieldInfo);
}

export async function suggestMapping(ctx: ImportCtx, input: In): Promise<unknown> {
  const s = staged(ctx, input.importId, "validation.not_found");
  if (s.state !== "staged") raise(ctx, "validation.bad_input", "That import was already written.", { state: s.state });
  const table = tableOf(ctx, s, input.table);
  const fields = await fieldsOf(ctx, input.type);
  const picks = suggest(table.columns.map((c) => c.name), fields);
  const taken = new Set(fields.map((f) => f.key));
  const newFields = picks.filter((p) => p.field === undefined).map((p) => {
    const col = table.columns.find((c) => c.name === p.column);
    let key = slug(p.column), n = 2;
    while (taken.has(key)) key = `${slug(p.column)}_${n++}`;
    taken.add(key);
    return { column: p.column, key, type: col?.inferred ?? "text" };
  });
  return {
    mapping: picks.map((p) => clean({ column: p.column, field: p.field, confidence: p.confidence })),
    unmapped: picks.filter((p) => p.field === undefined).map((p) => p.column),
    newFields,
  };
}
