// @reads /modules/records/migrations/0001_init.sql
// RecordStore over rt_<type> (ARCH 4.3.1) plus per-field clocks (ARCH 4.3, 5.4).
// API callers pass base_version and receive version_conflict. Sync passes a field hlc and baseSeq and merges per field.
// The migration is read by the selector so a data file does not select every test in the repo.
import { canonical } from "../../lib/canonical.ts";
import { withReversals } from "../../lib/reversal.ts";
import { REVERSALS } from "./reversals.ts";
import { compareHlc, parseHlc } from "../../lib/hlc.ts";
import { openRecordStore, recordWriter } from "../../kernel/src/store/records.ts";
import type { RecordWriter } from "../../kernel/src/store/records.ts";
import { isSealedRef } from "../../kernel/src/store/values.ts";
import { StoreError } from "../../kernel/src/store/types.ts";
import type {
  CreateManyResult,
  UpdateManyResult,
  FieldDef,
  FieldValue,
  RecordId,
  Store,
  StoredRecord,
  TypeDef,
} from "../../kernel/src/store/types.ts";
import type { ProjectionHost } from "../../kernel/src/store/projection.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import { perSpaceStore } from "../../host/src/daemon/store.ts";
import type { SpaceStoreSeam } from "../../host/src/daemon/store.ts";
import {
  createQueryHandlers,
  createRecordsHandlers,
  mapError,
  RecordsError,
  toRow,
  warmSearch,
} from "./handlers/index.ts";
import type { QueryHandlers, RecordRow, WriteCtx, WriteHandlers } from "./handlers/index.ts";
import { fieldMetaTable, historyText, recordsFieldMeta } from "./projections.ts";
import { createHistoryHandlers } from "./handlers/history.ts";
import { createCommentsHandlers, settleTurn } from "./handlers/comments.ts";
import type { CommentsHandlers } from "./handlers/comments.ts";
import type { HistoryHandlers } from "./handlers/history.ts";
import { createUpdateManyHandler } from "./handlers/update-many.ts";
import { createMergeHandlers } from "./handlers/merge.ts";
import type { MergeHandlers } from "./handlers/merge.ts";
import { createReviewHandlers, propose } from "./handlers/review.ts";
import type { ReviewHandlers } from "./handlers/review.ts";
import { createViewHandlers } from "./handlers/views.ts";
import type { ViewHandlers } from "./handlers/views.ts";
import { createPurgeHandlers } from "./handlers/purge.ts";
import { isKeptForRestart } from "../../host/src/routes/errors.ts";
import { backfillType, ensureComputedTables, markFillFailed, recomputeWithDependents } from "./handlers/computed.ts";
import type { ComputedDef, ComputedEnv } from "./handlers/computed.ts";
import type { TypeShape } from "../../lib/computed-fields.ts";
import type { PurgeHandlers } from "./handlers/purge.ts";
import { createSiteTableHandlers } from "./handlers/site-tables.ts";
import type { SiteTableEvent, SiteTableHandlers } from "./handlers/site-tables.ts";

/** The Vault, as Records needs it for sealed fields (host/src/seams/records-vault.ts builds it). Absent: a sealed value cannot be saved or shown, and says so. */
export interface RecordsVault {
  put(o: { type: string; recordId: string; field: string; value: string; ref?: string }): Promise<string>;
  reveal(ref: string, person: string): Promise<string>;
  /** Take back a value put for a record that was then not made (best effort: the value is overwritten). Absent: nothing is taken back. */
  discard?(ref: string): Promise<void>;
}
/** One new value Records put in the Vault for an item (a field that held no reference): discard takes it back if the record is not made. */
interface Put {
  ref: string;
  type: string;
  recordId: string;
  field: string;
}
let vault: RecordsVault | null = null;
/** The Vault the host handed, for a test that checks what the real one does with a call Records makes. */
export const recordsVaultInUse = (): RecordsVault | null => vault;
/** The host hands the Vault (a seam like the others). */
export function setRecordsVault(v: RecordsVault | null): void {
  vault = v;
}

/**
 * The sealed path: a value given for a sealed field is plain text (or `{ sealed: true, value: "text" }`) and goes to the Vault; the row keeps the reference only, so no row, event,
 * history entry or log line ever holds it. A reference passes as it is (a record read and written back), null clears the field, and an empty text is no value. An import (records.bulk_upsert),
 * a create and an update all land here, so a firm loading dates of birth no longer has to load them as text and retype them (r40, 18 Nov 2026).
 */
async function sealIn(
  def: TypeDef,
  recordId: string,
  data: Record<string, unknown>,
  current?: Record<string, unknown>,
  /** Dry: nothing goes to the Vault; a value that would be sealed shows as a reference to nothing, so the record can be checked before any value is written. */
  dry = false,
  /** Told of each value this call put, as its put returns: a failure on a later field still lets the caller take back the earlier ones. */
  onPut?: (p: Put) => void,
  /** Given: a value for a field that already holds a reference is not put now. The reference does not change, so the row does not need the put's answer; it is made after the record write commits (settle), and a refused write has put nothing. */
  defer?: Deferred[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const f of def.fields) {
    if (f.kind !== "sealed" || !Object.prototype.hasOwnProperty.call(out, f.name)) continue;
    const v = out[f.name];
    let text: string;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      // no Vault on this store (the kernel conformance suite, a bare Space): a plain value is refused as it always was, never kept
      if (!vault) continue;
      text = String(v);
      if (text === "") {
        out[f.name] = null;
        continue;
      }
    } else if (
      v &&
      typeof v === "object" &&
      (v as { sealed?: unknown }).sealed === true &&
      typeof (v as { value?: unknown }).value === "string"
    )
      text = (v as { value: string }).value;
    else continue;
    if (!vault)
      throw new StoreError(
        "unavailable",
        `${f.name} is sealed and the Vault is not available on this server, so the value was not saved.`,
      );
    if (dry) {
      out[f.name] = { sealed: f.name, ref: "pending", present: true, set_at: 0 };
      continue;
    }
    const have = current?.[f.name];
    if (defer && isSealedRef(have)) {
      defer.push({
        ref: (have as { ref: string }).ref,
        type: def.name,
        recordId,
        field: f.name,
        value: text,
        prev: have,
      });
      out[f.name] = { sealed: f.name, ref: (have as { ref: string }).ref, present: true, set_at: Date.now() };
      continue;
    }
    const ref = await vault.put({
      type: def.name,
      recordId,
      field: f.name,
      value: text,
      ...(isSealedRef(have) ? { ref: (have as { ref: string }).ref } : {}),
    });
    if (!isSealedRef(have)) onPut?.({ ref, type: def.name, recordId, field: f.name });
    out[f.name] = { sealed: f.name, ref, present: true, set_at: Date.now() };
  }
  return out;
}

/** Take back the new values an item put in the Vault: each is discarded. Best effort, as discard is. */
async function takeBackPuts(puts: Put[]): Promise<void> {
  if (vault?.discard) for (const p of puts) await vault.discard(p.ref).catch(() => undefined);
}

/** A value for a field that already holds a reference, put after the record write commits. `prev` is the field's earlier reference object (its set_at and present), written back if the put fails. */
interface Deferred extends Put {
  value: string;
  prev: unknown;
}
/** The words an item answers when a deferred put failed twice. */
const NOT_SAVED = "the value was not saved; the record keeps its previous value";
/** Put the deferred values of one committed item (each retried once). If one still fails the item is made whole again: every field its patch set is written back to what the row held before (a sealed field keeps its earlier ref, set_at and present), and the new values this call put under new refs are taken back (nothing references them now), so an error means nothing in the item changed; answers the error, or null. If the row moved on since the commit (a person's edit landed in the gap) the write back is refused: the error then says so and does not claim the record kept its previous value. */
async function settle(
  inner: Store,
  type: string,
  id: RecordId,
  version: number,
  deferred: Deferred[],
  prior: Record<string, unknown> | undefined,
  patchKeys: string[],
  fresh: Put[],
): Promise<StoreError | null> {
  let failed = false;
  for (const d of deferred) {
    const once = () => vault!.put({ type: d.type, recordId: d.recordId, field: d.field, value: d.value, ref: d.ref });
    try {
      await once();
    } catch {
      try {
        await once();
      } catch {
        failed = true;
        break;
      }
    }
  }
  if (!failed) return null;
  const back: Record<string, FieldValue | null> = {};
  for (const k of patchKeys) back[k] = (prior?.[k] ?? null) as FieldValue | null;
  let restored = true;
  let moved = false;
  await inner.update(type, id, back as Record<string, FieldValue>, version).catch((e: unknown) => {
    restored = false;
    moved = e instanceof StoreError && e.code === "version_conflict";
  });
  // the new refs of this call are referenced by no row once the write back took; when it did not, the row may still hold them and they stay
  if (restored) await takeBackPuts(fresh);
  if (!restored)
    return new StoreError(
      moved ? "version_conflict" : "unavailable",
      moved
        ? "the value was not saved and the record changed since; check it"
        : "the value was not saved and the record could not be put back; check it",
    );
  return new StoreError("unavailable", NOT_SAVED);
}

/** The singular and plural spellings a type key may be asked for by: deal and deals, company and companies, status and statuses. */
function variants(name: string): string[] {
  const out = new Set<string>([name, `${name}s`, `${name}es`]);
  if (/[^aeiou]y$/.test(name)) out.add(`${name.slice(0, -1)}ies`);
  if (name.endsWith("ies")) out.add(`${name.slice(0, -3)}y`);
  if (name.endsWith("es")) out.add(name.slice(0, -2));
  if (name.endsWith("s")) out.add(name.slice(0, -1));
  return [...out];
}

/**
 * The type a record call names. The name must match; failing that, the one type whose name is the singular or the plural of what was asked (a table that sends deal for the type deals), so
 * a type made a moment ago works whichever of the two a screen holds. Two candidates, or none, is no match.
 */
export function typeNamed(types: readonly TypeDef[], asked: string): TypeDef | undefined {
  const exact = types.find((t) => t.name === asked);
  if (exact) return exact;
  const near = variants(asked);
  const found = types.filter((t) => t.name !== asked && near.includes(t.name));
  return found.length === 1 ? found[0] : undefined;
}

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
  "records.get"(
    ctx: Pick<WriteCtx, "trace">,
    input: { type: string; recordId: string },
  ): Promise<{ record: RecordRow }>;
  "records.get_many"(
    ctx: Pick<WriteCtx, "trace">,
    input: { type: string; ids: string[] },
  ): Promise<{ rows: RecordRow[] }>;
  "records.history"(
    ctx: Pick<WriteCtx, "trace">,
    input: { type: string; recordId: string; field?: string },
  ): Promise<{ entries: { field: string; value: unknown; hlc: string; actor: string; reason?: string }[] }>;
}

export type RecordsHandlers = WriteHandlers & QueryHandlers & ReadHandlers;

export interface RecordsHandle {
  host: ProjectionHost;
  store: Store;
  handlers: RecordsHandlers;
  clocks(type: string, id: string): FieldClock[];
  history(type: string, id: string): HistoryRow[];
  mergeFields(
    type: string,
    id: string,
    fields: Record<string, FieldWrite>,
    actor: string,
  ): Promise<{ record: StoredRecord; applied: string[]; lost: MergeLoss[] }>;
}

const REF_TOKEN = /^[A-Za-z0-9_]{1,80}$/;

function same(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === y) return true;
  try {
    return canonical(x) === canonical(y);
  } catch {
    return false;
  }
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
    const had =
      Object.prototype.hasOwnProperty.call(current, key) && current[key] !== undefined && current[key] !== null;
    if (had && !same(current[key], value)) throw new RecordsError("write_once", `${key} is write-once`);
  }
}

const blank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * A status field whose stages list fields to fill (`stageGates`, kept by the schema module) refuses a stage change while they are empty. The values counted are the record's own with this patch
 * on top, so one update can fill the fields and change the stage. Every caller comes through here: a person, an Automation, an agent.
 */
function assertStageGates(def: TypeDef, current: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const f of def.fields) {
    const gates = f["stageGates"] as Record<string, { enter?: string[]; leave?: string[] }> | undefined;
    if (!gates || !Object.prototype.hasOwnProperty.call(patch, f.name)) continue;
    const from = current[f.name],
      to = patch[f.name];
    if (typeof to !== "string" || same(from, to)) continue;
    const merged = { ...current, ...patch };
    const wants: { key: string; stage: string; when: "enter" | "leave" }[] = [
      ...((typeof from === "string" ? gates[from]?.leave : undefined) ?? []).map((key) => ({
        key,
        stage: from as string,
        when: "leave" as const,
      })),
      ...(gates[to]?.enter ?? []).map((key) => ({ key, stage: to, when: "enter" as const })),
    ];
    const open = wants
      .filter((w, i) => blank(merged[w.key]) && wants.findIndex((x) => x.key === w.key) === i)
      .map((w) => ({ ...w, title: String(def.fields.find((x) => x.name === w.key)?.label ?? w.key) }));
    if (open.length)
      throw new RecordsError("stage_gate", `Fill these first: ${open.map((m) => m.title).join(", ")}.`, {
        reason: "fields_required",
        fields: open,
        toStage: to,
      });
  }
}

export function openRecords(
  o: {
    path?: string;
    space?: string;
    actor?: string;
    clock?: () => number;
    opened?: { host: ProjectionHost; store: Store };
  } = {},
): RecordsHandle {
  // `opened` is the Space store the host hands over (P-H_08); without it (tests) the module opens a private one
  const opened =
    o.opened ??
    openRecordStore({
      path: o.path ?? ":memory:",
      space: o.space ?? "sp_records",
      extra: [recordsFieldMeta],
      ...(o.actor !== undefined ? { actor: o.actor } : {}),
      ...(o.clock !== undefined ? { clock: o.clock } : {}),
    });
  const inner = opened.store;
  const host = opened.host;
  // Types are read from the store every time, never kept: schema.apply (and sync, and replay) define types through the Space store without passing this wrapper,
  // so a copy kept here went stale and a type made after the first record write answered "no type" (rc.7 owner bug). One indexed read of one row is cheap.
  const allTypes = async (): Promise<readonly TypeDef[]> => inner.types();
  const needType = async (type: string): Promise<TypeDef> => {
    const row = /^[a-z][a-z0-9_]{0,62}$/.test(type)
      ? host.tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type)
      : undefined;
    const def = row ? (JSON.parse(row.def) as TypeDef) : typeNamed(await allTypes(), type);
    if (!def) throw new StoreError("unknown_type", `no type ${type}`);
    return def;
  };

  const store: Store = {
    ...inner,
    async define(diff) {
      const have = await allTypes();
      for (const name of diff.remove_types ?? []) {
        const t = have.find((x) => x.name === name);
        if (t?.["protected"] === true)
          throw new RecordsError("protected", `type ${name} is protected and cannot be dropped`);
      }
      return inner.define(diff);
    },
    async create(type, id, data) {
      const def = await needType(type);
      const puts: Put[] = [];
      try {
        return await inner.create(
          def.name,
          id,
          scrub(def, await sealIn(def, id, { ...data }, undefined, false, (p) => puts.push(p))),
        );
      } catch (e) {
        await takeBackPuts(puts);
        throw e;
      }
    },
    async createMany(type, items) {
      const def = await needType(type);
      const out: CreateManyResult[] = new Array(items.length);
      // 1. check every item as it will be stored (a value to be sealed shows as a reference to nothing), before any value goes to the Vault: an item that will be refused writes nothing
      let refused: unknown[] = [];
      if (inner.checkNew) {
        const dry: { id: RecordId; data: Record<string, FieldValue> }[] = [];
        for (const it of items) {
          try {
            dry.push({
              id: it.id,
              data: scrub(def, await sealIn(def, it.id, { ...it.data }, undefined, true)) as Record<string, FieldValue>,
            });
          } catch (e) {
            dry.push({ id: it.id, data: {} });
            refused[dry.length - 1] = e;
          }
        }
        const checked = await inner.checkNew(def.name, dry);
        refused = items.map((_, i) => refused[i] ?? checked[i] ?? null);
      }
      // 2. seal and store the items that passed
      const ready: { at: number; id: RecordId; data: Record<string, FieldValue> }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (refused[i]) {
          out[i] = { ok: false, error: refused[i] };
          continue;
        }
        const puts: Put[] = [];
        try {
          ready.push({
            at: i,
            id: it.id,
            data: scrub(def, await sealIn(def, it.id, { ...it.data }, undefined, false, (p) => puts.push(p))) as Record<
              string,
              FieldValue
            >,
          });
        } catch (e) {
          await takeBackPuts(puts);
          out[i] = { ok: false, error: e };
        }
      }
      let made: CreateManyResult[];
      if (inner.createMany)
        made = await inner.createMany(
          def.name,
          ready.map((r) => ({ id: r.id, data: r.data })),
        );
      else {
        made = [];
        for (const r of ready) {
          try {
            made.push({ ok: true, record: await inner.create(def.name, r.id, r.data) });
          } catch (e) {
            made.push({ ok: false, error: e });
          }
        }
      }
      made.forEach((m, k) => {
        out[ready[k]!.at] = m;
      });
      // 3. a value sealed for a record that was then not made is taken back
      if (vault?.discard) {
        for (const [k, m] of made.entries()) {
          if (m.ok) continue;
          for (const f of def.fields) {
            const v = ready[k]!.data[f.name];
            if (f.kind === "sealed" && isSealedRef(v))
              await vault.discard((v as { ref: string }).ref).catch(() => undefined);
          }
        }
      }
      return out;
    },
    async update(type, id, patch, base) {
      const def = await needType(type);
      const row = await inner.get(def.name, id);
      const puts: Put[] = [];
      const deferred: Deferred[] = [];
      let made: StoredRecord;
      let keys: string[] = [];
      try {
        const clean = scrub(def, await sealIn(def, id, { ...patch }, row?.data, false, (p) => puts.push(p), deferred));
        keys = Object.keys(clean);
        if (row && row.version === base) assertWriteOnce(def, row.data, clean);
        if (row) assertStageGates(def, row.data, clean);
        made = await inner.update(def.name, id, clean, base);
      } catch (e) {
        await takeBackPuts(puts);
        throw e;
      }
      if (deferred.length) {
        const err = await settle(inner, def.name, id, made.version, deferred, row?.data, keys, puts);
        if (err) throw err;
      }
      return made;
    },
    async updateMany(type, items) {
      const def = await needType(type);
      const out: UpdateManyResult[] = new Array(items.length);
      const ready: {
        at: number;
        id: RecordId;
        patch: Record<string, FieldValue | null>;
        base_version: number;
        /** What this call put in the Vault for the item (a new value, or one written over the value a reference already held). */
        fresh: Put[];
        /** Values for fields that already held a reference: put after the commit. */
        deferred: Deferred[];
        /** The row as it was before this call, to make the item whole again if a deferred put fails. */
        prior: Record<string, unknown> | undefined;
      }[] = [];
      const takeBack = takeBackPuts;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const fresh: Put[] = [];
        const deferred: Deferred[] = [];
        try {
          const row = await inner.get(def.name, it.id);
          // 1. check the item as it will be stored (a value to be sealed shows as a reference to nothing), before any value goes to the Vault: an item that will be refused writes nothing
          const dry = scrub(def, await sealIn(def, it.id, { ...it.patch }, row?.data, true));
          if (row && row.version === it.base_version) assertWriteOnce(def, row.data, dry);
          if (row) assertStageGates(def, row.data, dry);
          // 2. seal it
          const clean = scrub(
            def,
            await sealIn(def, it.id, { ...it.patch }, row?.data, false, (p) => fresh.push(p), deferred),
          );
          ready.push({
            at: i,
            id: it.id,
            patch: clean as Record<string, FieldValue | null>,
            base_version: it.base_version,
            fresh,
            deferred,
            prior: row?.data,
          });
        } catch (e) {
          await takeBack(fresh);
          out[i] = { ok: false, error: e };
        }
      }
      let made: UpdateManyResult[];
      try {
        if (inner.updateMany)
          made = await inner.updateMany(
            def.name,
            ready.map((r) => ({ id: r.id, patch: r.patch, base_version: r.base_version })),
          );
        else {
          made = [];
          for (const r of ready) {
            try {
              made.push({ ok: true, record: await inner.update(def.name, r.id, r.patch, r.base_version) });
            } catch (e) {
              made.push({ ok: false, error: e });
            }
          }
        }
      } catch (e) {
        // the group could not be committed: nothing was updated, so every value this call put is taken back before the caller tries again (a second put would leave these behind)
        for (const r of ready) await takeBack(r.fresh);
        throw e;
      }
      // the values for fields that already held a reference go in now that the group is committed; one that fails twice answers its item an error and has its field's earlier metadata written back
      const settled = new Set<number>();
      for (const [k, m] of made.entries()) {
        const r = ready[k]!;
        if (!m.ok || !r.deferred.length) continue;
        const err = await settle(
          inner,
          def.name,
          r.id,
          m.record.version,
          r.deferred,
          r.prior,
          Object.keys(r.patch),
          r.fresh,
        );
        if (err) {
          made[k] = { ok: false, error: err };
          settled.add(k); // its new values were dealt with there
        }
      }
      made.forEach((m, k) => {
        out[ready[k]!.at] = m;
      });
      // 3. a value put for an item that was then not updated is taken back
      for (const [k, m] of made.entries()) if (!m.ok && !settled.has(k)) await takeBack(ready[k]!.fresh);
      return out;
    },
    async remove(type, id, base) {
      const def = (await allTypes()).find((t) => t.name === type);
      if (def?.["protected"] === true)
        throw new RecordsError("protected", `type ${type} is protected: its records cannot be deleted`);
      const meta = host.tx.get<{ holds: number }>(
        "SELECT holds FROM records_row_meta WHERE type = ? AND id = ?",
        type,
        id,
      );
      if ((meta?.holds ?? 0) > 0) throw new RecordsError("on_hold", `record ${id} is on hold`);
      return inner.remove(type, id, base);
    },
  };

  const metaOf = (type: string, id: string): { label: number; holds: number } => {
    const row = host.tx.get<{ label: number; holds: number }>(
      "SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?",
      type,
      id,
    );
    return { label: row?.label ?? 0, holds: row?.holds ?? 0 };
  };

  const clocks = (type: string, id: string): FieldClock[] => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(type)) return [];
    return host.tx.all<FieldClock>(
      `SELECT field, hlc, actor, seq FROM "${fieldMetaTable(type)}" WHERE id = ? ORDER BY field`,
      id,
    );
  };

  const history = (type: string, id: string): HistoryRow[] => {
    const rows = host.tx.all<{
      field: string;
      value: string | null;
      hlc: string;
      actor: string;
      seq: number;
      reason: string;
    }>(
      "SELECT field, value, hlc, actor, seq, reason FROM records_field_history WHERE type = ? AND id = ? ORDER BY rowid",
      type,
      id,
    );
    return rows.map((r) => {
      let value: unknown = null;
      if (r.value !== null) {
        try {
          value = JSON.parse(r.value);
        } catch {
          value = r.value;
        }
      }
      return { field: r.field, value, hlc: r.hlc, actor: r.actor, seq: r.seq, reason: r.reason };
    });
  };

  async function mergeFields(
    type: string,
    id: string,
    fields: Record<string, FieldWrite>,
    actor: string,
  ): Promise<{ record: StoredRecord; applied: string[]; lost: MergeLoss[] }> {
    const def = await needType(type);
    const row = await store.get(type, id);
    if (!row) throw new StoreError("not_found", `no ${type} ${id}`);
    const known = new Map(def.fields.map((f) => [f.name, f]));
    const clean: Record<string, FieldWrite> = {};
    for (const [name, inc] of Object.entries(fields)) {
      const f = known.get(name);
      if (!f) throw new StoreError("unknown_field", `${type} has no field ${name}`);
      if (!parseHlc(inc.hlc)) throw new StoreError("invalid", `${name} needs a field clock`);
      const patch = scrub(def, await sealIn(def, id, { [name]: inc.value }, row.data));
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
        else if (how === "assistant") {
          take = false;
          reason = "conflict";
        } else {
          const incoming = parseHlc(inc.hlc)!;
          const stored = current ? parseHlc(current.hlc) : null;
          take = !stored || compareHlc(incoming, stored) > 0;
          reason = "lww_loser";
        }
      }
      if (take) {
        patch[name] = inc.value;
        applied.push(name);
      } else lost.push({ field: name, reason });
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
        type,
        id,
        loss.field,
        historyText(kind, loss.field, inc.value),
        inc.hlc,
        actor,
        seq,
        loss.reason,
      );
    }
    const record = applied.length ? ((await store.get(type, id)) ?? next) : next;
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
      } catch (e) {
        return mapError(ctx as WriteCtx, e);
      }
    },
    // The rows that exist, in the order asked, each once. Which of them the caller may see, and which fields of each, is the host's projection (record-access.ts project, the same gate records.get is read through): an id that is
    // missing and an id the caller may not see are the same answer here, a row that is not there.
    async "records.get_many"(ctx, input) {
      try {
        const rows: RecordRow[] = [];
        for (const id of new Set(input.ids)) {
          const rec = await store.get(input.type, id);
          if (rec) rows.push(toRow(rec, metaOf(rec.type, rec.id)));
        }
        return { rows };
      } catch (e) {
        return mapError(ctx as WriteCtx, e);
      }
    },
    async "records.history"(ctx, input) {
      try {
        const entries = history(input.type, input.recordId)
          .filter((r) => input.field === undefined || r.field === input.field)
          .map((r) => ({ field: r.field, value: r.value, hlc: r.hlc, actor: r.actor, reason: r.reason }));
        return { entries };
      } catch (e) {
        return mapError(ctx as WriteCtx, e);
      }
    },
  };
  const handlers: RecordsHandlers = { ...writes, ...queries, ...reads };
  return { host, store, handlers, clocks, history, mergeFields };
}

// One handle per Space store: two daemons in one process each have their own, and a call is served from the one its ctx.db belongs to (perSpaceStore).
const stores = perSpaceStore<RecordsHandle>(
  (seam) => openRecords(seam ? { opened: seam.open() } : {}),
  (seam) => seam.declare([recordsFieldMeta]),
);
/** The host hands the Space store (P-H_08, ruling 31). The per-field clocks projection must be on that store before it opens, so it is declared as the store arrives. */
export function setRecordsSpaceStore(seam: SpaceStoreSeam | null): void {
  stores.set(seam);
}
export const hostSeams: SeamSetters = { setRecordsSpaceStore, setRecordsVault };
function live(ctx?: { db?: unknown }): RecordsHandle {
  return stores.get(ctx);
}

// The rest of the live map (P-L3_LIVE): history, versions and holds (handlers/history.ts), merge, bulk upsert and export (handlers/merge.ts), both built once over the live handle.
// DECISION: reveal opens a sealed reference through the Vault seam (setRecordsVault); export has no `putFile` until the host hands this module the Files port; until then it refuses, it does not guess.
type LiveHistory = Omit<HistoryHandlers, "records.history">;
const extras = new WeakMap<RecordsHandle, Extra>();
type Extra = {
  comments: CommentsHandlers;
  history: LiveHistory;
  merge: MergeHandlers;
  sites: SiteTableHandlers;
  review: ReviewHandlers;
  views: ViewHandlers;
  purge: PurgeHandlers;
  updateMany: ReturnType<typeof createUpdateManyHandler>;
};
function more(c?: { db?: unknown }): Extra {
  const h = live(c);
  let extra: Extra | undefined = extras.get(h);
  if (!extra) {
    extra = {
      comments: createCommentsHandlers({ tx: h.host.tx }),
      history: createHistoryHandlers({
        tx: h.host.tx,
        store: h.store,
        writes: h.handlers,
        readLog: (q) => h.host.store.read(q),
        // a reveal is the Vault's: it checks the person's access to the item and logs the reveal
        unseal: (sealed, ctx) =>
          vault && ctx.principal
            ? vault.reveal(sealed.ref, ctx.principal.id)
            : Promise.reject(new Error("the vault is not available")),
      }),
      merge: createMergeHandlers({ store: h.store, tx: h.host.tx }),
      sites: createSiteTableHandlers({ store: h.store }),
      review: createReviewHandlers({ tx: h.host.tx, store: h.store, writes: h.handlers, space: h.host.store.space }),
      views: createViewHandlers({ tx: h.host.tx, store: h.store, writes: h.handlers, space: h.host.store.space }),
      purge: createPurgeHandlers({ store: h.store, tx: h.host.tx }),
      updateMany: createUpdateManyHandler({
        store: h.store,
        meta: (type, id) => {
          const row = h.host.tx.get<{ label: number; holds: number }>(
            "SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?",
            type,
            id,
          );
          return { label: row?.label ?? 0, holds: row?.holds ?? 0 };
        },
      }),
    };
    extras.set(h, extra);
  }
  return extra;
}

/** records.update_many (the sealed write-back's batch): its handler is built in handlers/update-many.ts, typed by the generated registry at the loader. */
export interface UpdateManyHandlers {
  "records.update_many"(ctx: { db?: unknown }, input: unknown): Promise<unknown>;
}

export type LiveRecordsHandlers = RecordsHandlers &
  UpdateManyHandlers &
  LiveHistory &
  CommentsHandlers &
  MergeHandlers &
  ReviewHandlers &
  ViewHandlers &
  PurgeHandlers;

/** Loader entry. The module stays stub until its manifest flips to live, which is when the host reads this. */
const table: LiveRecordsHandlers = {
  "records.create": (ctx, input) => live(ctx).handlers["records.create"](ctx, input),
  "records.update": (ctx, input) => live(ctx).handlers["records.update"](ctx, input),
  "records.delete": (ctx, input) => live(ctx).handlers["records.delete"](ctx, input),
  "records.restore": (ctx, input) => live(ctx).handlers["records.restore"](ctx, input),
  "records.query": (ctx, input) => live(ctx).handlers["records.query"](ctx, input),
  "records.search": (ctx, input) => live(ctx).handlers["records.search"](ctx, input),
  "records.counts": (ctx, input) => live(ctx).handlers["records.counts"](ctx, input),
  "records.get": (ctx, input) => live(ctx).handlers["records.get"](ctx, input),
  "records.get_many": (ctx, input) => live(ctx as never).handlers["records.get_many"](ctx, input),
  "records.history": (ctx, input) => live(ctx).handlers["records.history"](ctx, input),
  "records.activity": (ctx, input) => more(ctx).history["records.activity"](ctx, input),
  "records.comments.list": (ctx, input) => more(ctx).comments["records.comments.list"](ctx, input),
  "records.comments.add": (ctx, input) => more(ctx).comments["records.comments.add"](ctx, input),
  "records.comments.edit": (ctx, input) => more(ctx).comments["records.comments.edit"](ctx, input),
  "records.comments.resolve": (ctx, input) => more(ctx).comments["records.comments.resolve"](ctx, input),
  "records.comments.delete": (ctx, input) => more(ctx).comments["records.comments.delete"](ctx, input),
  "records.as_of": (ctx, input) => more(ctx).history["records.as_of"](ctx, input),
  "records.versions": (ctx, input) => more(ctx).history["records.versions"](ctx, input),
  "records.restore_version": (ctx, input) => more(ctx).history["records.restore_version"](ctx, input),
  "records.hold": (ctx, input) => more(ctx).history["records.hold"](ctx, input),
  "records.release_hold": (ctx, input) => more(ctx).history["records.release_hold"](ctx, input),
  "records.reveal": (ctx, input) => more(ctx).history["records.reveal"](ctx, input),
  "records.merge": (ctx, input) => more(ctx).merge["records.merge"](ctx, input),
  "records.bulk_upsert": (ctx, input) => more(ctx).merge["records.bulk_upsert"](ctx, input),
  "records.update_many": (ctx, input) => more(ctx).updateMany(ctx as never, input as never) as never,
  "records.export": (ctx, input) => more(ctx).merge["records.export"](ctx, input),
  "records.changes": (ctx, input) => more(ctx).review["records.changes"](ctx, input),
  "records.completeness": (ctx, input) => more(ctx).review["records.completeness"](ctx, input),
  "records.gap_check": (ctx, input) => more(ctx).review["records.gap_check"](ctx, input),
  "records.relate": (ctx, input) => more(ctx).review["records.relate"](ctx, input),
  "records.value_source": (ctx, input) => more(ctx).review["records.value_source"](ctx, input),
  "records.values.pending": (ctx, input) => more(ctx).review["records.values.pending"](ctx, input),
  "records.values.review": (ctx, input) => more(ctx).review["records.values.review"](ctx, input),
  "records.view": (ctx, input) => more(ctx).views["records.view"](ctx, input),
  "records.relations_map": (ctx, input) => more(ctx).views["records.relations_map"](ctx, input),
  "records.page_prefs.get": (ctx, input) => more(ctx).views["records.page_prefs.get"](ctx, input),
  "records.page_prefs.set": (ctx, input) => more(ctx).views["records.page_prefs.set"](ctx, input),
  "records.purge": (ctx, input) => more(ctx).purge["records.purge"](ctx, input),
  "records.purge_trashed": (ctx, input) => more(ctx).purge["records.purge_trashed"](ctx, input),
};

type AnyCtx = {
  principal?: { id: string };
  actingFor?: string | undefined;
  trace?: { traceId?: string };
  run?: string | undefined;
};
/** Every write a call makes names who made it, as every other module's events do: the person or agent, the person an agent acts for, the trace and the run (never svc_records). */
export const writerOf = (ctx: AnyCtx): RecordWriter | null =>
  ctx.principal?.id
    ? {
        actor: ctx.principal.id,
        ...(ctx.actingFor !== undefined ? { onBehalf: ctx.actingFor } : {}),
        ...(ctx.trace?.traceId !== undefined ? { traceId: ctx.trace.traceId } : {}),
        ...(ctx.run !== undefined ? { runId: ctx.run } : {}),
      }
    : null;
export const handlers: LiveRecordsHandlers = withReversals(
  Object.fromEntries(
    Object.entries(table).map(([name, f]) => [
      name,
      (ctx: AnyCtx, input: unknown) => {
        const w = writerOf(ctx);
        return w
          ? recordWriter.run(w, () => (f as (c: unknown, i: unknown) => unknown)(ctx, input))
          : (f as (c: unknown, i: unknown) => unknown)(ctx, input);
      },
    ]),
  ) as unknown as LiveRecordsHandlers,
  REVERSALS,
);

/**
 * At boot and every ten minutes: every type has its full text index, so the first search of a type that was filled before the index existed does not build it while a person waits.
 * A type with no index and many rows is built here, one type at a time, between other work.
 */
export const periodic = {
  "records.search_warm": {
    everyMs: 10 * 60_000,
    immediate: true,
    async run(ctx: unknown): Promise<number> {
      const h = live(ctx as { db?: unknown });
      let n = 0;
      for (const def of await h.store.types()) {
        warmSearch(h.host.tx, def.name);
        n++;
      }
      return n;
    },
  },
};

// ---- computed fields (formula, lookup, rollup): the consumer that keeps records_computed ----

/** What the consumer has learned of the schema; forgotten whenever the schema changes. */
const computedMemo = new WeakMap<object, { defs: Map<string, ComputedDef[]>; shapes: Map<string, TypeShape> | null }>();
/** The store keeps a relation's other end as { name }; a plain name is read too. */
const inverseName = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string"
      ? (v as { name: string }).name
      : null;
type CallCtx = { db?: unknown; now(): number; call(cap: string, input: unknown): Promise<unknown> };
function computedEnv(ctx: CallCtx, stopping?: () => boolean): ComputedEnv {
  const h = live(ctx);
  const memo = computedMemo.get(h) ?? computedMemo.set(h, { defs: new Map(), shapes: null }).get(h)!;
  return {
    tx: h.host.tx,
    store: h.store,
    now: () => ctx.now(),
    ...(stopping ? { stopping } : {}),
    async defsOf(type) {
      const had = memo.defs.get(type);
      if (had) return had;
      let defs: ComputedDef[] = [];
      try {
        const got = (await ctx.call("schema.types.get", { type })) as {
          type?: { fields?: Array<{ key: string; type: string; options?: Record<string, unknown> }> };
        };
        defs = (got.type?.fields ?? [])
          .filter((f) => f.type === "formula" || f.type === "lookup" || f.type === "rollup")
          .map((f) => ({ key: f.key, type: f.type as ComputedDef["type"], options: f.options ?? {} }));
      } catch {
        defs = [];
      }
      memo.defs.set(type, defs);
      return defs;
    },
    async shapes() {
      if (memo.shapes) return memo.shapes;
      const out = new Map<string, TypeShape>();
      for (const t of await h.store.types())
        out.set(t.name, {
          key: t.name,
          fields: t.fields.map((f) => ({
            key: f.name,
            type: typeof f["ftype"] === "string" ? (f["ftype"] as string) : f.kind,
            options:
              typeof f.to === "string"
                ? {
                    target: f.to,
                    many: f.many === true,
                    ...(inverseName(f["inverse"]) ? { inverse: inverseName(f["inverse"]) } : {}),
                  }
                : {},
          })),
        });
      memo.shapes = out;
      return out;
    },
  };
}

/**
 * Computed values: a record that is created, changed, restored or removed has its values recomputed (or dropped), and a schema change fills a whole type in slices of about 15 ms with the loop given back between
 * them (records_computed_job holds the progress, so a restart goes on). It runs on the host's hook pump, as every consumer does.
 */
const COMPUTED_EVENTS = ["record.created", "record.updated", "record.restored", "record.deleted", "schema.changed"];
async function runComputed(
  ctx: CallCtx,
  event: { name: string; payload: Record<string, unknown>; stopping?: () => boolean },
): Promise<void> {
  const h = live(ctx);
  ensureComputedTables(h.host.tx);
  if (event.name === "schema.changed") {
    computedMemo.delete(h);
    const env = computedEnv(ctx, event.stopping);
    const types = Array.isArray(event.payload["types"])
      ? (event.payload["types"] as unknown[]).filter((x): x is string => typeof x === "string")
      : typeof event.payload["type"] === "string"
        ? [event.payload["type"]]
        : [];
    for (const type of types) {
      try {
        await backfillType(env, type);
      } catch (e) {
        // a stop is not a failure: the fill stays "running" at its cursor and the next start hands the event over again
        if (!isKeptForRestart(e))
          markFillFailed(h.host.tx, type, e instanceof Error ? e.message : String(e), ctx.now());
        throw e;
      }
    }
    return;
  }
  const type = typeof event.payload["type"] === "string" ? event.payload["type"] : "";
  const id =
    typeof event.payload["recordId"] === "string"
      ? event.payload["recordId"]
      : typeof event.payload["id"] === "string"
        ? event.payload["id"]
        : "";
  if (type === "" || id === "") return;
  try {
    await recomputeWithDependents(computedEnv(ctx), type, id);
  } catch (e) {
    // an event of a record whose type has been dropped since (the purge of a type deletes its records, announcing each): there are no computed values to keep for it, and retrying it only fills the log with warnings
    const code = String((e as { code?: unknown; error?: { code?: unknown } } | null)?.code ?? (e as { error?: { code?: unknown } } | null)?.error?.code ?? "");
    if (/unknown_type$/.test(code) || (e instanceof Error && /^no type /.test(e.message))) return;
    throw e;
  }
}

/** The site tables (P-L3_ST): the sites module announces a table, this module makes the record type. The host runs it once per event after commit (ruling 32). */
export const consumers = {
  "records.computed": {
    on: COMPUTED_EVENTS,
    takesRepair: true, // a record a repair announced still needs its computed values
    run: (
      ctx: unknown,
      event: { name: string; payload: Record<string, unknown>; stopping?: () => boolean },
    ): Promise<void> => runComputed(ctx as CallCtx, event),
  },
  "records.site_tables": {
    on: ["site.table_created", "site.table_promoted"],
    async run(ctx: unknown, event: { name: string; payload: Record<string, unknown> }): Promise<void> {
      const ev = event.payload as unknown as SiteTableEvent;
      if (event.name === "site.table_created") await more(ctx as { db?: unknown }).sites.created(ev);
      else await more(ctx as { db?: unknown }).sites.promoted(ev);
    },
  },
  /** A mentioned agent's turn ended: its comment stops saying "is replying" (it answered by calling records.comments.add, which cleared it already, or it did not and the turn is over). */
  "records.comment_turns": {
    on: ["turn.completed", "turn.failed", "turn.cancelled"],
    async run(ctx: unknown, event: { name: string; payload: Record<string, unknown> }): Promise<void> {
      const { threadId, agentId } = event.payload as { threadId?: string; agentId?: string };
      if (typeof threadId !== "string" || typeof agentId !== "string") return;
      settleTurn(
        live(ctx as { db?: unknown }).host.tx,
        threadId,
        agentId,
        event.name === "turn.completed" ? "done" : "failed",
      );
    },
  },
  /** An agent or automation proposed a value: it waits for review or counts straight away (per field), and the source is kept for the popover. */
  "records.value_source": {
    on: ["record.value_proposed"],
    async run(ctx: unknown, event: { name: string; payload: Record<string, unknown> }): Promise<void> {
      propose(live(ctx as { db?: unknown }).host.tx, event.payload);
    },
  },
};

export { RecordsError } from "./handlers/index.ts";

/**
 * Host calls for the removal wizard (members.owned): the records whose `owner` field names the person, in every type that has one, and handing them to someone else. The change goes through records.update
 * as the person doing the removal, so record permissions, labels and holds apply as they do for anyone.
 */
type OwnerCtx = { call(cap: string, input: unknown): Promise<unknown> };
async function ownedRecords(
  person: string,
  ctx?: { db?: unknown },
): Promise<{ type: string; id: string; title: string }[]> {
  const out: { type: string; id: string; title: string }[] = [];
  for (const t of await live(ctx).store.types()) {
    if (!t.fields.some((f) => f.name === "owner")) continue;
    const page = await live(ctx).store.query(t.name, {
      filter: { field: "owner", op: "eq", value: person },
      page: { limit: 500 },
    });
    for (const r of page.rows)
      out.push({ type: t.name, id: r.id, title: String((r.data as Record<string, unknown>)["name"] ?? r.id) });
  }
  return out;
}
export const hostCalls = {
  "records.owned_by": async (ctx: unknown, i: { person: string }) => {
    const all = await ownedRecords(i.person, ctx as { db?: unknown });
    return { records: { count: all.length, sample: all.slice(0, 5), ids: all.slice(0, 500).map((r) => r.id) } };
  },
  "records.reassign_owned": async (
    ctx: OwnerCtx,
    i: { person: string; kind: string; action: string; to?: string },
  ): Promise<number> => {
    if (i.kind !== "records" || i.action !== "reassign" || !i.to) return 0;
    let n = 0;
    for (const r of await ownedRecords(i.person, ctx as { db?: unknown })) {
      await ctx.call("records.update", { type: r.type, recordId: r.id, patch: { owner: i.to } });
      n++;
    }
    return n;
  },
};
