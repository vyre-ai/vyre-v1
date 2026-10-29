// Offer a tested connector to another Space. The reply is the app name and the actions.
// The copy stays draft. A vault id and a key value on the input are ignored.
import { storedLevel } from "../connector-level.ts";
import type { LevelDb } from "../connector-level.ts";
import { listSharedConnectors, shareTested } from "../connector-share.ts";
import type { AutoCtx } from "../projections.ts";

function actionsOf(value: unknown): { key: string; title: string }[] {
  if (!Array.isArray(value)) return [];
  const actions: { key: string; title: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.title !== "string") continue;
    actions.push({ key: row.key, title: row.title });
  }
  return actions;
}

export function shareConnector(ctx: AutoCtx, input: unknown): { appName: string; actions: { key: string; title: string; level: "draft" | "tested" }[] } {
  const row = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const appName = typeof row.appName === "string" ? row.appName : "";
  return shareTested(ctx.db as LevelDb, appName, actionsOf(row.actions), (key) => storedLevel(ctx.db as LevelDb, key) === "tested", ctx.now());
}

export function connectorShares(ctx: AutoCtx): { connectors: { appName: string; actions: { key: string; title: string; level: "draft" | "tested" }[] }[] } {
  return { connectors: listSharedConnectors(ctx.db as LevelDb) };
}
