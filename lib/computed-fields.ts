// Computed fields (formula, lookup, rollup): the pure rules (shared by the schema and records modules, which may not import each other). A computed value is derived from other fields, stored in the records_computed side table (never in the record's own data), and kept by the
// records.computed consumer. This file holds what needs no database: the dependency graph (a definition that would read itself, however far round, is refused when it is made) and the formula evaluation
// (the Expression language of lib/expr: no eval, bounded). The inputs a value reads are named here too, so the read side can hide a value from a person who may not see one of them.
import { evalExpr, exprNames, parseExpr } from "./expr/expr.ts";

export interface FieldShape {
  key: string;
  type: string;
  options?: Record<string, unknown> | undefined;
}
export type TypeShape = { key: string; fields: readonly FieldShape[] };

export const COMPUTED_KINDS: ReadonlySet<string> = new Set(["formula", "lookup", "rollup"]);
export const isComputed = (f: { type: string }): boolean => COMPUTED_KINDS.has(f.type);

const node = (type: string, field: string): string => `${type}.${field}`;

/** The fields one computed field reads: for a formula, the names in its expression (own fields); for a lookup or rollup, the relation field it follows and the field it reads on the other type. */
export function inputsOf(types: ReadonlyMap<string, TypeShape>, type: string, f: FieldShape): string[] {
  const o = f.options ?? {};
  if (f.type === "formula") {
    try {
      return [...exprNames(parseExpr(String(o["expr"] ?? "")))].map((n) => node(type, String(n)));
    } catch {
      return [];
    }
  }
  if (f.type === "lookup" || f.type === "rollup") {
    const via = types.get(type)?.fields.find((x) => x.key === o["via"]);
    const target = typeof via?.options?.["target"] === "string" ? (via.options["target"] as string) : null;
    return [node(type, String(o["via"] ?? "")), ...(target ? [node(target, String(o["field"] ?? ""))] : [])];
  }
  return [];
}

/**
 * The first cycle among computed fields, as the chain of `type.field` names that closes it, or null. A formula that reads itself, two formulas that read each other, a lookup of a rollup of a lookup on a
 * second type that comes back to the first: all are refused at definition time, so the consumer never loops.
 */
export function computedCycle(types: ReadonlyMap<string, TypeShape>): string[] | null {
  const edges = new Map<string, string[]>();
  for (const [type, t] of types)
    for (const f of t.fields) if (isComputed(f)) edges.set(node(type, f.key), inputsOf(types, type, f));
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();
  const visit = (n: string): string[] | null => {
    if (onPath.has(n)) return [...path.slice(path.indexOf(n)), n];
    if (done.has(n)) return null;
    onPath.add(n);
    path.push(n);
    for (const next of edges.get(n) ?? []) {
      const c = visit(next);
      if (c) return c;
    }
    path.pop();
    onPath.delete(n);
    done.add(n);
    return null;
  };
  for (const n of edges.keys()) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

const parsed = new Map<string, ReturnType<typeof parseExpr>>();
/** Evaluate a formula over one record's values. A formula that fails, divides by zero or gives a number that is not one is empty (null), never an error that names an input. */
export function computeFormula(expr: string, values: Record<string, unknown>, now: number): unknown {
  try {
    let ast = parsed.get(expr);
    if (!ast) {
      ast = parseExpr(expr);
      if (parsed.size > 500) parsed.clear();
      parsed.set(expr, ast);
    }
    const v = evalExpr(ast, { values, now });
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}
