// @reads /modules/records/migrations/0001_init.sql
// RecordStore over rt_<type> (ARCH 4.3.1) plus per-field clocks (ARCH 4.3, 5.4).
// API callers pass base_version and receive version_conflict. Sync passes a field hlc and baseSeq and merges per field.
// The migration is read by the selector so a data file does not select every test in the repo.
import { canonical } from "../../lib/canonical.ts";
import { compareHlc, parseHlc } from "../../lib/hlc.ts";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import { isSealedRef } from "../../kernel/src/store/values.ts";
import { StoreError } from "../../kernel/src/store/types.ts";
import type { FieldDef, Store, StoredRecord, TypeDef } from "../../kernel/src/store/types.ts";
import type { ProjectionHost } from "../../kernel/src/store/projection.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import type { SpaceStoreSeam } from "../../host/src/daemon/store.ts";
import { createQueryHandlers, createRecordsHandlers, mapError, RecordsError, toRow } from "./handlers/index.ts";
import type { QueryHandlers, RecordRow, WriteCtx, WriteHandlers } from "./handlers/index.ts";
import { fieldMetaTable, historyText, recordsFieldMeta } from "./projections.ts";
import { createHistoryHandlers } from "./handlers/history.ts";
import type { HistoryHandlers } from "./handlers/history.ts";
import { createMergeHandlers } from "./handlers/merge.ts";
import type { MergeHandlers } from "./handlers/merge.ts";
import { createReviewHandlers, propose } from "./handlers/review.ts";
import type { ReviewHandlers } from "./handlers/review.ts";
import { createViewHandlers } from "./handlers/views.ts";
import type { ViewHandlers } from "./handlers/views.ts";
import { createPurgeHandlers } from "./handlers/purge.ts";
import type { PurgeHandlers } from "./handlers/purge.ts";
import { createSiteTableHandlers } from "./handlers/site-tables.ts";
import type { SiteTableEvent, SiteTableHandlers } from "./handlers/site-tables.ts";

export interface FieldWrite {
  value: unknown;
  hlc: string;
  baseSeq?: number;
}

export interface FieldClock {
  field: string;
  hlc: string;
  actor: string;
  seq: number;
}

export interface HistoryRow {
  field: string;
  value: unknown;
  hlc: string;
  actor: string;
  seq: number;
  reason: string;
}

export interface MergeLoss {
  field: string;
  reason: "lww_loser" | "conflict";
}

/** records.get and records.history, over the store and the field-history table this file owns. */
export interface ReadHandlers {
  "records.get"(ctx: Pick<WriteCtx, "trace">, input: { type: string; recordId: string }): Promise<{ record: RecordRow }>;
  "records.history"(ctx: Pick<WriteCtx, "trace">, input: { type: string; recordId: string; field?: string }): Promise<{ entries: { field: string; value: unknown; hlc: string; actor: string; reason?: string }[] }>;
}

export type RecordsHandlers = WriteHandlers & QueryHandlers & ReadHandlers;

export interface RecordsHandle {
  host: ProjectionHost;
  store: Store;
  handlers: RecordsHandlers;
  clocks(type: string, id: string): FieldClock[];
  history(type: string, id: string): HistoryRow[];
  mergeFields(type: string, id: string, fields: Record<string, FieldWrite>, actor: string): Promise<{ record: StoredRecord; applied: string[]; lost: MergeLoss[] }>;
}

const REF_TOKEN = /^[A-Za-z0-9_]{1,80}$/;

function same(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === y) return true;
  try { return canonical(x) === canonical(y); } catch { return false; }
}

function sealRef(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { sealed: v.sealed, ref: v.ref, present: v.present };
  if (typeof v.valid_format === "boolean") out.valid_format = v.valid_format;
  if (typeof v.set_at === "number") out.set_at = v.set_at;
  return out;
}

/** Refuse a plaintext sealed value. A reference keeps only the handle fields, so an extra copy of the secret is dropped. */
function scrub(def: TypeDef, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const f of def.fields) {
    if (f.kind !== "sealed" || !Object.prototype.hasOwnProperty.call(out, f.name)) continue;
    const v = out[f.name];
    if (v === null || v === undefined) continue;
    if (!isSealedRef(v) || !REF_TOKEN.test((v as { ref: string }).ref)) {
      throw new StoreError("sealed_value_refused", `${f.name} is sealed: a value is never stored, only a reference`);
    }
    out[f.name] = sealRef(v as Record<string, unknown>);
  }
  return out;
}

function policy(f: FieldDef): "lww" | "assistant" | "append" {
  const m = f["merge"];
  if (m === "append") return "append";
  if (m === "assistant" || m === "text-crdt") return "assistant";
  if (m === "lww") return "lww";
  if (f["protected"] === true || f.kind === "sealed") return "assistant";
  return "lww";
}

function assertWriteOnce(def: TypeDef, current: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const f = def.fields.find((x) => x.name === key);
    if (f?.["write_once"] !== true) continue;
    const had = Object.prototype.hasOwnProperty.call(current, key) && current[key] !== undefined && current[key] !== null;
    if (had && !same(current[key], value)) throw new RecordsError("write_once", `${key} is write-once`);
  }
}

export function openRecords(o: { path?: string; space?: string; actor?: string; clock?: () => number; opened?: { host: ProjectionHost; store: Store } } = {}): RecordsHandle {
  // `opened` is the Space store the host hands over (P-H_08); without it (tests) the module opens a private one
  const opened = o.opened ?? openRecordStore({
    path: o.path ?? ":memory:",
    space: o.space ?? "sp_records",
    extra: [recordsFieldMeta],
    ...(o.actor !== undefined ? { actor: o.actor } : {}),
    ...(o.clock !== undefined ? { clock: o.clock } : {}),
  });
  const inner = opened.store;
  const host = opened.host;
  let typeCache: readonly TypeDef[] | null = null;
  const allTypes = async (): Promise<readonly TypeDef[]> => {
    if (!typeCache) typeCache = await inner.types();
    return typeCache;
  };
  const needType = async (type: string): Promise<TypeDef> => {
    const def = (await allTypes()).find((t) => t.name === type);
    if (!def) throw new StoreError("unknown_type", `no type ${type}`);
    return def;
  };

  const store: Store = {
    ...inner,
    async define(diff) {
      const have = await allTypes();
      for (const name of diff.remove_types ?? []) {
        const t = have.find((x) => x.name === name);
        if (t?.["protected"] === true) throw new RecordsError("protected", `type ${name} is protected and cannot be dropped`);
      }
      try { return await inner.define(diff); } finally { typeCache = null; }
    },
    async create(type, id, data) {
      const def = await needType(type);
      return inner.create(type, id, scrub(def, { ...data }));
    },
    async update(type, id, patch, base) {
      const def = await needType(type);
      const clean = scrub(def, { ...patch });
      const row = await inner.get(type, id);
      if (row && row.version === base) assertWriteOnce(def, row.data, clean);
      return inner.update(type, id, clean, base);
    },
    async remove(type, id, base) {
      const def = (await allTypes()).find((t) => t.name === type);
      if (def?.["protected"] === true) throw new RecordsError("protected", `type ${type} is protected: its records cannot be deleted`);
      const meta = host.tx.get<{ holds: number }>("SELECT holds FROM records_row_meta WHERE type = ? AND id = ?", type, id);
      if ((meta?.holds ?? 0) > 0) throw new RecordsError("on_hold", `record ${id} is on hold`);
      return inner.remove(type, id, base);
    },
  };

  const metaOf = (type: string, id: string): { label: number; holds: number } => {
    const row = host.tx.get<{ label: number; holds: number }>("SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?", type, id);
    return { label: row?.label ?? 0, holds: row?.holds ?? 0 };
  };

  const clocks = (type: string, id: string): FieldClock[] => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(type)) return [];
    return host.tx.all<FieldClock>(`SELECT field, hlc, actor, seq FROM "${fieldMetaTable(type)}" WHERE id = ? ORDER BY field`, id);
  };

  const history = (type: string, id: string): HistoryRow[] => {
    const rows = host.tx.all<{ field: string; value: string | null; hlc: string; actor: string; seq: number; reason: string }>(
      "SELECT field, value, hlc, actor, seq, reason FROM records_field_history WHERE type = ? AND id = ? ORDER BY rowid",
      type, id,
    );
    return rows.map((r) => {
      let value: unknown = null;
      if (r.value !== null) { try { value = JSON.parse(r.value); } catch { value = r.value; } }
      return { field: r.field, value, hlc: r.hlc, actor: r.actor, seq: r.seq, reason: r.reason };
    });
  };

  async function mergeFields(type: string, id: string, fields: Record<string, FieldWrite>, actor: string): Promise<{ record: StoredRecord; applied: string[]; lost: MergeLoss[] }> {
    const def = await needType(type);
    const row = await store.get(type, id);
    if (!row) throw new StoreError("not_found", `no ${type} ${id}`);
    const known = new Map(def.fields.map((f) => [f.name, f]));
    const clean: Record<string, FieldWrite> = {};
    for (const [name, inc] of Object.entries(fields)) {
      const f = known.get(name);
      if (!f) throw new StoreError("unknown_field", `${type} has no field ${name}`);
      if (!parseHlc(inc.hlc)) throw new StoreError("invalid", `${name} needs a field clock`);
      const patch = scrub(def, { [name]: inc.value });
      const value = patch[name];
      assertWriteOnce(def, row.data, { [name]: value });
      const next: FieldWrite = { value, hlc: inc.hlc };
      if (inc.baseSeq !== undefined) next.baseSeq = inc.baseSeq;
      clean[name] = next;
    }
    const have = new Map(clocks(type, id).map((c) => [c.field, c]));
    const applied: string[] = [];
    const lost: MergeLoss[] = [];
    const patch: Record<string, unknown> = {};
    for (const [name, inc] of Object.entries(clean)) {
      const f = known.get(name)!;
      const current = have.get(name);
      if (same(row.data[name], inc.value)) continue;
      const matchesBase = !current || (inc.baseSeq !== undefined && current.seq === inc.baseSeq);
      let take = matchesBase;
      let reason: MergeLoss["reason"] = "lww_loser";
      if (!matchesBase) {
        const how = policy(f);
        if (how === "append") take = true;
        else if (how === "assistant") { take = false; reason = "conflict"; }
        else {
          const incoming = parseHlc(inc.hlc)!;
          const stored = current ? parseHlc(current.hlc) : null;
          take = !stored || compareHlc(incoming, stored) > 0;
          reason = "lww_loser";
        }
      }
      if (take) { patch[name] = inc.value; applied.push(name); }
      else lost.push({ field: name, reason });
    }
    const next = applied.length ? await store.update(type, id, patch, row.version) : row;
    const table = fieldMetaTable(type);
    for (const name of applied) {
      const inc = clean[name]!;
      host.tx.run(`UPDATE "${table}" SET hlc = ?, actor = ? WHERE id = ? AND field = ?`, inc.hlc, actor, id, name);
    }
    for (const loss of lost) {
      const inc = clean[loss.field]!;
      const seq = have.get(loss.field)?.seq ?? 0;
      const kind = known.get(loss.field)?.kind;
      host.tx.run(
        "INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        type, id, loss.field, historyText(kind, loss.field, inc.value), inc.hlc, actor, seq, loss.reason,
      );
    }
    const record = applied.length ? (await store.get(type, id)) ?? next : next;
    return { record, applied, lost };
  }

  const writes = createRecordsHandlers({ store, meta: metaOf });
  const queries = createQueryHandlers({ tx: host.tx, now: o.clock ?? Date.now });
  const reads: ReadHandlers = {
    async "records.get"(ctx, input) {
      try {
        const rec = await store.get(input.type, input.recordId);
        if (!rec) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
        return { record: toRow(rec, metaOf(rec.type, rec.id)) };
      } catch (e) { return mapError(ctx as WriteCtx, e); }
    },
    async "records.history"(ctx, input) {
      try {
        const entries = history(input.type, input.recordId)
          .filter((r) => input.field === undefined || r.field === input.field)
          .map((r) => ({ field: r.field, value: r.value, hlc: r.hlc, actor: r.actor, reason: r.reason }));
        return { entries };
      } catch (e) { return mapError(ctx as WriteCtx, e); }
    },
  };
  const handlers: RecordsHandlers = { ...writes, ...queries, ...reads };
  return { host, store, handlers, clocks, history, mergeFields };
}

let shared: RecordsHandle | null = null;
let spaceSeam: SpaceStoreSeam | null = null;
/** The host hands the Space store (P-H_08, ruling 31). The per-field clocks projection must be on that store before it opens, so it is declared here. */
export function setRecordsSpaceStore(seam: SpaceStoreSeam | null): void {
  spaceSeam = seam;
  shared = null;
  extra = null;
  seam?.declare([recordsFieldMeta]);
}
export const hostSeams: SeamSetters = { setRecordsSpaceStore };
function live(): RecordsHandle {
  if (!shared) shared = openRecords(spaceSeam ? { opened: spaceSeam.open() } : {});
  return shared;
}

// The rest of the live map (P-L3_LIVE): history, versions and holds (handlers/history.ts), merge, bulk upsert and export (handlers/merge.ts), both built once over the live handle.
// DECISION: reveal has no `unseal` and export no `putFile` until the host hands this module the Vault and the Files port (a host seam); until then they refuse, they do not guess.
type LiveHistory = Omit<HistoryHandlers, "records.history">;
let extra: { history: LiveHistory; merge: MergeHandlers; sites: SiteTableHandlers; review: ReviewHandlers; views: ViewHandlers; purge: PurgeHandlers } | null = null;
function more(): NonNullable<typeof extra> {
  if (!extra) {
    const h = live();
    extra = {
      history: createHistoryHandlers({ tx: h.host.tx, store: h.store, writes: h.handlers, readLog: (q) => h.host.store.read(q) }),
      merge: createMergeHandlers({ store: h.store, tx: h.host.tx }),
      sites: createSiteTableHandlers({ store: h.store }),
      review: createReviewHandlers({ tx: h.host.tx, store: h.store, writes: h.handlers, space: h.host.store.space }),
      views: createViewHandlers({ tx: h.host.tx, store: h.store, writes: h.handlers, space: h.host.store.space }),
      purge: createPurgeHandlers({ store: h.store, tx: h.host.tx }),
    };
  }
  return extra;
}

export type LiveRecordsHandlers = RecordsHandlers & LiveHistory & MergeHandlers & ReviewHandlers & ViewHandlers & PurgeHandlers;

/** Loader entry. The module stays stub until its manifest flips to live, which is when the host reads this. */
export const handlers: LiveRecordsHandlers = {
  "records.create": (ctx, input) => live().handlers["records.create"](ctx, input),
  "records.update": (ctx, input) => live().handlers["records.update"](ctx, input),
  "records.delete": (ctx, input) => live().handlers["records.delete"](ctx, input),
  "records.restore": (ctx, input) => live().handlers["records.restore"](ctx, input),
  "records.query": (ctx, input) => live().handlers["records.query"](ctx, input),
  "records.search": (ctx, input) => live().handlers["records.search"](ctx, input),
  "records.counts": (ctx, input) => live().handlers["records.counts"](ctx, input),
  "records.get": (ctx, input) => live().handlers["records.get"](ctx, input),
  "records.history": (ctx, input) => live().handlers["records.history"](ctx, input),
  "records.as_of": (ctx, input) => more().history["records.as_of"](ctx, input),
  "records.versions": (ctx, input) => more().history["records.versions"](ctx, input),
  "records.restore_version": (ctx, input) => more().history["records.restore_version"](ctx, input),
  "records.hold": (ctx, input) => more().history["records.hold"](ctx, input),
  "records.release_hold": (ctx, input) => more().history["records.release_hold"](ctx, input),
  "records.reveal": (ctx, input) => more().history["records.reveal"](ctx, input),
  "records.merge": (ctx, input) => more().merge["records.merge"](ctx, input),
  "records.bulk_upsert": (ctx, input) => more().merge["records.bulk_upsert"](ctx, input),
  "records.export": (ctx, input) => more().merge["records.export"](ctx, input),
  "records.changes": (ctx, input) => more().review["records.changes"](ctx, input),
  "records.completeness": (ctx, input) => more().review["records.completeness"](ctx, input),
  "records.gap_check": (ctx, input) => more().review["records.gap_check"](ctx, input),
  "records.relate": (ctx, input) => more().review["records.relate"](ctx, input),
  "records.value_source": (ctx, input) => more().review["records.value_source"](ctx, input),
  "records.values.pending": (ctx, input) => more().review["records.values.pending"](ctx, input),
  "records.values.review": (ctx, input) => more().review["records.values.review"](ctx, input),
  "records.view": (ctx, input) => more().views["records.view"](ctx, input),
  "records.relations_map": (ctx, input) => more().views["records.relations_map"](ctx, input),
  "records.page_prefs.get": (ctx, input) => more().views["records.page_prefs.get"](ctx, input),
  "records.page_prefs.set": (ctx, input) => more().views["records.page_prefs.set"](ctx, input),
  "records.purge": (ctx, input) => more().purge["records.purge"](ctx, input),
  "records.purge_trashed": (ctx, input) => more().purge["records.purge_trashed"](ctx, input),
};

/** The site tables (P-L3_ST): the sites module announces a table, this module makes the record type. The host runs it once per event after commit (ruling 32). */
export const consumers = {
  "records.site_tables": {
    on: ["site.table_created", "site.table_promoted"],
    async run(_ctx: unknown, event: { name: string; payload: Record<string, unknown> }): Promise<void> {
      const ev = event.payload as unknown as SiteTableEvent;
      if (event.name === "site.table_created") await more().sites.created(ev);
      else await more().sites.promoted(ev);
    },
  },
  /** An agent or automation proposed a value: it waits for review or counts straight away (per field), and the source is kept for the popover. */
  "records.value_source": {
    on: ["record.value_proposed"],
    async run(_ctx: unknown, event: { name: string; payload: Record<string, unknown> }): Promise<void> {
      propose(live().host.tx, event.payload);
    },
  },
};

export { RecordsError } from "./handlers/index.ts";

/**
 * Host calls for the removal wizard (members.owned): the records whose `owner` field names the person, in every type that has one, and handing them to someone else. The change goes through records.update
 * as the person doing the removal, so record permissions, labels and holds apply as they do for anyone.
 */
type OwnerCtx = { call(cap: string, input: unknown): Promise<unknown> };
async function ownedRecords(person: string): Promise<{ type: string; id: string; title: string }[]> {
  const out: { type: string; id: string; title: string }[] = [];
  for (const t of await live().store.types()) {
    if (!t.fields.some((f) => f.name === "owner")) continue;
    const page = await live().store.query(t.name, { filter: { field: "owner", op: "eq", value: person }, page: { limit: 500 } });
    for (const r of page.rows) out.push({ type: t.name, id: r.id, title: String((r.data as Record<string, unknown>)["name"] ?? r.id) });
  }
  return out;
}
export const hostCalls = {
  "records.owned_by": async (_ctx: unknown, i: { person: string }) => {
    const all = await ownedRecords(i.person);
    return { records: { count: all.length, sample: all.slice(0, 5), ids: all.slice(0, 500).map((r) => r.id) } };
  },
  "records.reassign_owned": async (ctx: OwnerCtx, i: { person: string; kind: string; action: string; to?: string }): Promise<number> => {
    if (i.kind !== "records" || i.action !== "reassign" || !i.to) return 0;
    let n = 0;
    for (const r of await ownedRecords(i.person)) { await ctx.call("records.update", { type: r.type, recordId: r.id, patch: { owner: i.to } }); n++; }
    return n;
  },
};
