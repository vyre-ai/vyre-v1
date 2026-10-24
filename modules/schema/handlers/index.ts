// The schema module's handlers: the read side (describe.ts) and the write side (apply.ts) behind one object keyed by capability name.
import { createApplyHandlers } from "./apply.ts";
import type { ApplyHandlers } from "./apply.ts";
import { createDescribeHandlers } from "./describe.ts";
import type { DescribeHandlers } from "./describe.ts";
import type { SchemaDeps } from "../projections.ts";

export type SchemaHandlers = DescribeHandlers & ApplyHandlers;

export function createSchemaHandlers(deps: SchemaDeps): SchemaHandlers {
  return { ...createDescribeHandlers(deps), ...createApplyHandlers(deps) };
}

export { applyOps, planOps, convertValue, parseCsv, inferFields } from "./apply.ts";
export type { SchemaOp, DiffItem, DiffProblem } from "./apply.ts";
export type { TypeDetail, ViewRow, LayoutSection, GapRule } from "./describe.ts";
