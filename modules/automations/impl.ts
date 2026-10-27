// Automations module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `consumeEvent` is the trigger consumer the host runs for every event; `loadRunPlan` is what the executor reads for a Run of an Automation.
import { handlers } from "./handlers/index.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { chooseScheduleRecovery, runDueSchedules, SCHEDULE_EVERY_MS } from "./schedule/live.ts";
import type { ChoiceLimits, ScheduleChoiceKey } from "./schedule/schedule.ts";

export { handlers };
export { accessDiff, canView, structuralIssues, validateDefinition, webhookSecretMatches } from "./handlers/defs.ts";
import { loadRunPlan, startRun } from "./handlers/triggers.ts";
export { consumeEvent, dropReason, fireOne, loadRunPlan, matches, startRun, triggerPayload } from "./handlers/triggers.ts";
import { findAutomation, findRunLink, listChildLinks, listScopedChildren, saveRunLink } from "./projections.ts";
import type { AutoCtx, RunScope } from "./projections.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it. The host runs them with this module's ctx, so no other module reads these tables.
 * `owned_by` answers { <kind>: { count, sample } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type Row = Record<string, unknown>;
const rows = (ctx: Ctx, sql: string, ...a: unknown[]): Row[] => { try { return ctx.db.all(sql, ...a) as Row[]; } catch { return []; } };
const kept = (r: Row[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const periodic = {
  "automations.schedule_tick": { everyMs: SCHEDULE_EVERY_MS, run: (ctx: Ctx) => runDueSchedules(ctx as AutoCtx) },
};
export const hostCalls = {
  /** What the executor needs for a Run of an Automation (P-L6_24): the pinned definition, what started it, who it acts as, the vault names it may use. Nothing when the Run is not an Automation's. */
  "automations.run_plan": (ctx: Ctx, i: { runId: string }) => {
    const p = loadRunPlan(ctx, i.runId);
    return p ? { link: p.link, definition: p.definition, vault: p.vault } : null;
  },
  /** One lane or one loop iteration. Pins the parent's definition version. The same key returns the same Run. */
  "automations.spawn_child": async (ctx: Ctx, i: { parentRunId: string; key: string; scope: RunScope; hold?: boolean }) => {
    const parent = loadRunPlan(ctx, i.parentRunId);
    if (!parent) return null;
    const a = findAutomation(ctx.db, parent.link.automationId);
    if (!a) return null;
    const runId = await startRun(ctx as unknown as AutoCtx, a, {
      trigger: parent.link.trigger, payload: parent.link.payload, test: parent.link.test, depth: parent.link.depth,
      origin: parent.link.origin, eventId: parent.link.eventId, version: parent.link.version, parentRun: parent.link.runId,
      key: i.key, principal: parent.link.principal, scope: i.scope, hold: i.hold === true,
    });
    return { runId };
  },
  "automations.child_links": (ctx: Ctx, i: { parentRunId: string; containerNodeId?: string }) => {
    const links = listChildLinks(ctx.db, i.parentRunId).filter((l) => !i.containerNodeId || l.scope?.containerNodeId === i.containerNodeId);
    return links.map((l) => ({ runId: l.runId, parentRun: l.parentRun ?? null, scope: l.scope ?? null }));
  },
  "automations.child_index": (ctx: Ctx) =>
    listScopedChildren(ctx.db).map((l) => ({ runId: l.runId, parentRun: l.parentRun ?? null, scope: l.scope ?? null })),
  "automations.patch_scope": (ctx: Ctx, i: { runId: string; scope: RunScope }) => {
    const link = findRunLink(ctx.db, i.runId);
    if (!link) return { ok: false };
    saveRunLink(ctx.db, { ...link, scope: i.scope });
    return { ok: true };
  },
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
      return 0;
    } catch { /* no table yet: nothing to move */ }
    return 0;
  },
  /** Apply one schedule recovery choice. The Needs You request points here. */
  "automations.schedule_choose": (ctx: Ctx, i: { automationId: string; choice: ScheduleChoiceKey; n?: number; limits?: ChoiceLimits }) =>
    chooseScheduleRecovery(ctx as AutoCtx, i),
};
