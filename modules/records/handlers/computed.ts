// Computed fields on the write side (spec 3.4): the values of formula, lookup and rollup fields are kept in records_computed, maintained from the events (a change to a record recomputes its own values, and what reads
// it), and filled for a whole type by a backfill when a computed field is added or its definition changes. Nothing is stored in the record's data. The hook consumer `records.computed` (impl.ts) calls this on the
// existing pump: no timer. Every pass of work stops after about 15 ms and gives the loop back; progress is a row in records_computed_job, so a restart goes on where it was.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import { canonical } from "../../../lib/canonical.ts";
import { computeFormula, inputsOf } from "../../../lib/computed-fields.ts";
import type { FieldShape, TypeShape } from "../../../lib/computed-fields.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { refIds } from "./review.ts";

/** The computed fields of one record type, as the schema module defines them. */
export interface ComputedDef {
  key: string;
  type: "formula" | "lookup" | "rollup";
  options: Record<string, unknown>;
}

export interface ComputedEnv {
  tx: Tx;
  store: Store;
  now(): number;
  /** the computed fields of a type (empty when it has none or is not known) */
  defsOf(type: string): Promise<ComputedDef[]>;
  /** the type shapes the inputs of a lookup or rollup are named from */
  shapes(): Promise<ReadonlyMap<string, TypeShape>>;
}

/** After this much work in one pass the loop is given back. */
export const SLICE_MS = 15;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

let ready = new WeakSet<object>();
export function ensureComputedTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(`CREATE TABLE IF NOT EXISTS records_computed (
    type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, computed_at INTEGER NOT NULL,
    inputs TEXT NOT NULL, links INTEGER, kind TEXT NOT NULL DEFAULT 'formula', PRIMARY KEY (type, id, field))`);
  tx.exec("CREATE INDEX IF NOT EXISTS records_computed_field ON records_computed (type, field, id)");
  tx.exec(`CREATE TABLE IF NOT EXISTS records_computed_job (
    type TEXT NOT NULL, field TEXT NOT NULL, def_hash TEXT NOT NULL, cursor TEXT, done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, PRIMARY KEY (type, field))`);
  ready.add(tx);
}
export const resetComputedTablesForTest = (): void => {
  ready = new WeakSet();
};

export const hashOf = (d: ComputedDef): string => sha256Hex(canonical({ t: d.type, o: d.options })).slice(0, 16);

/** The definitions in the order they can be computed: a field after the computed fields of its own type that it reads. */
export function inOrder(
  type: string,
  defs: readonly ComputedDef[],
  shapes: ReadonlyMap<string, TypeShape>,
): ComputedDef[] {
  const by = new Map(defs.map((d) => [d.key, d]));
  const out: ComputedDef[] = [];
  const seen = new Set<string>();
  const visit = (d: ComputedDef): void => {
    if (seen.has(d.key)) return;
    seen.add(d.key);
    const shape: FieldShape = { key: d.key, type: d.type, options: d.options };
    for (const dep of inputsOf(shapes, type, shape)) {
      const [t, f] = dep.split(".") as [string, string];
      const next = t === type ? by.get(f) : undefined;
      if (next) visit(next);
    }
    out.push(d);
  };
  for (const d of defs) visit(d);
  return out;
}

const write = (
  env: ComputedEnv,
  type: string,
  id: string,
  field: string,
  value: unknown,
  inputs: string[],
  links: number | null,
  kind: string,
): void => {
  env.tx.run(
    `INSERT INTO records_computed (type, id, field, value, computed_at, inputs, links, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (type, id, field) DO UPDATE SET value = excluded.value, computed_at = excluded.computed_at, inputs = excluded.inputs, links = excluded.links, kind = excluded.kind`,
    type,
    id,
    field,
    value === null || value === undefined ? null : canonical(value),
    env.now(),
    JSON.stringify(inputs),
    links,
    kind,
  );
};

/** Links read through one relation for one value: a relation may hold up to MAX_LINKS (20,000); they are read in chunks of this many, with the loop given back between chunks. */
const CHUNK = 500;
let sliceStart = 0;
/** True while a backfill slice holds its savepoint: the loop is not given back inside one (a write by someone else would land in it); the backfill yields between slices itself. */
let inSavepoint = false;
/** Give the loop back when this pass has worked for SLICE_MS. */
async function tick(): Promise<void> {
  if (inSavepoint || performance.now() - sliceStart < SLICE_MS) return;
  await yieldLoop();
  sliceStart = performance.now();
}

const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One field of a linked record: its own value, or its computed value when the field is itself computed on that type. */
function fieldOf(
  env: ComputedEnv,
  targetDefs: readonly ComputedDef[],
  type: string,
  row: { id: string; data: Record<string, unknown> },
  field: string,
): unknown {
  if (targetDefs.some((d) => d.key === field)) {
    const r = env.tx.get<{ value: string | null }>(
      "SELECT value FROM records_computed WHERE type = ? AND id = ? AND field = ?",
      type,
      row.id,
      field,
    );
    return r?.value == null ? null : JSON.parse(r.value);
  }
  return row.data[field] ?? null;
}

/** The linked records of a relation value, read in chunks (a record in Trash is not a link that counts). */
async function* linked(
  env: ComputedEnv,
  target: string,
  ids: readonly string[],
): AsyncGenerator<{ id: string; data: Record<string, unknown> }> {
  for (let at = 0; at < ids.length; at += CHUNK) {
    const part = ids.slice(at, at + CHUNK);
    const rows = env.tx.all<{ id: string; data: string }>(
      `SELECT id, data FROM rt_${target} WHERE deleted_at IS NULL AND id IN (${part.map(() => "?").join(",")})`,
      ...part,
    );
    for (const r of rows) yield { id: r.id, data: JSON.parse(r.data) as Record<string, unknown> };
    await tick();
  }
}

/**
 * Recompute every computed value of one record, in the order they can be computed (a formula after the lookup it reads). A record that is gone, or in Trash, has none. Answers the fields whose value changed, so
 * the caller can recompute what reads this record.
 */
export async function recomputeRecord(
  env: ComputedEnv,
  type: string,
  id: string,
  rec?: StoredRecord | null,
): Promise<string[]> {
  ensureComputedTables(env.tx);
  const defs = await env.defsOf(type);
  const was = new Map(
    env.tx
      .all<{
        field: string;
        value: string | null;
      }>("SELECT field, value FROM records_computed WHERE type = ? AND id = ?", type, id)
      .map((r) => [r.field, r.value]),
  );
  const row = rec === undefined ? await env.store.get(type, id, { include_deleted: true }) : rec;
  if (!defs.length || !row || row.deleted_at !== undefined) {
    env.tx.run("DELETE FROM records_computed WHERE type = ? AND id = ?", type, id);
    return [...was.keys()];
  }
  const shapes = await env.shapes();
  const values: Record<string, unknown> = { ...row.data };
  const changed: string[] = [];
  for (const d of inOrder(type, defs, shapes)) {
    const inputs = inputsOf(shapes, type, { key: d.key, type: d.type, options: d.options });
    let v: unknown = null;
    let links: number | null = null;
    if (d.type === "formula") v = computeFormula(String(d.options["expr"] ?? ""), values, env.now());
    else {
      const via = shapes.get(type)?.fields.find((x) => x.key === d.options["via"]);
      const target = typeof via?.options?.["target"] === "string" ? (via.options["target"] as string) : null;
      if (target) {
        const ids = refIds(values[String(d.options["via"])]);
        links = ids.length;
        const targetDefs = await env.defsOf(target);
        const field = String(d.options["field"] ?? "");
        const found: unknown[] = [];
        let count = 0;
        for await (const t of linked(env, target, ids)) {
          count++;
          found.push(fieldOf(env, targetDefs, target, t, field));
        }
        if (d.type === "lookup") {
          const many = via?.options?.["many"] === true;
          const some = found.filter((x) => x !== null);
          v = many ? some : (some[0] ?? null);
        } else {
          const nums = found.map(asNumber).filter((x): x is number => x !== null);
          const fn = String(d.options["fn"] ?? "count");
          v =
            fn === "count"
              ? count
              : !nums.length
                ? null
                : fn === "sum"
                  ? nums.reduce((a, b) => a + b, 0)
                  : fn === "min"
                    ? Math.min(...nums)
                    : fn === "max"
                      ? Math.max(...nums)
                      : nums.reduce((a, b) => a + b, 0) / nums.length;
        }
      }
    }
    values[d.key] = v;
    const text = v === null || v === undefined ? null : canonical(v);
    if (was.get(d.key) !== text || !was.has(d.key)) changed.push(d.key);
    write(env, type, id, d.key, v, inputs, links, d.type);
  }
  env.tx.run(
    `DELETE FROM records_computed WHERE type = ? AND id = ? AND field NOT IN (${defs.map(() => "?").join(",")})`,
    type,
    id,
    ...defs.map((d) => d.key),
  );
  return changed;
}

/**
 * The records whose lookups and rollups read this one: the records that link to it through a relation some computed field follows. They are found through the relation's other end, which relation.add always makes
 * (the linking records are listed there), so no table is scanned.
 */
export async function dependentsOf(
  env: ComputedEnv,
  type: string,
  rec: { data: Record<string, unknown> },
): Promise<Array<{ type: string; id: string }>> {
  const shapes = await env.shapes();
  const out: Array<{ type: string; id: string }> = [];
  const seen = new Set<string>();
  for (const [other, shape] of shapes) {
    for (const via of shape.fields) {
      if (via.options?.["target"] !== type || typeof via.options["inverse"] !== "string") continue;
      const reads = (await env.defsOf(other)).some((d) => d.type !== "formula" && d.options["via"] === via.key);
      if (!reads) continue;
      for (const id of refIds(rec.data[via.options["inverse"]])) {
        const key = `${other}/${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ type: other, id });
        }
      }
    }
  }
  return out;
}

/** Recompute a record, then, while values change, the records that read it (breadth first, each record once, depth bounded: a cycle is refused at definition time, this is the second line). */
export async function recomputeWithDependents(env: ComputedEnv, type: string, id: string): Promise<number> {
  let n = 0;
  const queue: Array<{ type: string; id: string; depth: number }> = [{ type, id, depth: 0 }];
  sliceStart = performance.now();
  const done = new Set<string>();
  while (queue.length) {
    const at = queue.shift()!;
    const key = `${at.type}/${at.id}`;
    if (done.has(key) || at.depth > 8) continue;
    done.add(key);
    const changed = await recomputeRecord(env, at.type, at.id);
    n++;
    // a record that changed in any way (its own data, or a value computed on it) is read by its dependents
    if (at.depth === 0 || changed.length) {
      const row = await env.store.get(at.type, at.id, { include_deleted: true });
      if (row) for (const d of await dependentsOf(env, at.type, row)) queue.push({ ...d, depth: at.depth + 1 });
    }
    await tick();
  }
  return n;
}

/**
 * Fill every computed field of a type that has no current values: a field with no job row, or whose definition hash changed, starts again from the first record; one that was stopped goes on from its cursor.
 * Works in passes of at most SLICE_MS and yields between them; the job row is the progress.
 */
export async function backfillType(env: ComputedEnv, type: string): Promise<{ done: number; ran: boolean }> {
  ensureComputedTables(env.tx);
  const defs = await env.defsOf(type);
  const keep = defs.map((d) => d.key);
  env.tx.run(
    `DELETE FROM records_computed WHERE type = ? ${keep.length ? `AND field NOT IN (${keep.map(() => "?").join(",")})` : ""}`,
    type,
    ...keep,
  );
  env.tx.run(
    `DELETE FROM records_computed_job WHERE type = ? ${keep.length ? `AND field NOT IN (${keep.map(() => "?").join(",")})` : ""}`,
    type,
    ...keep,
  );
  let ran = false;
  let doneRows = 0;
  const need = defs.filter((d) => {
    const job = env.tx.get<{ def_hash: string; state: string }>(
      "SELECT def_hash, state FROM records_computed_job WHERE type = ? AND field = ?",
      type,
      d.key,
    );
    return !job || job.def_hash !== hashOf(d) || job.state !== "done";
  });
  if (!need.length) return { done: 0, ran };
  const total = Number(
    env.tx.get<{ c: number }>(`SELECT count(*) AS c FROM rt_${type} WHERE deleted_at IS NULL`)?.c ?? 0,
  );
  // a changed definition starts again; an unchanged unfinished one keeps its cursor
  let cursor: string | undefined;
  for (const d of need) {
    const job = env.tx.get<{ def_hash: string; cursor: string | null }>(
      "SELECT def_hash, cursor FROM records_computed_job WHERE type = ? AND field = ?",
      type,
      d.key,
    );
    if (job && job.def_hash === hashOf(d) && job.cursor) cursor = !cursor || job.cursor < cursor ? job.cursor : cursor;
    else {
      cursor = undefined;
      env.tx.run(
        `INSERT INTO records_computed_job (type, field, def_hash, cursor, done, total, state) VALUES (?, ?, ?, NULL, 0, ?, 'running')
         ON CONFLICT (type, field) DO UPDATE SET def_hash = excluded.def_hash, cursor = NULL, done = 0, total = excluded.total, state = 'running'`,
        type,
        d.key,
        hashOf(d),
        total,
      );
    }
  }
  const progress = (last: string | undefined, count: number, state: "running" | "done"): void => {
    for (const d of need)
      env.tx.run(
        "UPDATE records_computed_job SET cursor = ?, done = ?, state = ? WHERE type = ? AND field = ? AND def_hash = ?",
        last ?? null,
        count,
        state,
        type,
        d.key,
        hashOf(d),
      );
  };
  // the definitions are read once for the whole pass, not once per record
  const defsNow = defs;
  const shapesNow = await env.shapes();
  const pass: ComputedEnv = { ...env, defsOf: async () => defsNow, shapes: async () => shapesNow };
  let last: string | undefined = cursor;
  for (;;) {
    // the type's own table, in order of id: a page of 100 from the cursor (the cursor is a record id, so a restart can go on from it)
    const page = env.tx.all<{ id: string; data: string }>(
      `SELECT id, data FROM rt_${type} WHERE deleted_at IS NULL ${last ? "AND id > ?" : ""} ORDER BY id LIMIT 100`,
      ...(last ? [last] : []),
    );
    if (!page.length) break;
    let at = 0;
    while (at < page.length) {
      // one slice: as many records as fit in SLICE_MS, written in one transaction, then the loop is given back
      const start = performance.now();
      env.tx.exec("SAVEPOINT computed_slice");
      inSavepoint = true;
      try {
        while (at < page.length && performance.now() - start < SLICE_MS) {
          const r = page[at++]!;
          await recomputeRecord(pass, type, r.id, {
            type,
            id: r.id,
            version: 0,
            data: JSON.parse(r.data) as Record<string, never>,
            created_at: 0,
            updated_at: 0,
          });
          last = r.id;
          doneRows++;
        }
        progress(last, doneRows, "running");
        env.tx.exec("RELEASE computed_slice");
      } catch (e) {
        env.tx.exec("ROLLBACK TO computed_slice");
        env.tx.exec("RELEASE computed_slice");
        throw e;
      } finally {
        inSavepoint = false;
      }
      await yieldLoop();
    }
  }
  progress(last, doneRows, "done");
  ran = true;
  return { done: doneRows, ran };
}

/** The computed fields of a type that are being filled now (the app shows them as updating). */
export function updatingFields(tx: Tx, type: string): string[] {
  ensureComputedTables(tx);
  return tx
    .all<{ field: string }>("SELECT field FROM records_computed_job WHERE type = ? AND state <> 'done'", type)
    .map((r) => r.field);
}
