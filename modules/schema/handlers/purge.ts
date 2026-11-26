// When the restore window of a dropped field (or type) ends, its values are taken out of every copy for good. A drop keeps the values in Trash for 30 days (sc_trash.payload) so the field can be restored; nothing
// removed them after that, and the Space log, the record store's own log, the change feed and the field history kept them as well. This job takes expired Trash entries one at a time under a time budget, and for
// each one cleans the copies of ALL the fields of the entry in ONE pass over the type's log: a page at a time, the rows of the page are written again first (record.rebased) and only then are the page's old events
// erased, so a stop between the two repeats the page and never leaves an erased event without its row state; the loop is given back between pages. The host then scrubs the Space log, the kept answers and the search
// index once for the whole set. A field that is back in the type (restored, or added again under the same key) is not cleaned: its values are live; only the old Trash entry goes.
import { isErased } from "../../../kernel/src/events/compact.ts";
import { isSealedRef } from "../../../kernel/src/store/values.ts";
import { turns } from "../../../lib/yield-loop.ts";
import { nowOf, allDefs } from "../projections.ts";
import type { SchemaDeps } from "../projections.ts";
import { schemaVault } from "./seal.ts";

interface TrashRow {
  id: number;
  type: string;
  field: string | null;
  payload: string;
}

const plain = (v: unknown): boolean => v !== undefined && v !== null && !isSealedRef(v);
const PAGE = 500;

/** Does this old event hold a plaintext of one of the fields? Created and updated events carry the whole row (`data`) and what it was (`before`). */
function holdsAny(payload: Record<string, unknown>, type: string, fields: ReadonlySet<string>): boolean {
  if (payload["type"] !== type) return false;
  for (const k of ["data", "before"] as const) {
    const part = payload[k];
    if (part && typeof part === "object")
      for (const f of fields) if (plain((part as Record<string, unknown>)[f])) return true;
  }
  return false;
}

/** Fold the journal in, and vacuum the file when it is small: never a VACUUM of a big live file (it holds the one writer). Freed pages are zeroed by secure_delete either way. */
function scrubFile(db: { exec(sql: string): unknown; prepare(sql: string): { get(): unknown } }): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const pages = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
  const size = pages * Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
  if (size <= 256 * 1024 * 1024) {
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}

/** Take the plaintext of `fields` out of every copy the store kept, in one pass. Safe to run twice; what is gone stays gone. `still(f)` says whether a field is still to be cleaned (it may have come back). */
export async function cleanFields(
  deps: SchemaDeps,
  type: string,
  fields: readonly string[],
  still: () => Promise<ReadonlySet<string>> = async () => new Set(fields),
): Promise<{ events: number }> {
  const host = deps.host;
  const { tx } = deps;
  const turn = turns(15);
  const erasedSeqs: number[] = [];
  let live = await still();
  if (live.size === 0) return { events: 0 };
  host?.store.db.exec("PRAGMA secure_delete = ON");
  const rebased = new Set<string>();
  if (host) {
    const dec = new TextDecoder();
    for (let after = 0; ; ) {
      const page = host.store.read({ after, limit: PAGE, entity: type });
      if (page.length === 0) break;
      const found: Array<{ seq: number; id: string | null }> = [];
      for (const e of page) {
        if ((e.type !== "record.created" && e.type !== "record.updated") || isErased(e)) continue;
        let p: Record<string, unknown>;
        try {
          p = JSON.parse(dec.decode(e.payload)) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (holdsAny(p, type, live)) found.push({ seq: e.seq, id: typeof p["id"] === "string" ? p["id"] : null });
      }
      // the rows of this page are written again BEFORE their old events go: a stop in between leaves the old events, and the page is read again
      for (const f of found) {
        if (f.id === null || rebased.has(f.id)) continue;
        rebased.add(f.id);
        // a dropped type has no table: its rows are not written again (there is no row to rebuild)
        let row:
          | { version: number; created_at: number; updated_at: number; deleted_at: number | null; data: string }
          | undefined;
        try {
          row = tx.get<{
            version: number;
            created_at: number;
            updated_at: number;
            deleted_at: number | null;
            data: string;
          }>(`SELECT version, created_at, updated_at, deleted_at, data FROM rt_${type} WHERE id = ?`, f.id);
        } catch (e) {
          if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) throw e; // any other failure stops the page before its events are erased
          row = undefined;
        }
        if (!row) continue;
        host.append({
          type: "record.rebased",
          sv: 1,
          trace_id: "5ea1".repeat(8),
          actor: "svc_records",
          vis: "space",
          entity: type,
          entity_id: f.id,
          payload: {
            type,
            id: f.id,
            data: JSON.parse(row.data),
            version: row.version,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
          },
        });
        await turn();
      }
      // a field that came back while the pass ran is no longer cleaned (the pages already done kept their rows as they are)
      live = await still();
      if (live.size === 0) break;
      for (const f of found) {
        host.store.erase(f.seq);
        erasedSeqs.push(f.seq);
      }
      after = page[page.length - 1]!.seq;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (page.length < PAGE) break;
    }
  }
  const names = [...live];
  if (names.length > 0) {
    // the sync change feed copied the fields of those events (its rows stay, so a device's cursor still lands)
    if (erasedSeqs.length) {
      try {
        for (let i = 0; i < erasedSeqs.length; i += 400) {
          const part = erasedSeqs.slice(i, i + 400);
          tx.run(`UPDATE sync_changes SET fields = '{}' WHERE seq IN (${part.map(() => "?").join(",")})`, ...part);
          await turn();
        }
      } catch {
        /* sync is not on this store */
      }
    }
    // the change feed keeps what a row was before and after each change
    const paths = names.map((f) => `$.${f}`);
    const marks = paths.map(() => "?").join(", ");
    tx.run(
      `UPDATE rs_changes SET before = CASE WHEN before IS NULL THEN NULL ELSE json_remove(before, ${marks}) END, after = CASE WHEN after IS NULL THEN NULL ELSE json_remove(after, ${marks}) END WHERE type = ?`,
      ...paths,
      ...paths,
      type,
    );
    try {
      tx.run(
        `DELETE FROM records_field_history WHERE type = ? AND field IN (${names.map(() => "?").join(",")})`,
        type,
        ...names,
      );
    } catch {
      /* the records tables are not on this store */
    }
    // the copies only the host reaches, once for the whole set
    const v = schemaVault() as {
      scrubField?(t: string, f: string): Promise<void>;
      scrubFields?(t: string, f: readonly string[]): Promise<void>;
    } | null;
    if (v?.scrubFields) await v.scrubFields(type, names);
    else for (const f of names) await v?.scrubField?.(type, f);
  }
  if (host) scrubFile(host.store.db);
  return { events: erasedSeqs.length };
}

/** The fields of an entry that are still to be cleaned now: none when the field is back in the type (or the type was made again), or another entry of it is still inside its window, or this entry was restored. */
async function stillToClean(deps: SchemaDeps, row: TrashRow, now: number): Promise<Set<string>> {
  const { tx } = deps;
  const own = tx.get<{ restored_at: number | null }>("SELECT restored_at FROM sc_trash WHERE id = ?", row.id);
  if (!own || own.restored_at !== null) return new Set();
  const current = (await allDefs(deps)).get(row.type);
  if (row.field !== null) {
    const back = current?.fields.some((f) => f.key === row.field) ?? false;
    const other =
      (tx.get<{ n: number }>(
        "SELECT count(*) AS n FROM sc_trash WHERE type = ? AND field = ? AND id <> ? AND restored_at IS NULL AND expires_at > ?",
        row.type,
        row.field,
        row.id,
        now,
      )?.n ?? 0) > 0;
    return back || other ? new Set() : new Set([row.field]);
  }
  // a dropped type: every field it had, unless a type of that name exists again
  if (current) return new Set();
  const out = new Set<string>();
  try {
    const p = JSON.parse(row.payload) as { def?: { fields?: Array<{ key?: unknown }> } };
    for (const f of p.def?.fields ?? []) if (typeof f.key === "string") out.add(f.key);
  } catch {
    /* a payload that does not parse names no field */
  }
  return out;
}

/** Purge one expired Trash entry. Answers how many were purged (0 or 1); call again until 0. */
export async function purgeExpiredTrash(deps: SchemaDeps): Promise<number> {
  const { tx } = deps;
  const now = nowOf(deps);
  const row = tx.get<TrashRow>(
    "SELECT id, type, field, payload FROM sc_trash WHERE restored_at IS NULL AND expires_at <= ? ORDER BY id LIMIT 1",
    now,
  );
  if (!row) return 0;
  const first = await stillToClean(deps, row, now);
  if (first.size > 0) {
    let current = first;
    await cleanFields(deps, row.type, [...first], async () => {
      current = await stillToClean(deps, row, now);
      return current;
    });
  }
  // by id only, and only while the entry is still ours: a newer drop of the same field is another entry, a restore leaves its mark
  tx.run("DELETE FROM sc_trash WHERE id = ? AND restored_at IS NULL", row.id);
  // the Trash entry held the values too: its freed pages are folded in (and vacuumed when the file is small)
  if (deps.host) scrubFile(deps.host.store.db);
  return 1;
}

/** Expired entries one after the other until the time budget is spent; the next tick takes the rest. */
export async function purgeAllExpired(deps: SchemaDeps, budgetMs = 2_000): Promise<number> {
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < budgetMs) {
    if ((await purgeExpiredTrash(deps)) === 0) break;
    n++;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return n;
}
