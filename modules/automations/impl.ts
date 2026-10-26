// Automations module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `consumeEvent` is the trigger consumer the host runs for every event; `loadRunPlan` is what the executor reads for a Run of an Automation.
import { handlers } from "./handlers/index.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export { handlers };
export { accessDiff, canView, structuralIssues, validateDefinition, webhookSecretMatches } from "./handlers/defs.ts";
export { consumeEvent, dropReason, fireOne, loadRunPlan, matches, startRun, triggerPayload } from "./handlers/triggers.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it. The host runs them with this module's ctx, so no other module reads these tables.
 * `owned_by` answers { <kind>: { count, sample } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type Row = Record<string, unknown>;
const rows = (ctx: Ctx, sql: string, ...a: unknown[]): Row[] => { try { return ctx.db.all(sql, ...a) as Row[]; } catch { return []; } };
const kept = (r: Row[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const hostCalls = {
  "automations.owned_by": (ctx: Ctx, i: { person: string }) => ({
    automations: kept(rows(ctx, `SELECT "id", "name" FROM automations_defs WHERE "owner_id" = ? AND "deleted_at" IS NULL`, i.person), "automation", "name"),
  }),
  "automations.reassign_owned": (ctx: Ctx, i: { person: string; kind: string; action: string; to?: string }): number => {
    if (i.kind !== "automations") return 0;
    const now = ctx.now();
    try {
      if (i.action === "reassign" && i.to) return ctx.db.run(`UPDATE automations_defs SET "owner_id" = ?, "updated_at" = ? WHERE "owner_id" = ? AND "deleted_at" IS NULL`, i.to, now, i.person).changes;
      if (i.action === "pause") return ctx.db.run(`UPDATE automations_defs SET "status" = 'paused', "paused_reason" = ?, "updated_at" = ? WHERE "owner_id" = ? AND "deleted_at" IS NULL AND "status" <> 'paused'`, "The owner was removed", now, i.person).changes;
      if (i.action === "delete") return ctx.db.run(`UPDATE automations_defs SET "deleted_at" = ?, "updated_at" = ? WHERE "owner_id" = ? AND "deleted_at" IS NULL`, now, now, i.person).changes;
    } catch { /* no table yet: nothing to move */ }
    return 0;
  },
};
