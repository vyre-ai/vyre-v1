// The actions of stored connectors, as rows of the step palette. A draft is listed so a person can see it and test it. It cannot be turned on until a read proves it.
import { actionStepKey } from "./connector-def.ts";
import type { ActionDef, Param } from "./connector-def.ts";
import { isAuthor, publishedPart } from "./connector-audience.ts";
import { levelOfAction, listConnectors } from "./connector-store.ts";
import type { AutoCtx } from "./projections.ts";

function schemaOf(params: readonly Param[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of params) properties[p.name] = { type: p.type, ...(p.description ? { description: p.description } : {}) };
  const required = params.filter((p) => p.required).map((p) => p.name);
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export function connectorSteps(ctx: AutoCtx): Record<string, unknown>[] {
  const db = ctx.db;
  const rows: Record<string, unknown>[] = [];
  for (const row of listConnectors(db)) {
    const shown = isAuthor(ctx, row) ? row.def : publishedPart(db, row.def);
    if (!shown) continue;
    for (const a of shown.actions as ActionDef[]) {
      rows.push({
        key: actionStepKey(row.def.app, a.key),
        title: `${row.def.title}: ${a.title}`,
        category: a.effect === "read" ? "data" : "send",
        kind: "capability",
        input: schemaOf(a.params),
        output: { type: "object", description: "The reply of the app" },
        effects: a.effect === "read" ? "read" : "outward",
        ...(a.effect === "outward" ? { gateAct: "send" } : {}),
        app: shown.title,
        level: levelOfAction(db, shown.app, a.key),
      });
    }
  }
  return rows;
}
