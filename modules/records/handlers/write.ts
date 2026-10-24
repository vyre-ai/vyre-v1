// records.create / update / delete / restore. API callers pass baseVersion and get version_conflict.
// Sync merges by field clock in impl.ts and does not come through baseVersion.
import { mintUuid } from "../../../lib/ids.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";

export interface WriteCtx {
  trace: { traceId: string };
  emit?: (name: string, subject: string, payload: Record<string, unknown>) => void;
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
  "records.create"(ctx: WriteCtx, input: { type: string; fields: Record<string, unknown>; idempotencyKey: string }): Promise<{ record: RecordRow }>;
  "records.update"(ctx: WriteCtx, input: { type: string; recordId: string; patch: Record<string, unknown>; baseVersion?: number }): Promise<{ record: RecordRow }>;
  "records.delete"(ctx: WriteCtx, input: { type: string; recordId: string }): Promise<{ deleted: boolean }>;
  "records.restore"(ctx: WriteCtx, input: { type: string; recordId: string }): Promise<{ record: RecordRow }>;
}

function emit(ctx: WriteCtx, name: string, subject: string, payload: Record<string, unknown>): void {
  ctx.emit?.(name, subject, payload);
}

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

export function createWriteHandlers(deps: WriteDeps): WriteHandlers {
  const seen = new Map<string, { type: string; id: string }>();
  return {
    async "records.create"(ctx, input) {
      const key = `${input.type}\0${input.idempotencyKey}`;
      const prior = seen.get(key);
      if (prior) {
        const have = await deps.store.get(prior.type, prior.id);
        if (have) return { record: toRow(have, deps.meta(prior.type, prior.id)) };
      }
      const id = mintUuid();
      const rec = await deps.store.create(input.type, id, input.fields);
      seen.set(key, { type: input.type, id: rec.id });
      emit(ctx, "record.created", rec.id, { recordId: rec.id, type: rec.type, fields: Object.keys(input.fields) });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    },
    async "records.update"(ctx, input) {
      let base = input.baseVersion;
      if (base === undefined) {
        const cur = await deps.store.get(input.type, input.recordId);
        if (!cur) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
        base = cur.version;
      }
      const rec = await deps.store.update(input.type, input.recordId, input.patch, base);
      emit(ctx, "record.updated", rec.id, { recordId: rec.id, type: rec.type, fields: Object.keys(input.patch), version: rec.version });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    },
    async "records.delete"(ctx, input) {
      const cur = await deps.store.get(input.type, input.recordId);
      if (!cur) throw new StoreError("not_found", `no ${input.type} ${input.recordId}`);
      await deps.store.remove(input.type, input.recordId, cur.version);
      emit(ctx, "record.deleted", input.recordId, { recordId: input.recordId, type: input.type });
      return { deleted: true };
    },
    async "records.restore"(ctx, input) {
      const rec = await deps.store.restore(input.type, input.recordId);
      emit(ctx, "record.restored", rec.id, { recordId: rec.id, type: rec.type });
      return { record: toRow(rec, deps.meta(rec.type, rec.id)) };
    },
  };
}
