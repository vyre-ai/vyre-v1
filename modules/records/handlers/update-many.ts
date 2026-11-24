// records.update_many: records.update for a group of records of one type, one commit for the group (Store.updateMany). It is plumbing for the sync engine, which puts the sealed values of a group of records it has just
// made in the Vault (each record's second write, the one that kept the pull from finishing): it is not a step an agent takes. Each item is checked like records.update checks one (the caller's right to edit that
// record), has its own result, and is announced in order with the same record.updated event; an item the store refuses is refused alone.
import { isHostService } from "../../../lib/trust.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { FieldValue, Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { mapError, toRow } from "./write.ts";
import type { RecordRow, WriteCtx } from "./write.ts";
import type { MergeCtx } from "./merge.ts";

export interface UpdateManyIn {
  type: string;
  items: Array<{ recordId: string; patch: Record<string, unknown>; baseVersion?: number }>;
}
export interface UpdateManyItemOut {
  recordId: string;
  record?: RecordRow;
  error?: { code: string; message: string; reason?: string };
}
export interface UpdateManyDeps {
  store: Store;
  meta: (type: string, id: string) => { label: number; holds: number };
}
/** The most items one call takes: a group is one commit, and a commit this long holds the loop for about 50 ms. */
export const MAX_UPDATE_MANY = 200;

const changed = (keys: string[], data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
  return out;
};
const before = (keys: string[], data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  return out;
};

/** What one refused item says: the catalogue code and words records.update would have answered, and the store's own reason (so a caller can tell a whole group that failed from one item that was refused). */
function refusal(ctx: Pick<WriteCtx, "trace">, e: unknown): { code: string; message: string; reason?: string } {
  const reason = e instanceof StoreError ? e.code : undefined;
  try {
    mapError(ctx as WriteCtx, e);
  } catch (out) {
    const err = (out as { error?: { code?: string; message?: string } }).error;
    if (err?.code)
      return { code: err.code, message: err.message ?? "refused", ...(reason !== undefined ? { reason } : {}) };
  }
  return {
    code: "internal.unexpected",
    message: e instanceof Error ? e.message : String(e),
    ...(reason ? { reason } : {}),
  };
}

export function createUpdateManyHandler(deps: UpdateManyDeps) {
  return async (ctx: MergeCtx, input: UpdateManyIn): Promise<{ results: UpdateManyItemOut[] }> => {
    if (input.items.length > MAX_UPDATE_MANY)
      throw new StoreError("invalid", `records.update_many takes at most ${MAX_UPDATE_MANY} items`);
    const out: UpdateManyItemOut[] = new Array(input.items.length);
    const ready: { at: number; id: string; patch: Record<string, unknown>; base: number; prior: StoredRecord }[] = [];
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]!;
      try {
        // the same right records.update needs, checked for each record (the host's own service is pre-authorized by the pipeline for every capability)
        if (!isHostService(ctx.principal)) {
          const d = ctx.authorize?.(
            { perm: "records.edit", level: "edit", cap: "records.update" },
            { type: "record", id: it.recordId },
          );
          if (d?.effect === "hold") {
            // the change would wait for a person's yes: it is not made here, and says so (it is not a missing record)
            out[i] = {
              recordId: it.recordId,
              error: {
                code: "permission.needs_approval",
                message: "A change to this record needs approval, so it was not made.",
              },
            };
            continue;
          }
          if (d?.effect !== "allow") throw new StoreError("not_found", `no ${input.type} ${it.recordId}`);
        }
        const cur = await deps.store.get(input.type, it.recordId);
        if (!cur) throw new StoreError("not_found", `no ${input.type} ${it.recordId}`);
        ready.push({ at: i, id: it.recordId, patch: it.patch, base: it.baseVersion ?? cur.version, prior: cur });
      } catch (e) {
        out[i] = { recordId: it.recordId, error: refusal(ctx, e) };
      }
    }
    if (ready.length) {
      let made: Awaited<ReturnType<NonNullable<Store["updateMany"]>>>;
      try {
        made = deps.store.updateMany
          ? await deps.store.updateMany(
              input.type,
              ready.map((r) => ({
                id: r.id,
                patch: r.patch as Record<string, FieldValue | null>,
                base_version: r.base,
              })),
            )
          : await Promise.all(
              ready.map((r) =>
                deps.store.update(input.type, r.id, r.patch as Record<string, FieldValue>, r.base).then(
                  (record) => ({ ok: true as const, record }),
                  (error: unknown) => ({ ok: false as const, error }),
                ),
              ),
            );
      } catch (e) {
        // the group could not be tried at all (the store is gone): every item says so
        made = ready.map(() => ({ ok: false as const, error: e }));
      }
      // announced in the order given, as one records.update after another would
      made.forEach((m, k) => {
        const r = ready[k]!;
        if (!m.ok) {
          out[r.at] = { recordId: r.id, error: refusal(ctx, m.error) };
          return;
        }
        const rec = m.record;
        out[r.at] = { recordId: r.id, record: toRow(rec, deps.meta(rec.type, rec.id)) };
        // the store answers the same version when the patch changed nothing: that is no write, so no event
        if (rec.version === r.prior.version) return;
        const keys = Object.keys(r.patch);
        ctx.emit("record.updated", `record/${rec.id}`, {
          recordId: rec.id,
          type: rec.type,
          fields: changed(keys, rec.data),
          prev: before(keys, r.prior.data),
          version: rec.version,
        });
      });
    }
    return { results: out };
  };
}
