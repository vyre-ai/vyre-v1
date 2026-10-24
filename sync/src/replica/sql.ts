// Shared SQL helpers for the replica drivers.
import { ReplicaError } from "./types.ts";
import type { SqlRow, SqlValue } from "./types.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new ReplicaError("bad_name", `unsafe sql name ${name}`);
  return `"${name}"`;
}

export function asValue(v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

export function asRow(v: unknown): SqlRow | undefined {
  if (v === null || v === undefined || typeof v !== "object") return undefined;
  const out: SqlRow = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = asValue(val);
  return out;
}

export function bind(params: readonly SqlValue[]): SqlValue[] {
  return params.slice();
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isDuplicateColumn(e: unknown): boolean {
  return /duplicate column/i.test(errorText(e));
}

/** True when the script can invalidate prepared statements (a table was created, altered or dropped). */
export function schemaChanged(sql: string): boolean {
  return /\b(DROP\s+TABLE|CREATE\s+(VIRTUAL\s+)?TABLE|ALTER\s+TABLE)\b/i.test(sql);
}
