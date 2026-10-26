// schema read side (spec 2.9): describe, types.list/get, map, field_types, view_kinds, changes.list, trash.list, views.list/get, layout.get, gap_rules.list, sensitivity.scan.
// Every answer comes from sc_types (definitions) and the registry (field types, view kinds), never from a copy kept in the handler.
import { allDefs, ensureTables, nowOf, refuse, rowCount, seedManifestTypes } from "../projections.ts";
import type { FieldDefT, Label, SchemaCtx, SchemaDeps, TypeDefT } from "../projections.ts";

export interface TypeDetail extends Omit<TypeDefT, "scope"> { system: boolean; scope?: string }
export interface ViewRow {
  viewId: string; type: string; kind: string; title: string; shared: boolean; ownerId: string;
  filter?: unknown; sort?: unknown; group?: string; hidden?: string[]; colorRules?: unknown; config?: Record<string, unknown>; updatedAt: number;
}
export interface LayoutSection { key: string; title: string; fields: string[]; folded?: boolean }
export interface GapRule { ruleId: string; field: string; when: "missing" | "stale"; staleAfterDays?: number; route: "ai_field" | "agent_lookup" | "task" | "form"; agentId?: string; enabled: boolean }

export interface DescribeHandlers {
  "schema.describe"(ctx: SchemaCtx, input: { type?: string }): Promise<{ types: TypeDetail[] }>;
  "schema.types.list"(ctx: SchemaCtx, input: { section?: "personal" | "shared" | "space"; folder?: string; group?: string; cursor?: string; limit?: number }): Promise<{ types: Record<string, unknown>[]; next?: string; total?: number }>;
  "schema.types.get"(ctx: SchemaCtx, input: { type: string }): Promise<{ type: TypeDetail }>;
  "schema.map"(ctx: SchemaCtx, input: { type?: string; hops?: number }): Promise<{ nodes: { type: string; title: string; rowCount: number }[]; edges: { from: string; to: string; field: string; inverse?: string }[] }>;
  "schema.field_types"(ctx: SchemaCtx, input: Record<string, never>): Promise<{ fieldTypes: { key: string; title: string; filterOps: string[]; sortable: boolean; groupable: boolean; sealed: boolean }[] }>;
  "schema.view_kinds"(ctx: SchemaCtx, input: Record<string, never>): Promise<{ viewKinds: { key: string; title: string; needs: { fieldType: string; as: string }[] }[] }>;
  "schema.changes.list"(ctx: SchemaCtx, input: { type?: string; since?: number; cursor?: string; limit?: number }): Promise<{ changes: { changeId: string; at: number; by: string; summary: string; destructive: boolean; types: string[] }[]; next?: string; total?: number }>;
  "schema.trash.list"(ctx: SchemaCtx, input: Record<string, never>): Promise<{ items: { type: string; field?: string; droppedAt: number; expiresAt: number; rows: number }[] }>;
  "views.list"(ctx: SchemaCtx, input: { type: string; kind?: string }): Promise<{ views: ViewRow[] }>;
  "views.get"(ctx: SchemaCtx, input: { viewId: string }): Promise<{ view: ViewRow }>;
  "schema.layout.get"(ctx: SchemaCtx, input: { type: string }): Promise<{ sections: LayoutSection[] }>;
  "schema.gap_rules.list"(ctx: SchemaCtx, input: { type: string }): Promise<{ rules: GapRule[] }>;
  "schema.sensitivity.scan"(ctx: SchemaCtx, input: { type: string }): Promise<{ suggestions: { field: string; kind: "id_number" | "card" | "bank" | "health" | "other"; matches: number; suggestedLabel: Label; seal: boolean }[] }>;
}

export const detailOf = (d: TypeDefT): TypeDetail => {
  const { scope, system, ...rest } = d;
  return { ...rest, system: system === true, scope: scope ?? "space" };
};

interface PageOut { start: number; limit: number }
export function pageOf(input: { cursor?: string; limit?: number }): PageOut {
  const start = input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  return { start, limit: Math.min(Math.max(input.limit ?? 200, 1), 500) };
}

interface ViewDbRow { view_id: string; type: string; kind: string; title: string; shared: number; owner_id: string; spec: string; updated_at: number }
export function viewRowOf(r: ViewDbRow): ViewRow {
  const spec = JSON.parse(r.spec) as Partial<ViewRow>;
  return {
    viewId: r.view_id, type: r.type, kind: r.kind, title: r.title, shared: r.shared === 1, ownerId: r.owner_id, updatedAt: r.updated_at,
    ...(spec.filter !== undefined ? { filter: spec.filter } : {}), ...(spec.sort !== undefined ? { sort: spec.sort } : {}),
    ...(spec.group !== undefined ? { group: spec.group } : {}), ...(spec.hidden !== undefined ? { hidden: spec.hidden } : {}),
    ...(spec.colorRules !== undefined ? { colorRules: spec.colorRules } : {}), ...(spec.config !== undefined ? { config: spec.config } : {}),
  };
}

// ---- sensitivity ----

const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD = /\b(?:\d[ -]?){13,19}\b/;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
const ROUTING = /\b(?:account|acct|routing)\D{0,12}\d{6,17}\b/i;
const HEALTH = /\b(diagnos\w*|prescri\w*|medicat\w*|patient|symptom\w*|icd-?\d*|hiv|cancer|diabet\w*|therapy|surgery)\b/i;
const NAME_HINTS: { kind: "id_number" | "card" | "bank" | "health"; re: RegExp }[] = [
  { kind: "id_number", re: /(ssn|social|tax_?id|ein|passport|national_?id|license_?no|drivers?_?license)/i },
  { kind: "card", re: /(card|cvv|pan)\b|credit_?card/i },
  { kind: "bank", re: /(iban|routing|account_?num|bank|swift)/i },
  { kind: "health", re: /(diagnos|medication|prescription|health|condition|symptom)/i },
];

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function classify(text: string): "id_number" | "card" | "bank" | "health" | null {
  if (SSN.test(text)) return "id_number";
  const c = CARD.exec(text);
  if (c) { const d = c[0].replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) return "card"; }
  if (IBAN.test(text) || ROUTING.test(text)) return "bank";
  if (HEALTH.test(text)) return "health";
  return null;
}

const textual = (f: FieldDefT): boolean => ["text", "longtext", "ai", "email", "phone"].includes(f.type);

// ---- handlers ----

export function createDescribeHandlers(deps: SchemaDeps): DescribeHandlers {
  const { tx } = deps;
  // after start() the types are already persisted and a read must not write; a handle never started (tests, standalone) seeds on first read
  const ready = async (): Promise<Map<string, TypeDefT>> => { await (deps.started ?? seedManifestTypes(deps)); return allDefs(deps); };
  const need = (ctx: SchemaCtx, defs: Map<string, TypeDefT>, type: string): TypeDefT => {
    const d = defs.get(type);
    if (!d) refuse(ctx, "validation.not_found", `There is no record type ${type}.`);
    return d!;
  };

  return {
    "schema.describe": async (ctx, input) => {
      const defs = await ready();
      if (input.type !== undefined) return { types: [detailOf(need(ctx, defs, input.type))] };
      return { types: [...defs.values()].map(detailOf) };
    },

    "schema.types.list": async (_ctx, input) => {
      const defs = await ready();
      const section = input.section ?? "space";
      // Every type is a Space type today: personal and shared sections are empty until a type can be made personal. Types are not filed in folders either.
      let rows = section === "space" && input.folder === undefined ? [...defs.values()] : [];
      if (input.group !== undefined) rows = rows.filter((d) => d.group === input.group);
      const { start, limit } = pageOf(input);
      const slice = rows.slice(start, start + limit);
      const types = slice.map((d) => ({
        key: d.key, title: d.title, plural: d.plural, icon: d.icon, ...(d.group !== undefined ? { group: d.group } : {}), label: d.label, system: d.system === true,
        ...(d.syncedFrom !== undefined ? { syncedFrom: d.syncedFrom } : {}), ...(d.scope !== undefined ? { scope: d.scope } : {}),
        rowCount: rowCount(tx, d.key), fieldCount: d.fields.length,
      }));
      return { types, ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "schema.types.get": async (ctx, input) => ({ type: detailOf(need(ctx, await ready(), input.type)) }),

    "schema.map": async (ctx, input) => {
      const defs = await ready();
      if (input.type !== undefined) need(ctx, defs, input.type);
      const edges: { from: string; to: string; field: string; inverse?: string }[] = [];
      const seen = new Set<string>();
      for (const d of defs.values()) {
        for (const f of d.fields) {
          if (f.type !== "relation") continue;
          const to = f.options?.["target"];
          if (typeof to !== "string" || !defs.has(to)) continue;
          const inv = typeof f.options?.["inverse"] === "string" ? (f.options["inverse"] as string) : undefined;
          const pair = [`${d.key}.${f.key}`, inv ? `${to}.${inv}` : `${to}.`].sort().join("|");
          if (seen.has(pair)) continue;
          seen.add(pair);
          edges.push({ from: d.key, to, field: f.key, ...(inv ? { inverse: inv } : {}) });
        }
      }
      let keep = new Set(defs.keys());
      if (input.type !== undefined) {
        keep = new Set([input.type]);
        for (let h = 0; h < (input.hops ?? 2); h++) {
          for (const e of edges) { if (keep.has(e.from)) keep.add(e.to); if (keep.has(e.to)) keep.add(e.from); }
        }
      }
      return {
        nodes: [...defs.values()].filter((d) => keep.has(d.key)).map((d) => ({ type: d.key, title: d.title, rowCount: rowCount(tx, d.key) })),
        edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      };
    },

    "schema.field_types": async () => ({
      fieldTypes: deps.registry.fieldTypes.map((f) => ({ key: f.key, title: f.title, filterOps: [...f.filterOps], sortable: f.sortable, groupable: f.groupable, sealed: f.sealed === true })),
    }),

    "schema.view_kinds": async () => ({
      viewKinds: deps.registry.viewKinds.map((v) => ({ key: v.key, title: v.title, needs: (v.needs ?? []).map((n) => ({ fieldType: n.fieldType, as: n.as })) })),
    }),

    "schema.changes.list": async (_ctx, input) => {
      ensureTables(tx);
      const where: string[] = [];
      const args: unknown[] = [];
      if (input.since !== undefined) { where.push("at >= ?"); args.push(input.since); }
      const rows = tx.all<{ change_id: string; at: number; by: string; summary: string; destructive: number; types: string }>(
        `SELECT change_id, at, by, summary, destructive, types FROM sc_changes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC, rowid DESC`, ...args,
      ).map((r) => ({ changeId: r.change_id, at: r.at, by: r.by, summary: r.summary, destructive: r.destructive === 1, types: JSON.parse(r.types) as string[] }))
        .filter((c) => input.type === undefined || c.types.includes(input.type));
      const { start, limit } = pageOf(input);
      return { changes: rows.slice(start, start + limit), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "schema.trash.list": async () => {
      ensureTables(tx);
      const rows = tx.all<{ type: string; field: string | null; dropped_at: number; expires_at: number; rows: number }>(
        "SELECT type, field, dropped_at, expires_at, rows FROM sc_trash WHERE restored_at IS NULL AND expires_at > ? ORDER BY dropped_at DESC, id DESC", nowOf(deps),
      );
      return { items: rows.map((r) => ({ type: r.type, ...(r.field !== null ? { field: r.field } : {}), droppedAt: r.dropped_at, expiresAt: r.expires_at, rows: r.rows })) };
    },

    "views.list": async (ctx, input) => {
      ensureTables(tx);
      const rows = tx.all<ViewDbRow>(
        `SELECT * FROM sc_views WHERE type = ? AND (shared = 1 OR owner_id = ?) ${input.kind !== undefined ? "AND kind = ?" : ""} ORDER BY updated_at DESC, view_id`,
        input.type, ctx.actor ?? "", ...(input.kind !== undefined ? [input.kind] : []),
      );
      return { views: rows.map(viewRowOf) };
    },

    "views.get": async (ctx, input) => {
      ensureTables(tx);
      const r = tx.get<ViewDbRow>("SELECT * FROM sc_views WHERE view_id = ?", input.viewId);
      if (!r || (r.shared !== 1 && r.owner_id !== (ctx.actor ?? ""))) refuse(ctx, "validation.not_found", "There is no such view.");
      return { view: viewRowOf(r!) };
    },

    "schema.layout.get": async (ctx, input) => {
      const d = need(ctx, await ready(), input.type);
      const row = tx.get<{ sections: string }>("SELECT sections FROM sc_layout WHERE type = ?", input.type);
      if (row) return { sections: JSON.parse(row.sections) as LayoutSection[] };
      // No admin layout yet: one section holding every field in declared order.
      return { sections: [{ key: "details", title: "Details", fields: d.fields.map((f) => f.key) }] };
    },

    "schema.gap_rules.list": async (ctx, input) => {
      need(ctx, await ready(), input.type);
      const rows = tx.all<{ rule: string }>("SELECT rule FROM sc_gap_rules WHERE type = ? ORDER BY rule_id", input.type);
      return { rules: rows.map((r) => JSON.parse(r.rule) as GapRule) };
    },

    "schema.sensitivity.scan": async (ctx, input) => {
      const d = need(ctx, await ready(), input.type);
      const fields = d.fields.filter((f) => textual(f));
      const hits = new Map<string, { kind: "id_number" | "card" | "bank" | "health"; matches: number }>();
      let cursor: string | undefined;
      let seen = 0;
      do {
        const page = await deps.store.query(d.key, { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
        for (const r of page.rows) {
          seen++;
          for (const f of fields) {
            const v = r.data[f.key];
            if (typeof v !== "string") continue;
            const kind = classify(v);
            if (!kind) continue;
            const h = hits.get(f.key);
            if (h && h.kind === kind) h.matches++;
            else if (!h) hits.set(f.key, { kind, matches: 1 });
          }
        }
        cursor = page.next_cursor;
      } while (cursor && seen < 5000);
      const out: { field: string; kind: "id_number" | "card" | "bank" | "health" | "other"; matches: number; suggestedLabel: Label; seal: boolean }[] = [];
      for (const f of d.fields) {
        if (f.type === "sealed") continue;
        const h = hits.get(f.key);
        const byName = NAME_HINTS.find((n) => n.re.test(f.key) || n.re.test(f.title));
        const kind = h?.kind ?? byName?.kind;
        if (!kind) continue;
        if (!h && !textual(f)) continue;
        out.push({ field: f.key, kind, matches: h?.matches ?? 0, suggestedLabel: kind === "health" ? "confidential" : "restricted", seal: kind !== "health" });
      }
      return { suggestions: out };
    },
  };
}
