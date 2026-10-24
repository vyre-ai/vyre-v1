// Row-filter expressions: evaluated in JS for one record (authorize) and compiled to SQL for lists (scopeFor). Both follow SQL null rules so the two agree:
// a comparison against a missing or null field is false, except eq / ne against null, which mean IS NULL / IS NOT NULL.
import type { Expr } from "./types.ts";

type Cmp = Extract<Expr, { field: string; value: unknown }>;

const cmp = (e: Cmp, got: unknown): boolean => {
  const v = got === undefined ? null : got;
  if (e.value === null) return e.op === "eq" ? v === null : e.op === "ne" ? v !== null : false;
  if (v === null) return false;
  switch (e.op) {
    case "eq": return v === e.value;
    case "ne": return v !== e.value;
    case "lt": return (v as number) < (e.value as number);
    case "lte": return (v as number) <= (e.value as number);
    case "gt": return (v as number) > (e.value as number);
    case "gte": return (v as number) >= (e.value as number);
  }
};

/** @param ownerId the owner of the record (for owner_me); @param me the subject being evaluated */
export function evalExpr(e: Expr, row: Readonly<Record<string, unknown>>, ownerId: string | null, me: string): boolean {
  switch (e.op) {
    case "owner_me": return ownerId !== null && ownerId === me;
    case "in": { const v = row[e.field]; return v !== undefined && v !== null && e.values.includes(v as string | number); }
    case "and": for (const a of e.args) if (!evalExpr(a, row, ownerId, me)) return false; return true;
    case "or": for (const a of e.args) if (evalExpr(a, row, ownerId, me)) return true; return false;
    default: return cmp(e, row[e.field]);
  }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const safeIdent = (s: string): string => { if (!IDENT.test(s)) throw new Error(`unsafe column name: ${s}`); return s; };

export function validateExpr(e: Expr): void {
  if (e.op === "and" || e.op === "or") { for (const a of e.args) validateExpr(a); return; }
  if (e.op !== "owner_me") safeIdent(e.field);
}
