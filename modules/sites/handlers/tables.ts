// site tables (spec 2.20 Site tables; ARCH 7.6): site-scoped record types made by the site's agent or anyone who can edit the site.
// Creating one needs edit on the site and no schema permission. Promoting one to a Space record type needs schema.manage; the type key stays, so its rows stay.
// This module keeps the definition and a versioned migration row per change (sites_table, sites_table_version); the schema and records modules read the
// site.table_created and site.table_promoted events to project the type. A site table shares the site's access, so sites.tables lists only for people who can see the site.
// @reads ../migrations/0002_promote_tables.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import { fail, hexOf, many, mustSite, num, one, rec, reqStr, str } from "./deploy.ts";

type Row = Record<string, unknown>;

const KEY = /^[a-z][a-z0-9_]*$/;
const KEY_MAX = 40;
const FIELD_MAX = 100;
const TITLE_MAX = 80;

interface FieldDef {
  key: string;
  type: string;
  title: string;
}

/** `site_<hex of the site id>_<key>`: unique per site (the whole id, not a prefix: ids minted in the same millisecond share their first digits) and a valid record type key. */
export function tableType(siteId: string, key: string): string {
  return `site_${hexOf(siteId)}_${key}`;
}

function parseFields(text: unknown): FieldDef[] {
  if (typeof text !== "string") return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? (v as FieldDef[]) : [];
  } catch {
    return [];
  }
}

function cleanFields(ctx: Ctx, raw: unknown): FieldDef[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(ctx, "validation.bad_input", "A table needs at least one field.", { field: "fields" });
  if (raw.length > FIELD_MAX) fail(ctx, "validation.too_large", "A table takes at most 100 fields.", { field: "fields" });
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const item of raw) {
    const f = rec(ctx, item);
    const key = reqStr(ctx, f, "key");
    const type = reqStr(ctx, f, "type");
    const title = reqStr(ctx, f, "title").trim();
    if (!KEY.test(key) || key.length > KEY_MAX) fail(ctx, "validation.bad_input", "A field key uses lowercase letters, digits and underscores, and starts with a letter.", { field: "fields.key", key });
    if (!/^[a-z][a-z0-9_.]{0,39}$/.test(type)) fail(ctx, "validation.bad_input", "That field type is not valid.", { field: "fields.type", key });
    if (title.length === 0 || title.length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(title)) fail(ctx, "validation.bad_input", "A field title is 1 to 80 characters.", { field: "fields.title", key });
    if (seen.has(key)) fail(ctx, "validation.duplicate", "A field key is listed twice.", { key });
    seen.add(key);
    out.push({ key, type, title });
  }
  return out;
}

function needEdit(ctx: Ctx, siteId: string): void {
  const d = ctx.authorize({ perm: null, level: "edit" }, { type: "site", id: siteId });
  if (d.effect !== "allow") fail(ctx, "permission.no_grant", "Editing the site is needed to change its tables.");
}

async function tableCreate(ctx: Ctx, input: unknown): Promise<{ type: string }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  needEdit(ctx, siteId);
  const key = reqStr(ctx, o, "key");
  if (!KEY.test(key) || key.length > KEY_MAX) fail(ctx, "validation.bad_input", "A table key uses lowercase letters, digits and underscores, and starts with a letter.", { field: "key" });
  const fields = cleanFields(ctx, o.fields);
  const type = tableType(siteId, key);
  if (one(ctx, "SELECT * FROM sites_table WHERE type = ?", type)) fail(ctx, "validation.duplicate", "This site already has a table with that key.", { key });
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO sites_table (type, site_id, key, fields, scope, version, created_by, created_at, promoted_by, promoted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    type, siteId, key, JSON.stringify(fields), "site", 1, ctx.principal.id, now, null, null,
  );
  ctx.db.run(
    "INSERT INTO sites_table_version (type, version, change, detail, by, at) VALUES (?, ?, ?, ?, ?, ?)",
    type, 1, "create", JSON.stringify({ fields }), ctx.principal.id, now,
  );
  touchActivity(ctx.db, siteId, "site.table_created", now);
  ctx.emit("site.table_created", `site/${siteId}`, { siteId, type });
  return { type };
}

/** Row count from Records; a site table with no rows yet, or a Records module that cannot answer, counts 0. */
async function rowCount(ctx: Ctx, type: string): Promise<number> {
  try {
    const out = (await ctx.call("records.counts", { type })) as { count?: unknown };
    return num(out.count);
  } catch (e) {
    ctx.log.warn("sites: row count unavailable", { type, error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

async function tables(ctx: Ctx, input: unknown): Promise<{ tables: { type: string; rows: number }[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const rows: Row[] = many(ctx, "SELECT * FROM sites_table WHERE site_id = ?", site.id).sort((a, b) => str(a.type).localeCompare(str(b.type)));
  const out: { type: string; rows: number }[] = [];
  for (const r of rows) out.push({ type: str(r.type), rows: await rowCount(ctx, str(r.type)) });
  return { tables: out };
}

async function tablePromote(ctx: Ctx, input: unknown): Promise<{ type: string }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const siteId = str(site.id);
  const type = reqStr(ctx, o, "type");
  // the host checks schema.manage from the manifest; the handler asks again because promoting changes who can see the rows
  const d = ctx.authorize({ perm: "schema.manage", level: "manage" }, { type: "record_type", id: type });
  if (d.effect !== "allow") fail(ctx, "permission.role_lacks_permission", "Promoting a table to the Space needs permission to manage the schema.");
  const row = one(ctx, "SELECT * FROM sites_table WHERE type = ? AND site_id = ?", type, siteId);
  if (!row) fail(ctx, "validation.not_found", "That site table does not exist.");
  if (row.scope === "space") return { type };
  const now = ctx.now();
  const version = num(row.version) + 1;
  ctx.db.run("UPDATE sites_table SET scope = ?, version = ?, promoted_by = ?, promoted_at = ? WHERE type = ?", "space", version, ctx.principal.id, now, type);
  ctx.db.run(
    "INSERT INTO sites_table_version (type, version, change, detail, by, at) VALUES (?, ?, ?, ?, ?, ?)",
    type, version, "promote", JSON.stringify({ fields: parseFields(row.fields), from: "site", to: "space" }), ctx.principal.id, now,
  );
  touchActivity(ctx.db, siteId, "site.table_promoted", now);
  ctx.emit("site.table_promoted", `site/${siteId}`, { siteId, type });
  return { type };
}

export const tableHandlers = {
  "sites.table_create": (ctx: Ctx, input: unknown) => tableCreate(ctx, input),
  "sites.tables": (ctx: Ctx, input: unknown) => tables(ctx, input),
  "sites.table_promote": (ctx: Ctx, input: unknown) => tablePromote(ctx, input),
};
