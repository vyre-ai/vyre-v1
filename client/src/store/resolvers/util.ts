import type { LocalDb, SqlRow, SqlValue } from "../space.ts";

export const rows = (db: LocalDb, sql: string, params: readonly SqlValue[] = []): SqlRow[] => db.all(sql, params);

export const str = (v: SqlValue | undefined): string => (v === null || v === undefined ? "" : String(v));
export const num = (v: SqlValue | undefined): number => (v === null || v === undefined ? 0 : Number(v));
export const flag = (v: SqlValue | undefined): boolean => v === 1 || v === "1" || (typeof v === "bigint" && v === 1n);
export const optStr = (v: SqlValue | undefined): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));
export const optNum = (v: SqlValue | undefined): number | undefined => (v === null || v === undefined ? undefined : Number(v));

export function json<T>(v: SqlValue | undefined, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

/** Set a key only when the value exists, so the output has no `undefined` members (an optional field is absent, not null). */
export function put<T extends object, K extends string, V>(o: T, key: K, v: V | undefined): void {
  if (v !== undefined) (o as Record<string, unknown>)[key] = v;
}

/** Who a stored id is: the contract prefixes say it. */
export function principalRef(id: string): { kind: "person" | "agent" | "actor" | "service"; id: string } {
  const p = id.slice(0, 4);
  return { kind: p === "agt_" ? "agent" : p === "act_" ? "actor" : p === "svc_" ? "service" : "person", id };
}

/** A page by offset cursor: the cursor is the offset as text, `next` is absent on the last page. */
export function page(cursor: string | undefined, limit: number | undefined, def = 50): { offset: number; limit: number } {
  const offset = cursor !== undefined && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  return { offset, limit: Math.min(Math.max(limit ?? def, 1), 500) };
}
