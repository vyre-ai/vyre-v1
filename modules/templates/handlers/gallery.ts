// templates (spec 2.21, 3.6; ARCH 7.6): a Template is one item saved in the Kit format, listed in a gallery, previewed before it installs and installed from Apps > Templates.
// There is one installable package format. A shipped template is a Kit with exactly one item; this module tells it apart from a bigger Kit by what kits.preview says it adds, and
// templates.install hands the install to kits.install, so the install sheet, the Gate, permissions, audit and rollback are the Kit ones, not a second path.
// A template a person saved (templates.save) is the same Kit-format item kept here, because a module cannot create a Kit in another module; its install runs the item's one apply step
// as the installing person, which is what kits.install does for a Kit item.
// Preview only reads: kits.install_sheet and kits.preview change nothing, and nothing here writes while previewing. The gallery cache rows are written by list, not by preview.
// @reads ../migrations/0001_templates.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { fail as hostFail } from "../../../host/src/routes/errors.ts";

export const KINDS = ["agent", "automation", "journey", "record_type", "runbook", "project", "site", "form", "portal"] as const;
export type TemplateKind = (typeof KINDS)[number];

export interface TemplateRow {
  templateId: string;
  title: string;
  kind: TemplateKind;
  summary: string;
  version: string;
  adds: string[];
}

/** The empty starter that comes first in New project and New Journey type. It is not stored; installing it is "start from nothing". */
export const EMPTY_STARTERS: Record<"project" | "journey", TemplateRow> = {
  project: { templateId: "tpl_emptyproject", title: "Empty project", kind: "project", summary: "Start from nothing.", version: "1.0.0", adds: [] },
  journey: { templateId: "tpl_emptyjourney", title: "Empty Journey", kind: "journey", summary: "Start from nothing.", version: "1.0.0", adds: [] },
};

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

// ---- helpers ------------------------------------------------------------------------------------------------

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  throw hostFail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
const isKind = (v: unknown): v is TemplateKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

function rec(ctx: Ctx, input: unknown): Obj {
  if (input === undefined || input === null) return {};
  if (!isObj(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input;
}

function reqStr(ctx: Ctx, o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optStr(ctx: Ctx, o: Obj, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function pageOf(ctx: Ctx, o: Obj): { offset: number; limit: number } {
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) fail(ctx, "validation.bad_input", "That page cursor is not valid.", { field: "cursor" });
  const lim = o.limit;
  if (lim !== undefined && lim !== null && (typeof lim !== "number" || !Number.isInteger(lim) || lim < 1 || lim > 500)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  return { offset, limit: typeof lim === "number" ? lim : 100 };
}

function rowOf(r: Row): TemplateRow {
  return { templateId: str(r.id), title: str(r.title), kind: str(r.kind) as TemplateKind, summary: str(r.summary), version: str(r.version), adds: JSON.parse(str(r.adds)) as string[] };
}

function mustTemplate(ctx: Ctx, templateId: string): Row {
  const r = one(ctx, "SELECT * FROM templates_template WHERE id = ?", templateId);
  if (!r) fail(ctx, "validation.not_found", "That template does not exist.");
  return r;
}

// ---- the Kit format of a saved template ---------------------------------------------------------------------

interface Step { cap: string; input: Obj }
interface Item { key: string; content: string; type: string; title: string; apply?: Step; undo?: Step; recordType?: string; tools?: string[]; networkDomains?: string[]; vaultNames?: string[] }
interface Manifest { key: string; title: string; version: string; channel: "stable"; description: string; items: Item[] }

function manifestOf(r: Row): Manifest {
  return JSON.parse(str(r.manifest)) as Manifest;
}

/** What the template will touch, from its own manifest (the same four lists as a Kit's install sheet). Sorted, so it is the same every time. */
function sheetOf(m: Manifest): { recordTypes: string[]; networkDomains: string[]; vaultNames: string[] } {
  const types = new Set<string>(), domains = new Set<string>(), vault = new Set<string>();
  for (const it of m.items) {
    if (it.type === "record_type") types.add(it.recordType ?? it.key);
    for (const d of it.networkDomains ?? []) domains.add(d);
    for (const v of it.vaultNames ?? []) vault.add(v);
  }
  return { recordTypes: [...types].sort(), networkDomains: [...domains].sort(), vaultNames: [...vault].sort() };
}

// ---- the gallery: shipped one-item Kits ---------------------------------------------------------------------

interface KitListRow { kitId: string; key: string; title: string; version: string; installed: boolean }

async function allKits(ctx: Ctx): Promise<KitListRow[]> {
  const out: KitListRow[] = [];
  let cursor: string | undefined;
  do {
    const page = (await ctx.call("kits.list", cursor === undefined ? { limit: 100 } : { limit: 100, cursor })) as { kits?: KitListRow[]; next?: string };
    out.push(...(page.kits ?? []));
    cursor = page.next;
  } while (cursor !== undefined);
  return out;
}

/** "Add Matter" -> "Matter" */
const addedName = (title: string): string => title.replace(/^(Add|Change|Remove) /, "");

/**
 * Brings the shipped template rows in line with the Kits the kits module lists. A Kit that adds exactly one item of a template kind is a template; a bigger Kit is a Kit.
 * A Kit whose version has not changed is not asked about again. An installed Kit has nothing left to add, so its cached row is kept and only its version follows.
 */
async function syncGallery(ctx: Ctx): Promise<void> {
  const kits = await allKits(ctx);
  const seen = new Set<string>();
  for (const k of kits) {
    seen.add(k.key);
    const have = one(ctx, "SELECT * FROM templates_template WHERE source = ? AND key = ?", "kit", k.key);
    if (have && str(have.version) === k.version && str(have.kit_id) === k.kitId) continue;
    if (have && k.installed) {
      ctx.db.run("UPDATE templates_template SET version = ?, kit_id = ?, updated_at = ? WHERE id = ?", k.version, k.kitId, ctx.now(), str(have.id));
      continue;
    }
    let changes: { kind: string; title: string }[];
    try {
      changes = ((await ctx.call("kits.preview", { kitId: k.kitId })) as { changes?: { kind: string; title: string }[] }).changes ?? [];
    } catch (e) {
      ctx.log.warn("templates: could not preview a Kit", { key: k.key, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const only = changes.length === 1 ? changes[0] : undefined;
    if (!only || !isKind(only.kind)) {
      if (have) ctx.db.run("DELETE FROM templates_template WHERE id = ?", str(have.id));
      continue;
    }
    const adds = JSON.stringify([addedName(only.title)]);
    const now = ctx.now();
    if (have) ctx.db.run("UPDATE templates_template SET kind = ?, title = ?, summary = ?, version = ?, adds = ?, kit_id = ?, updated_at = ? WHERE id = ?", only.kind, k.title, `Adds ${addedName(only.title)}.`, k.version, adds, k.kitId, now, str(have.id));
    else ctx.db.run("INSERT INTO templates_template (id, key, source, kind, title, summary, version, adds, kit_id, manifest, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", nid(ctx, "tpl"), k.key, "kit", only.kind, k.title, `Adds ${addedName(only.title)}.`, k.version, adds, k.kitId, null, null, now, now);
  }
  // a Kit the kits module no longer lists is no longer in the gallery
  for (const r of many(ctx, "SELECT * FROM templates_template WHERE source = ?", "kit")) {
    if (!seen.has(str(r.key))) ctx.db.run("DELETE FROM templates_template WHERE id = ?", str(r.id));
  }
}

// ---- reads --------------------------------------------------------------------------------------------------

async function list(ctx: Ctx, input: unknown): Promise<{ templates: TemplateRow[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const { offset, limit } = pageOf(ctx, o);
  const kind = optStr(ctx, o, "kind");
  if (kind !== undefined && !isKind(kind)) fail(ctx, "validation.bad_input", "That kind of template does not exist.", { field: "kind" });
  await syncGallery(ctx);
  const rows = many(ctx, "SELECT * FROM templates_template").filter((r) => kind === undefined || str(r.kind) === kind).sort((a, b) => str(a.title).localeCompare(str(b.title)) || str(a.key).localeCompare(str(b.key)));
  const out: { templates: TemplateRow[]; next?: string; total: number } = { templates: rows.slice(offset, offset + limit).map(rowOf), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function preview(ctx: Ctx, input: unknown): Promise<{ template: TemplateRow; record_types: string[]; domains: string[]; vaultNames: string[] }> {
  const templateId = reqStr(ctx, rec(ctx, input), "templateId");
  const empty = Object.values(EMPTY_STARTERS).find((s) => s.templateId === templateId);
  if (empty) return { template: empty, record_types: [], domains: [], vaultNames: [] };
  const r = mustTemplate(ctx, templateId);
  const template = rowOf(r);
  if (str(r.source) === "saved") {
    const sheet = sheetOf(manifestOf(r));
    return { template, record_types: sheet.recordTypes, domains: sheet.networkDomains, vaultNames: sheet.vaultNames };
  }
  const kitId = str(r.kit_id);
  const sheet = ((await ctx.call("kits.install_sheet", { kitId })) as { sheet?: { recordTypes?: string[]; networkDomains?: string[]; vaultNames?: string[] } }).sheet ?? {};
  // what it adds now: an installed Kit adds nothing more, so its cached list stays
  const changes = ((await ctx.call("kits.preview", { kitId })) as { changes?: { title: string }[] }).changes ?? [];
  if (changes.length > 0) template.adds = changes.map((c) => addedName(c.title));
  return { template, record_types: sheet.recordTypes ?? [], domains: sheet.networkDomains ?? [], vaultNames: sheet.vaultNames ?? [] };
}

async function projectStarters(ctx: Ctx, input: unknown): Promise<{ starters: TemplateRow[] }> {
  const kind = reqStr(ctx, rec(ctx, input), "kind");
  if (kind !== "project" && kind !== "journey") fail(ctx, "validation.bad_input", "Choose project or journey.", { field: "kind" });
  await syncGallery(ctx);
  const rows = many(ctx, "SELECT * FROM templates_template WHERE kind = ?", kind).sort((a, b) => str(a.title).localeCompare(str(b.title)) || str(a.key).localeCompare(str(b.key)));
  return { starters: [EMPTY_STARTERS[kind], ...rows.map(rowOf)] };
}

// ---- install ------------------------------------------------------------------------------------------------

const subject = (templateId: string): string => `entity/${templateId}`;

async function install(ctx: Ctx, input: unknown): Promise<{ installed: { kind: string; id: string }[] }> {
  const o = rec(ctx, input);
  const templateId = reqStr(ctx, o, "templateId");
  const into = optStr(ctx, o, "into");
  const empty = Object.values(EMPTY_STARTERS).find((s) => s.templateId === templateId);
  if (empty) fail(ctx, "validation.precondition_failed", `${empty.title} is not installed; choose it in New ${empty.kind === "project" ? "project" : "Journey type"} to start from nothing.`);
  const r = mustTemplate(ctx, templateId);
  const template = rowOf(r);

  if (str(r.source) === "kit") {
    if (into !== undefined) fail(ctx, "validation.bad_input", "This template installs into the Space, not into a folder.", { field: "into" });
    const kitId = str(r.kit_id);
    // the install sheet was shown by preview; kits.install checks permission, the Gate and audit, and refuses a Kit that is already installed
    await ctx.call("kits.install", { kitId, accepted: true });
    ctx.emit("template.installed", subject(templateId), { templateId, kind: template.kind });
    return { installed: [{ kind: template.kind, id: kitId }] };
  }

  const out: { kind: string; id: string }[] = [];
  for (const it of manifestOf(r).items) {
    if (!it.apply) continue;
    const step = it.apply;
    const stepInput: Obj = { ...step.input };
    if (into !== undefined) {
      if (step.cap !== "automations.create") fail(ctx, "validation.bad_input", "This template installs into the Space, not into a folder.", { field: "into" });
      stepInput.folderId = into;
    }
    let made: unknown;
    try {
      made = await ctx.call(step.cap as never, stepInput);
    } catch (e) {
      const msg = (e as { error?: { message?: unknown } } | null)?.error?.message ?? (e instanceof Error ? e.message : "The step failed.");
      ctx.log.warn("templates: install failed", { templateId, item: it.key });
      fail(ctx, "validation.precondition_failed", `Could not install "${it.title}": ${String(msg).slice(0, 200)} Nothing was left half installed.`, { item: it.key });
    }
    const automation = isObj(made) && isObj(made.automation) ? str(made.automation.id) : "";
    out.push({ kind: it.type, id: automation !== "" ? automation : it.recordType ?? it.key });
  }
  ctx.emit("template.installed", subject(templateId), { templateId, kind: template.kind });
  return { installed: out };
}

// ---- save ---------------------------------------------------------------------------------------------------

const RECORD_TYPE_KEYS = ["title", "plural", "icon", "label", "titleField", "summaryField", "statusField", "ownerField", "group", "retention", "attribution", "fields"] as const;

async function itemFor(ctx: Ctx, kind: TemplateKind, ref: string, title: string, templateId: string): Promise<Item> {
  const stepKey = `tpl.${templateId}`;
  if (kind === "record_type") {
    const got = (await ctx.call("schema.types.get", { type: ref })) as { type?: Obj };
    const t = got.type;
    if (!t) fail(ctx, "validation.not_found", "That record type does not exist.");
    if (t.system === true) fail(ctx, "validation.precondition_failed", "A system record type is part of Vyre and cannot be saved as a template.");
    if (typeof t.syncedFrom === "string" || (typeof t.scope === "string" && t.scope !== "space")) fail(ctx, "validation.precondition_failed", "A synced or site record type cannot be saved as a template.");
    const def: Obj = {};
    for (const k of RECORD_TYPE_KEYS) if (t[k] !== undefined) def[k] = t[k];
    return {
      key: `rt.${ref}`.slice(0, 61), content: "structure", type: "record_type", title, recordType: ref,
      apply: { cap: "schema.apply", input: { ops: [{ op: "type.create", type: ref, def }], idempotencyKey: stepKey, reason: "Template install" } },
    };
  }
  if (kind === "automation") {
    const got = (await ctx.call("automations.get", { automationId: ref })) as { automation?: Obj };
    const a = got.automation;
    if (!a) fail(ctx, "validation.not_found", "That Automation does not exist.");
    return {
      key: `auto.${ref}`.slice(0, 61), content: "steps", type: "automation", title,
      apply: { cap: "automations.create", input: { name: str(a.name), ...(typeof a.description === "string" ? { description: a.description } : {}), definition: a.definition, idempotencyKey: stepKey } },
    };
  }
  return fail(ctx, "validation.precondition_failed", `Saving a ${kind.replace("_", " ")} as a template is not available yet.`, { kind });
}

async function save(ctx: Ctx, input: unknown): Promise<{ template: TemplateRow }> {
  const o = rec(ctx, input);
  const kind = reqStr(ctx, o, "kind");
  if (!isKind(kind)) fail(ctx, "validation.bad_input", "That kind of template does not exist.", { field: "kind" });
  const ref = reqStr(ctx, o, "ref");
  const title = reqStr(ctx, o, "title").trim();
  if (title === "" || title.length > 120) fail(ctx, "validation.bad_input", "Give the template a title of 1 to 120 characters.", { field: "title" });
  const id = nid(ctx, "tpl");
  const item = await itemFor(ctx, kind, ref, title, id);
  const key = `saved-${id.slice(4)}`;
  const manifest: Manifest = { key, title, version: "1.0.0", channel: "stable", description: `Saved from ${kind.replace("_", " ")} ${ref}.`, items: [item] };
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO templates_template (id, key, source, kind, title, summary, version, adds, kit_id, manifest, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, key, "saved", kind, title, `Adds ${title}.`, "1.0.0", JSON.stringify([title]), null, JSON.stringify(manifest), ctx.principal.id, now, now,
  );
  ctx.emit("template.saved", subject(id), { templateId: id, kind });
  return { template: rowOf(mustTemplate(ctx, id)) };
}

export const galleryHandlers = {
  "templates.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "templates.preview": (ctx: Ctx, input: unknown) => preview(ctx, input),
  "templates.install": (ctx: Ctx, input: unknown) => install(ctx, input),
  "templates.save": (ctx: Ctx, input: unknown) => save(ctx, input),
  "templates.project_starters": (ctx: Ctx, input: unknown) => projectStarters(ctx, input),
};

