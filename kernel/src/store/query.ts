// Filter, sort, keyset paging and aggregation over plain rows (reused from 0.6 kernel/store/query.js). Shared by the RecordStore and by the gateway, which aggregates only rows it has authorized
// because a store is never trusted to hide rows.
import { canonical } from "../../../lib/canonical.ts";
import type { AggregateRow, AggregateSpec, Filter, QuerySpec, Sort } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
const eq = (a: any, b: any): boolean => a === b || (typeof a === "object" && a !== null && canonical(a) === canonical(b));
const cmp = (a: any, b: any): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Read a (possibly dotted) field from a stored record: `id`, `version`, `created_at`, `updated_at`, `type` or a data field. */
export function fieldOf(r: Row, f: string): any {
  if (f === "id" || f === "version" || f === "created_at" || f === "updated_at" || f === "type") return r[f];
  const [head, ...rest] = f.split(".");
  let v = r.data[head as string];
  for (const k of rest) v = v && typeof v === "object" ? v[k] : undefined;
  return v === undefined ? null : v;
}

export function matches(f: Filter | undefined, r: Row): boolean {
  if (!f) return true;
  const x = f as any;
  if (x.and) return x.and.every((y: Filter) => matches(y, r));
  if (x.or) return x.or.some((y: Filter) => matches(y, r));
  if (x.not) return !matches(x.not, r);
  const v = fieldOf(r, x.field);
  switch (x.op) {
    case "eq": return eq(v, x.value ?? null);
    case "ne": return !eq(v, x.value ?? null);
    case "lt": return v !== null && cmp(v, x.value) < 0;
    case "lte": return v !== null && cmp(v, x.value) <= 0;
    case "gt": return v !== null && cmp(v, x.value) > 0;
    case "gte": return v !== null && cmp(v, x.value) >= 0;
    case "in": return Array.isArray(x.value) && x.value.some((y: any) => eq(v, y));
    case "contains": return Array.isArray(v) ? v.some((y) => eq(y, x.value)) : typeof v === "string" && typeof x.value === "string" && v.toLowerCase().includes(x.value.toLowerCase());
    case "is_null": return v === null || v === undefined;
    default: return false;
  }
}

const keyOf = (r: Row, sort: readonly Sort[] | undefined): unknown[] => [...(sort ?? []).map((k) => fieldOf(r, k.field)), r.id];
export const encodeCursor = (r: Row, sort: readonly Sort[] | undefined): string => Buffer.from(JSON.stringify(keyOf(r, sort))).toString("base64url");
const decodeCursor = (c: string): unknown => { try { return JSON.parse(Buffer.from(c, "base64url").toString("utf8")); } catch { return null; } };

/**
 * Keyset page: rows strictly after the cursor's position in the total order (the sort, then id). Inserts and removals between pages never repeat or skip a row. It keeps only the page it is
 * building, found by insertion into a small sorted list, so a type of any size is paged in constant memory. Returns `{ error }` for a cursor that is not one of ours.
 */
export function page(all: Iterable<Row>, spec: QuerySpec): { rows: Row[]; next_cursor?: string } | { error: string } {
  const sort = spec.sort;
  const keys: Sort[] = [...(sort ?? []), { field: "id", dir: "asc" }];
  let key: any[] | null = null;
  if (spec.page.cursor) {
    const k = decodeCursor(spec.page.cursor);
    if (!Array.isArray(k) || k.length !== keys.length) return { error: "invalid cursor" };
    key = k;
  }
  const order = (a: Row, b: Row): number => { for (const k of keys) { const c = cmp(fieldOf(a, k.field), fieldOf(b, k.field)); if (c) return k.dir === "desc" ? -c : c; } return 0; };
  const after = (r: Row): boolean => {
    if (!key) return true;
    const rk = keyOf(r, sort);
    for (let i = 0; i < keys.length; i++) { const c = cmp(rk[i], key[i]); if (c) return keys[i]!.dir === "desc" ? c < 0 : c > 0; }
    return false;
  };
  const limit = Math.max(1, Math.min(spec.page.limit, 500));
  const best: Row[] = [];
  let counted = 0;
  for (const r of all) {
    if (!matches(spec.filter, r) || !after(r)) continue;
    counted++;
    if (best.length === limit && order(r, best[limit - 1]) >= 0) continue;
    let lo = 0, hi = best.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (order(best[mid], r) <= 0) lo = mid + 1; else hi = mid; }
    best.splice(lo, 0, r);
    if (best.length > limit) best.pop();
  }
  return { rows: best, ...(counted > limit && best.length ? { next_cursor: encodeCursor(best[best.length - 1], sort) } : {}) };
}

interface Acc { n: number; sum: number; min: number; max: number; nonnull: number }

/** Group and measure one row at a time; memory is the number of groups, never the number of rows. `avg` and `sum` skip nulls; an empty measure is null. */
export function aggregate(all: Iterable<Row>, spec: AggregateSpec, o: { maxGroups?: number } = {}): AggregateRow[] {
  const measures = spec.measures;
  const groups = new Map<string, { group: Record<string, unknown>; n: number; acc: Acc[] }>();
  const fresh = (): Acc[] => measures.map(() => ({ n: 0, sum: 0, min: Infinity, max: -Infinity, nonnull: 0 }));
  for (const r of all) {
    if (!matches(spec.filter, r)) continue;
    const g = Object.fromEntries((spec.group_by ?? []).map((f) => [f, fieldOf(r, f)]));
    const k = canonical(g);
    let grp = groups.get(k);
    if (!grp) {
      if (o.maxGroups && groups.size >= o.maxGroups) throw Object.assign(new Error(`more than ${o.maxGroups} groups; group by something coarser`), { code: "unsupported" });
      grp = { group: g, n: 0, acc: fresh() }; groups.set(k, grp);
    }
    grp.n++;
    measures.forEach((m, i) => {
      if (!m.field) return;
      const v = fieldOf(r, m.field), a = grp!.acc[i]!;
      if (v !== null) a.nonnull++;
      if (typeof v === "number") { a.n++; a.sum += v; if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
    });
  }
  if (!groups.size && !(spec.group_by ?? []).length) groups.set("{}", { group: {}, n: 0, acc: fresh() });
  return [...groups.values()].sort((a, b) => (canonical(a.group) < canonical(b.group) ? -1 : 1)).map(({ group, n, acc }) => ({
    group,
    values: Object.fromEntries(measures.map((m, i) => {
      const name = m.field ? `${m.fn}:${m.field}` : m.fn, a = acc[i]!;
      if (m.fn === "count") return [name, m.field ? a.nonnull : n];
      if (!a.n) return [name, null];
      return [name, m.fn === "sum" ? a.sum : m.fn === "min" ? a.min : m.fn === "max" ? a.max : a.sum / a.n];
    })) as Record<string, number | null>,
  }));
}
