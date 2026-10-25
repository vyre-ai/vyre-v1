// Import: the apps an import can read from (spec 2.10): Airtable and Notion through their APIs with a key held in the Vault, and Google Sheets through the google module.
// The key is read for one call and never kept. A refused key is provider.auth_failed, an app that does not answer is provider.unavailable, a base or database that is not there is bad_input.
// DECISION: every cell is read as the text a person would see (a list is joined with commas, a person by name, a file by its address), so a preview and a mapping work the same for every source.
import { call, codeOf, needHost, raise } from "./projections.ts";
import type { ImportCtx, Table } from "./projections.ts";
import { tableFrom } from "./sources.ts";

type Json = Record<string, unknown>;

async function get(ctx: ImportCtx, handle: string, url: string, init: { method?: string; body?: string } = {}, app: string): Promise<Json> {
  const key = await needHost(ctx).secret(ctx, handle);
  if (!ctx.http) raise(ctx, "provider.unavailable", `${app} cannot be reached from here.`);
  let res: { status: number; text(): Promise<string> };
  try {
    res = await ctx.http(url, {
      method: init.method ?? "GET", headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(app === "Notion" ? { "notion-version": "2022-06-28" } : {}) },
      ...(init.body ? { body: init.body } : {}),
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && "error" in e) throw e;   // the egress guard
    raise(ctx, "provider.unavailable", `${app} did not answer.`);
  }
  if (res.status === 401 || res.status === 403) raise(ctx, "provider.auth_failed", `${app} did not accept the key.`);
  if (res.status === 404) raise(ctx, "validation.bad_input", `${app} has nothing at that address, or the key cannot see it.`);
  if (res.status === 429 || res.status >= 500) raise(ctx, "provider.unavailable", `${app} is busy. Try again in a minute.`);
  if (res.status >= 400) raise(ctx, "validation.bad_input", `${app} refused the request.`);
  try { return JSON.parse(await res.text()) as Json; } catch { raise(ctx, "provider.unavailable", `${app} answered something unreadable.`); }
}

/** A value as the text a person would read. */
export function plain(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Array.isArray(v)) return v.map(plain).filter((x) => x !== "").join(", ");
  const o = v as Json;
  for (const k of ["name", "email", "url", "plain_text", "start"]) if (typeof o[k] === "string") return o[k] as string;
  if (Array.isArray(o["title"])) return plain(o["title"]);
  return JSON.stringify(v);
}

// ---- Airtable ----

export async function airtable(ctx: ImportCtx, baseUrl: string, handle: string, only: readonly string[] | undefined): Promise<Table[]> {
  const base = /\b(app[A-Za-z0-9]{8,})\b/.exec(baseUrl)?.[1];
  if (!base) raise(ctx, "validation.bad_input", "That is not an Airtable base address. It looks like https://airtable.com/appXXXXXXXXXXXXXX.");
  const fromUrl = /\b(tbl[A-Za-z0-9]{8,})\b/.exec(baseUrl)?.[1];
  const meta = await get(ctx, handle, `https://api.airtable.com/v0/meta/bases/${base}/tables`, {}, "Airtable");
  let tables = (Array.isArray(meta["tables"]) ? meta["tables"] : []) as Array<{ id: string; name: string; fields?: Array<{ name: string }> }>;
  if (only && only.length > 0) tables = tables.filter((t) => only.includes(t.name) || only.includes(t.id));
  else if (fromUrl) tables = tables.filter((t) => t.id === fromUrl);
  if (tables.length === 0) raise(ctx, "validation.bad_input", "That base has no table by that name.");
  const out: Table[] = [];
  for (const t of tables) {
    const names = (t.fields ?? []).map((f) => f.name);
    const grid: string[][] = [names];
    let offset: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const res = await get(ctx, handle, `https://api.airtable.com/v0/${base}/${t.id}?pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`, {}, "Airtable");
      for (const r of (Array.isArray(res["records"]) ? res["records"] : []) as Array<{ fields?: Json }>) grid.push(names.map((n) => plain(r.fields?.[n])));
      offset = typeof res["offset"] === "string" ? res["offset"] : undefined;
      if (!offset) break;
    }
    out.push(tableFrom(t.name, grid));
  }
  return out;
}

// ---- Notion ----

const richText = (v: unknown): string => (Array.isArray(v) ? v.map((x) => String((x as Json)["plain_text"] ?? "")).join("") : plain(v));
const notionValue = (p: Json): string => {
  const type = String(p["type"] ?? "");
  const v = p[type];
  switch (type) {
    case "title": case "rich_text": return richText(v);
    case "number": return v === null || v === undefined ? "" : String(v);
    case "select": case "status": return plain(v);
    case "multi_select": case "people": return plain(v);
    case "date": return v && typeof v === "object" ? String((v as Json)["start"] ?? "") : "";
    case "checkbox": return v ? "TRUE" : "FALSE";
    case "url": case "email": case "phone_number": return plain(v);
    case "formula": { const f = v as Json | null; return f ? plain(f[String(f["type"])]) : ""; }
    case "relation": return Array.isArray(v) ? String(v.length) : "";
    default: return plain(v);
  }
};

export async function notion(ctx: ImportCtx, url: string, handle: string): Promise<Table[]> {
  const idHex = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(url.replace(/-/g, ""))?.[1];
  if (!idHex) raise(ctx, "validation.bad_input", "That is not a Notion database address.");
  const id = `${idHex.slice(0, 8)}-${idHex.slice(8, 12)}-${idHex.slice(12, 16)}-${idHex.slice(16, 20)}-${idHex.slice(20)}`;
  const db = await get(ctx, handle, `https://api.notion.com/v1/databases/${id}`, {}, "Notion");
  const title = richText(db["title"]) || "Notion database";
  const props = (db["properties"] && typeof db["properties"] === "object" ? Object.entries(db["properties"] as Record<string, Json>) : []);
  // the title property first, the rest by name
  const names = props.sort(([an, a], [bn, b]) => (a["type"] === "title" ? -1 : 0) - (b["type"] === "title" ? -1 : 0) || an.localeCompare(bn)).map(([n]) => n);
  const grid: string[][] = [names];
  let cursor: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const res = await get(ctx, handle, `https://api.notion.com/v1/databases/${id}/query`, { method: "POST", body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) }, "Notion");
    for (const r of (Array.isArray(res["results"]) ? res["results"] : []) as Array<{ properties?: Record<string, Json> }>) grid.push(names.map((n) => (r.properties?.[n] ? notionValue(r.properties[n] as Json) : "")));
    cursor = res["has_more"] === true && typeof res["next_cursor"] === "string" ? res["next_cursor"] : undefined;
    if (!cursor) break;
  }
  return [tableFrom(title, grid)];
}

// ---- Google Sheets ----

export async function sheets(ctx: ImportCtx, url: string, only: readonly string[] | undefined): Promise<Table[]> {
  const spreadsheetId = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!spreadsheetId) raise(ctx, "validation.bad_input", "That is not a Google Sheets address. It looks like https://docs.google.com/spreadsheets/d/<id>/edit.");
  let meta: { sheets?: Array<{ title: string }> };
  try { meta = await call<{ sheets?: Array<{ title: string }> }>(ctx, "google.sheets.get_spreadsheet", { spreadsheetId }); } catch (e) {
    const code = codeOf(e);
    if (code === "provider.auth_failed" || code === "provider.unavailable") throw e;
    if (code === "validation.not_found" || code === "permission.no_grant") raise(ctx, "provider.auth_failed", "The connected Google account cannot open that sheet.");
    throw e;
  }
  let tabs = (meta.sheets ?? []).map((s) => s.title);
  if (only && only.length > 0) tabs = tabs.filter((t) => only.includes(t));
  if (tabs.length === 0) raise(ctx, "validation.bad_input", "That sheet has no tab by that name.");
  const out: Table[] = [];
  for (const title of tabs) {
    const got = await call<{ values?: string[][] }>(ctx, "google.sheets.get_values", { spreadsheetId, range: `'${title.replace(/'/g, "''")}'` });
    out.push(tableFrom(title, (got.values ?? []).map((r) => r.map((c) => String(c ?? "")))));
  }
  return out;
}
