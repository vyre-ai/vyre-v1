// records.value_source, values.pending, values.review, completeness, gap_check, relate and changes (spec 2.9 "Agent-filled values", "Page", "Form answers vs agent values"; ARCH 7.4).
// Path mapping: the packet lists handlers/review.ts and handlers/views.ts; the wiring (impl.ts, handlers/index.ts) and the contract tests sit beside them.
//
// Value provenance. A value an agent or automation proposes arrives as the catalogue event `record.value_proposed` (source, reviewRequired). `propose` folds it into
// records_value_sources: reviewRequired puts the value in "needs_review" (it sits in the record but does not count), otherwise it is "counted" at once. A value with no row was
// written by whoever the field clock names (rt_<type>__fm) and counts. A rejected value is put back to what the field held before (the last 'previous' history row, or empty),
// so the rejected text stays in history and the record shows the older value.
// Completeness counts the fields a person fills (derived fields, such as formulas, lookups, rollups, counters and AI-maintained stamps, are not asked for).
// Gap check reads the type's rules from the schema module through ctx.call (modules are leaves, boundary B1), so the rules have one owner.
import { parseHlc } from "../../../lib/hlc.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Principal } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, EventName, NextStep, TraceContext, VyreError } from "../../../packages/contracts/src/types.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { FieldDef, Store, StoredRecord, TypeDef } from "../../../kernel/src/store/types.ts";
import { mapError, toRow } from "./write.ts";
import type { RecordRow, WriteCtx, WriteHandlers } from "./write.ts";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface RvCtx {
  trace: TraceContext;
  principal?: Principal;
  emit: (name: EventName, subject: string, payload: Record<string, unknown>) => unknown;
  /** The capability API: gap_check reads the rules from the schema module, records.view reads the saved view from it. */
  call?: (cap: string, input: unknown) => Promise<unknown>;
}

export interface RvDeps {
  tx: Tx;
  store: Store;
  /** relate and reject go through records.update so each is one event with the same rules as any edit. */
  writes: Pick<WriteHandlers, "records.update">;
  /** The Space name, for the references a relation holds (vyre://<space>/<type>/<id>). */
  space: string;
  now?: () => number;
}

export type SourceKind = "agent" | "person" | "form" | "automation" | "sync" | "import";
export interface ValueSource { kind: SourceKind; actor: string; at: number; state: "counted" | "needs_review" | "rejected"; link?: string }
export interface GapRuleIn { ruleId: string; field: string; when: "missing" | "stale"; staleAfterDays?: number; route: "ai_field" | "agent_lookup" | "task" | "form"; enabled?: boolean }
export interface Gap { recordId: string; field: string; reason: "missing" | "stale"; route: GapRuleIn["route"] }

export interface ReviewHandlers {
  "records.changes"(ctx: RvCtx, input: { type: string; since: number; limit?: number }): Promise<{ changes: { seq: number; id: string; op: "upsert" | "patch" | "delete" }[]; next: number }>;
  "records.completeness"(ctx: RvCtx, input: { type: string; recordId: string }): Promise<{ filled: number; total: number; missing: { field: string; title: string }[] }>;
  "records.gap_check"(ctx: RvCtx, input: { type: string; recordId?: string }): Promise<{ gaps: Gap[] }>;
  "records.relate"(ctx: RvCtx, input: { type: string; recordId: string; field: string; toId: string; unlink?: boolean }): Promise<{ record: RecordRow }>;
  "records.value_source"(ctx: RvCtx, input: { type: string; recordId: string; field: string }): Promise<{ source: ValueSource }>;
  "records.values.pending"(ctx: RvCtx, input: { type: string; cursor?: string; limit?: number }): Promise<{ values: { recordId: string; type: string; field: string; value?: unknown; source: ValueSource }[]; next?: string; total?: number }>;
  "records.values.review"(ctx: RvCtx, input: { type: string; recordId: string; field: string; decision: "accept" | "reject"; note?: string }): Promise<{ record: RecordRow }>;
}

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

export function fail(ctx: Pick<RvCtx, "trace">, code: ErrorCode, message: string): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  throw new VyreErr(error);
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const DAY = 86_400_000;
export const PAGE = 200;
const PAGE_MAX = 500;
const SCAN_MAX = 10_000;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS records_value_sources (
    type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, link TEXT,
    state TEXT NOT NULL, note TEXT, reviewer TEXT, reviewed_at INTEGER, PRIMARY KEY (type, id, field)
  )`,
  "CREATE INDEX IF NOT EXISTS records_value_sources_state ON records_value_sources (type, state, at)",
  "CREATE TABLE IF NOT EXISTS records_row_meta (type TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, label INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (type, id))",
  "CREATE TABLE IF NOT EXISTS records_field_history (type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS records_page_prefs (person TEXT NOT NULL, type TEXT NOT NULL, folded TEXT NOT NULL, keep_visible TEXT NOT NULL, PRIMARY KEY (person, type))",
];
const ready = new WeakSet<object>();
export function ensureReviewTables(tx: Tx): void {
  if (ready.has(tx)) return;
  for (const sql of TABLES) tx.exec(sql);
  ready.add(tx);
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function needType(store: Store, type: string): Promise<TypeDef> {
  if (!NAME.test(type)) throw new StoreError("unknown_type", `no type ${type}`);
  const def = (await store.types()).find((t) => t.name === type);
  if (!def) throw new StoreError("unknown_type", `no type ${type}`);
  return def;
}

export const metaOf = (tx: Tx, type: string, id: string): { label: number; holds: number } =>
  tx.get<{ label: number; holds: number }>("SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?", type, id) ?? { label: 0, holds: 0 };

export const rowOf = (tx: Tx, r: StoredRecord): RecordRow => toRow(r, metaOf(tx, r.type, r.id));

/** The ids of the relation items a value holds, as written (bare id strings or {urn} references). */
export function refIds(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") out.push(item);
    else if (isObj(item) && typeof item["urn"] === "string" && item["urn"].startsWith("vyre://")) {
      const s = item["urn"].slice(7).split("/");
      if (s.length >= 3 && s[2]) out.push(s[2]);
    }
  }
  return out;
}

export const isRelation = (f: FieldDef): boolean => f.kind === "link" || f.kind === "relation";
export const targetOf = (f: FieldDef): string | undefined => {
  if (typeof f.to === "string") return f.to;
  const o = f["options"] as unknown;
  return isObj(o) && typeof o["target"] === "string" ? o["target"] : undefined;
};
const inverseOf = (f: FieldDef): string | undefined => {
  const i = f["inverse"] as unknown;
  if (typeof i === "string") return i;
  return isObj(i) && typeof i["name"] === "string" ? i["name"] : undefined;
};

const empty = (v: unknown): boolean => {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) {
    if (typeof v["sealed"] === "string" && typeof v["present"] === "boolean") return v["present"] === false;
    return Object.keys(v).length === 0;
  }
  return false;
};

/** A field a person fills: not derived (formula, lookup, rollup, counters, stamps, buttons). */
const DERIVED_FTYPES = new Set(["formula", "lookup", "rollup", "autonumber", "created_time", "modified_time", "created_by", "modified_by", "button"]);
const fillable = (f: FieldDef): boolean => f["derived"] !== true && !(typeof f["ftype"] === "string" && DERIVED_FTYPES.has(f["ftype"]));

/** When a field last changed (ms), from its clock row; the record's own update time when the field has no clock row. */
function changedAt(tx: Tx, type: string, id: string, field: string, fallback: number): number {
  try {
    const row = tx.get<{ hlc: string }>(`SELECT hlc FROM "rt_${type}__fm" WHERE id = ? AND field = ?`, id, field);
    const h = row ? parseHlc(row.hlc) : null;
    if (h) return h.ms;
  } catch { /* the clock table is made with the first record of a type */ }
  return fallback;
}

function kindOfActor(actor: string): SourceKind {
  if (actor.startsWith("agt_") || actor.startsWith("agent")) return "agent";
  if (actor.startsWith("aut_") || actor.startsWith("automation")) return "automation";
  if (actor.startsWith("syn") || actor.startsWith("sync")) return "sync";
  if (actor.startsWith("imp") || actor.startsWith("import")) return "import";
  if (actor.startsWith("frm") || actor.startsWith("form") || actor.startsWith("link")) return "form";
  return "person";
}

interface SourceDb { type: string; id: string; field: string; kind: SourceKind; actor: string; at: number; link: string | null; state: ValueSource["state"]; note: string | null }
const sourceOf = (r: SourceDb): ValueSource => ({ kind: r.kind, actor: r.actor, at: r.at, state: r.state, ...(r.link ? { link: r.link } : {}) });

/** Fold a `record.value_proposed` event (the consumer in impl.ts calls this once per event). */
export function propose(tx: Tx, p: Record<string, unknown>, now: () => number = Date.now): void {
  ensureReviewTables(tx);
  const type = p["type"], recordId = p["recordId"], field = p["field"], source = p["source"];
  if (typeof type !== "string" || typeof recordId !== "string" || typeof field !== "string" || !isObj(source)) return;
  const kind = (["agent", "person", "form", "automation", "sync", "import"] as const).find((k) => k === source["kind"]) ?? "agent";
  const at = typeof source["at"] === "number" ? source["at"] : now();
  const state = p["reviewRequired"] === true ? "needs_review" : "counted";
  tx.run(
    `INSERT INTO records_value_sources (type, id, field, kind, actor, at, link, state, note, reviewer, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT(type, id, field) DO UPDATE SET kind = excluded.kind, actor = excluded.actor, at = excluded.at, link = excluded.link, state = excluded.state, note = NULL, reviewer = NULL, reviewed_at = NULL`,
    type, recordId, field, kind, typeof source["actor"] === "string" ? source["actor"] : "unknown", at, typeof source["link"] === "string" ? source["link"] : null, state,
  );
}

export function createReviewHandlers(deps: RvDeps): ReviewHandlers {
  const { tx, store } = deps;
  const now = (): number => (deps.now ?? Date.now)();
  const guard = async <T>(ctx: RvCtx, run: () => Promise<T>): Promise<T> => {
    try { ensureReviewTables(tx); return await run(); } catch (e) { return mapError(ctx as WriteCtx, e); }
  };
  const need = async (type: string, id: string): Promise<StoredRecord> => {
    const r = await store.get(type, id);
    if (!r) throw new StoreError("not_found", `no ${type} ${id}`);
    return r;
  };
  const fieldOf = (def: TypeDef, name: string): FieldDef => {
    const f = def.fields.find((x) => x.name === name);
    if (!f) throw new StoreError("unknown_field", `${def.name} has no field ${name}`);
    return f;
  };
  const refFor = (type: string, id: string, bare: boolean): unknown => (bare ? id : { urn: `vyre://${deps.space}/${type}/${id}` });

  /** The relation value after linking or unlinking `id`; undefined when nothing changes. */
  const relinked = (f: FieldDef, current: unknown, target: string, id: string, unlink: boolean): unknown => {
    const items = Array.isArray(current) ? current : current === null || current === undefined ? [] : [current];
    const bare = items.length > 0 && typeof items[0] === "string";
    const has = refIds(items).includes(id);
    if (unlink ? !has : has) return undefined;
    const kept = unlink ? items.filter((x) => !refIds([x]).includes(id)) : [...items, refFor(target, id, bare)];
    if (f.many === true || Array.isArray(current)) return kept;
    return kept.length ? kept[kept.length - 1] : null;
  };

  async function pendingRow(ctx: RvCtx, type: string, id: string, field: string): Promise<SourceDb> {
    const row = tx.get<SourceDb>("SELECT * FROM records_value_sources WHERE type = ? AND id = ? AND field = ?", type, id, field);
    if (!row || row.state !== "needs_review") return fail(ctx, "validation.not_found", `${field} of ${type} ${id} is not waiting for review.`);
    return row;
  }

  return {
    "records.changes": (ctx, input) => guard(ctx, async () => {
      await needType(store, input.type);
      const limit = Math.min(Math.max(input.limit ?? PAGE, 1), PAGE_MAX);
      const rows = tx.all<{ cursor: number; id: string; kind: string }>("SELECT cursor, id, kind FROM rs_changes WHERE type = ? AND cursor > ? ORDER BY cursor LIMIT ?", input.type, input.since, limit);
      const op = (k: string): "upsert" | "patch" | "delete" => (k === "removed" ? "delete" : k === "updated" ? "patch" : "upsert");
      return { changes: rows.map((r) => ({ seq: r.cursor, id: r.id, op: op(r.kind) })), next: rows.length ? rows[rows.length - 1]!.cursor : input.since };
    }),

    "records.completeness": (ctx, input) => guard(ctx, async () => {
      const def = await needType(store, input.type);
      const rec = await need(input.type, input.recordId);
      const asked = def.fields.filter(fillable);
      const missing = asked.filter((f) => empty(rec.data[f.name])).map((f) => ({ field: f.name, title: f.label ?? f.name }));
      return { filled: asked.length - missing.length, total: asked.length, missing };
    }),

    "records.gap_check": (ctx, input) => guard(ctx, async () => {
      if (!ctx.call) return fail(ctx, "internal.unavailable", "The rules of this type cannot be read: the schema module is not reachable from here.");
      const def = await needType(store, input.type);
      const answer = (await ctx.call("schema.gap_rules.list", { type: input.type })) as { rules?: GapRuleIn[] };
      const rules = (answer.rules ?? []).filter((r) => r.enabled !== false && def.fields.some((f) => f.name === r.field));
      if (!rules.length) return { gaps: [] };
      const records: StoredRecord[] = [];
      if (input.recordId !== undefined) records.push(await need(input.type, input.recordId));
      else {
        let cursor: string | undefined;
        do {
          const page = await store.query(input.type, { page: { limit: PAGE_MAX, ...(cursor ? { cursor } : {}) } });
          records.push(...page.rows);
          cursor = page.next_cursor;
        } while (cursor && records.length < SCAN_MAX);
      }
      const gaps: Gap[] = [];
      const t = now();
      for (const rec of records) {
        const found = new Map<string, string[]>();
        for (const rule of rules) {
          const value = rec.data[rule.field];
          let reason: Gap["reason"] | null = null;
          if (rule.when === "missing") { if (empty(value)) reason = "missing"; }
          else if (rule.staleAfterDays !== undefined && t - changedAt(tx, input.type, rec.id, rule.field, rec.updated_at) > rule.staleAfterDays * DAY) reason = "stale";
          if (!reason) continue;
          gaps.push({ recordId: rec.id, field: rule.field, reason, route: rule.route });
          found.set(rule.ruleId, [...(found.get(rule.ruleId) ?? []), rule.field]);
        }
        for (const [ruleId, fields] of found) ctx.emit("record.gaps_found", `record/${rec.id}`, { recordId: rec.id, type: input.type, fields, ruleId });
      }
      return { gaps };
    }),

    "records.relate": (ctx, input) => guard(ctx, async () => {
      const def = await needType(store, input.type);
      const f = fieldOf(def, input.field);
      if (!isRelation(f)) return fail(ctx, "validation.bad_input", `${input.field} is not a relation field.`);
      const target = targetOf(f);
      if (!target) return fail(ctx, "validation.bad_input", `${input.field} does not name the type it links to.`);
      const targetDef = await needType(store, target);
      const there = await need(target, input.toId);
      const here = await need(input.type, input.recordId);
      const unlink = input.unlink === true;
      const near = relinked(f, here.data[f.name], target, input.toId, unlink);
      // The other end of a two-way relation moves with this one.
      const invName = inverseOf(f);
      const invField = invName ? targetDef.fields.find((x) => x.name === invName && isRelation(x)) : undefined;
      const far = invField ? relinked(invField, there.data[invField.name], input.type, input.recordId, unlink) : undefined;
      let current = here;
      if (near !== undefined) {
        await deps.writes["records.update"](ctx as unknown as WriteCtx, { type: input.type, recordId: input.recordId, patch: { [f.name]: near } });
        current = await need(input.type, input.recordId);
      }
      if (far !== undefined && invField) {
        await deps.writes["records.update"](ctx as unknown as WriteCtx, { type: target, recordId: input.toId, patch: { [invField.name]: far } });
      }
      return { record: rowOf(tx, current) };
    }),

    "records.value_source": (ctx, input) => guard(ctx, async () => {
      const def = await needType(store, input.type);
      fieldOf(def, input.field);
      const rec = await need(input.type, input.recordId);
      const row = tx.get<SourceDb>("SELECT * FROM records_value_sources WHERE type = ? AND id = ? AND field = ?", input.type, input.recordId, input.field);
      if (row) return { source: sourceOf(row) };
      // No proposal on record: whoever the field clock names wrote it, and it counts.
      let actor = "unknown";
      let at = rec.updated_at;
      try {
        const c = tx.get<{ hlc: string; actor: string }>(`SELECT hlc, actor FROM "rt_${input.type}__fm" WHERE id = ? AND field = ?`, input.recordId, input.field);
        if (c) { actor = c.actor; at = parseHlc(c.hlc)?.ms ?? at; }
      } catch { /* no clock table yet */ }
      return { source: { kind: kindOfActor(actor), actor, at, state: "counted" } };
    }),

    "records.values.pending": (ctx, input) => guard(ctx, async () => {
      await needType(store, input.type);
      const limit = Math.min(Math.max(input.limit ?? PAGE, 1), PAGE_MAX);
      const start = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
      const total = tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM records_value_sources WHERE type = ? AND state = 'needs_review'", input.type)?.n ?? 0;
      const rows = tx.all<SourceDb>("SELECT * FROM records_value_sources WHERE type = ? AND state = 'needs_review' ORDER BY at, rowid LIMIT ? OFFSET ?", input.type, limit, start);
      const values: { recordId: string; type: string; field: string; value?: unknown; source: ValueSource }[] = [];
      for (const r of rows) {
        const rec = await store.get(r.type, r.id);
        if (!rec) continue;   // the record went to Trash; its proposal waits there
        const v = rec.data[r.field];
        values.push({ recordId: r.id, type: r.type, field: r.field, ...(v !== undefined ? { value: v } : {}), source: sourceOf(r) });
      }
      return { values, total, ...(start + rows.length < total ? { next: String(start + rows.length) } : {}) };
    }),

    "records.values.review": (ctx, input) => guard(ctx, async () => {
      const def = await needType(store, input.type);
      fieldOf(def, input.field);
      const row = await pendingRow(ctx, input.type, input.recordId, input.field);
      const rec = await need(input.type, input.recordId);
      const by = ctx.principal?.id ?? "unknown";
      let current = rec;
      if (input.decision === "reject") {
        // Put back what the field held before the proposal; the rejected value stays in history.
        const prev = tx.get<{ value: string | null }>(
          "SELECT value FROM records_field_history WHERE type = ? AND id = ? AND field = ? AND reason = 'previous' ORDER BY seq DESC, rowid DESC LIMIT 1", input.type, input.recordId, input.field,
        );
        let back: unknown = null;
        if (prev?.value) {
          try { const parsed = JSON.parse(prev.value) as unknown; back = isObj(parsed) && parsed["masked"] === true ? null : parsed; } catch { back = null; }
        }
        if (!same(rec.data[input.field], back)) {
          await deps.writes["records.update"](ctx as unknown as WriteCtx, { type: input.type, recordId: input.recordId, patch: { [input.field]: back } });
          current = await need(input.type, input.recordId);
        }
      }
      tx.run(
        "UPDATE records_value_sources SET state = ?, note = ?, reviewer = ?, reviewed_at = ? WHERE type = ? AND id = ? AND field = ?",
        input.decision === "accept" ? "counted" : "rejected", input.note ?? null, by, now(), row.type, row.id, row.field,
      );
      ctx.emit("record.value_reviewed", `record/${input.recordId}`, { recordId: input.recordId, type: input.type, field: input.field, decision: input.decision === "accept" ? "accepted" : "rejected", by });
      return { record: rowOf(tx, current) };
    }),
  };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
