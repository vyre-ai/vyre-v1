// records.create / update / delete / restore. API callers pass baseVersion and get version_conflict.
// Sync merges by field clock in impl.ts and does not come through baseVersion.
import { mintUuid } from "../../../lib/ids.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, EventName, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface WriteCtx {
  trace: Ctx["trace"];
  emit: (name: EventName, subject: string, payload: Record<string, unknown>) => unknown;
}

export interface RecordRow {
  id: string;
  type: string;
  version: number;
  label: number;
  fields: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  holds: number;
}

export interface WriteDeps {
  store: Store;
  meta: (type: string, id: string) => { label: number; holds: number };
}

export interface WriteHandlers {
  "records.create"(ctx: WriteCtx, input: { type: string; fields: Record<string, unknown>; idempotencyKey?: string }): Promise<{ record: RecordRow }>;
  "records.update"(ctx: WriteCtx, input: { type: string; recordId: string; patch: Record<string, unknown>; baseVersion?: number }): Promise<{ record: RecordRow }>;
  "records.delete"(ctx: WriteCtx, input: { type: string; recordId: string }): Promise<{ deleted: boolean }>;
  "records.restore"(ctx: WriteCtx, input: { type: string; recordId: string }): Promise<{ record: RecordRow }>;
}

/** Why a write was refused beyond the Store codes: the host maps each to its catalogue code. */
export type RecordsReason = "write_once" | "protected" | "on_hold";

export class RecordsError extends StoreError {
  reason: RecordsReason;
  constructor(reason: RecordsReason, message: string) {
    super("invalid", message);
    this.name = "RecordsError";
    this.reason = reason;
  }
}

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: WriteCtx, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

/** Turn a store refusal into the catalogue error the caller sees. Anything else passes through. */
export function mapError(ctx: WriteCtx, e: unknown): never {
  if (e instanceof RecordsError) {
    if (e.reason === "on_hold") fail(ctx, "permission.on_hold", e.message);
    fail(ctx, "validation.field_locked", e.message);
  }
  if (e instanceof StoreError) {
    if (e.code === "version_conflict") fail(ctx, "validation.version_conflict", e.message);
    if (e.code === "not_found") fail(ctx, "validation.not_found", e.message);
    if (e.code === "unique_violation") fail(ctx, "validation.duplicate", e.message);
    fail(ctx, "validation.bad_input", e.message, { reason: e.code });
  }
  throw e;
}

async function guard<T>(ctx: WriteCtx, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { return mapError(ctx, e); }
}

const subject = (id: string): string => `record/${id}`;

export function toRow(r: StoredRecord, meta: { label: number; holds: number }): RecordRow {
  return {
    id: r.id,
    type: r.type,
    version: r.version,
    label: meta.label,
    fields: { ...r.data },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    holds: meta.holds,
    ...(r.deleted_at !== undefined ? { deletedAt: r.deleted_at } : {}),
  };
}

/** Values of the changed fields as stored (sealed fields are references, never plaintext), null for a removed field. */
function changed(keys: string[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
  return out;
}

/** Previous values of the same fields; a field that did not exist is left out. */
function before(keys: string[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  return out;
}

export function createWriteHandlers(deps: WriteDeps): WriteHandlers {
  const seen = new Map<string, { type: string; id: string }>();
  return {
    "records.create": (ctx, input) => guard(ctx, async () => {
      const key = input.idempotencyKey === undefined ? undefined : `${input.type}\0${input.idempotencyKey}`;
      const prior = key === undefined ? undefined : seen.get(key);
      if (prior) {
        const have = await deps.store.get(prior.type, prior.id);
        if (have) return { record: toRow(have, deps.meta(prior.type, prior.id)) };
      }
      const id = mintUuid();
      const rec = await deps.store.create(input.type, id, input.fields);
      if (key !== undefined) seen.set(key, { type: input.type, id: rec.id });
      ctx.emit("record.created", subject(rec.id), { recordId: rec.id, type: rec.type, fields: { ...rec.data } });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    }),
    "records.update": (ctx, input) => guard(ctx, async () => {
      let base = input.baseVersion;
      if (base === undefined) {
        const cur = await deps.store.get(input.type, input.recordId);
        if (!cur) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
        base = cur.version;
      }
      const prior = await deps.store.get(input.type, input.recordId);
      const rec = await deps.store.update(input.type, input.recordId, input.patch, base);
      const keys = Object.keys(input.patch);
      ctx.emit("record.updated", subject(rec.id), {
        recordId: rec.id, type: rec.type, fields: changed(keys, rec.data), prev: before(keys, prior?.data ?? {}), version: rec.version,
      });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    }),
    "records.delete": (ctx, input) => guard(ctx, async () => {
      const cur = await deps.store.get(input.type, input.recordId);
      if (!cur) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
      await deps.store.remove(input.type, input.recordId, cur.version);
      ctx.emit("record.deleted", subject(input.recordId), { recordId: input.recordId, type: input.type, prev: { ...cur.data } });
      return { deleted: true };
    }),
    "records.restore": (ctx, input) => guard(ctx, async () => {
      const rec = await deps.store.restore(input.type, input.recordId);
      ctx.emit("record.restored", subject(rec.id), { recordId: rec.id, type: rec.type });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    }),
  };
}
