// Automations module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `consumeEvent` is the trigger consumer the host runs for every event; `loadRunPlan` is what the executor reads for a Run of an Automation.
import { setDocumentNetwork } from "./document-network.ts";
import { handlers } from "./handlers/index.ts";
import { setHttpStepHost } from "./handlers/http-step.ts";
import { setConnectorReadSender } from "./handlers/try-read.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { chooseScheduleRecovery, runDueSchedules, SCHEDULE_EVERY_MS } from "./schedule/live.ts";
import type { ChoiceLimits, ScheduleChoiceKey } from "./schedule/schedule.ts";
import { registry } from "../../generated/registry.ts";

export { handlers };
export const hostSeams = { setDocumentNetwork, setConnectorReadSender, setHttpStepHost };
export { accessDiff, canView, structuralIssues, validateDefinition, webhookSecretMatches } from "./handlers/defs.ts";
import { acceptHook, consumeEvent, loadRunPlan, startRun } from "./handlers/triggers.ts";
export { consumeEvent, dropReason, fireOne, loadRunPlan, matches, startRun, triggerPayload } from "./handlers/triggers.ts";
import { recordSavedItem } from "./offer-store.ts";
import type { OfferDb } from "./offer-store.ts";
import { findAutomation, findRunLink, listChildLinks, listScopedChildren, saveRunLink } from "./projections.ts";
import type { AutoCtx, RunScope } from "./projections.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it. The host runs them with this module's ctx, so no other module reads these tables.
 * `owned_by` answers { <kind>: { count, sample } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type Row = Record<string, unknown>;
const rows = (ctx: Ctx, sql: string, ...a: unknown[]): Row[] => { try { return ctx.db.all(sql, ...a) as Row[]; } catch { return []; } };
const kept = (r: Row[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
const CONNECTOR_KINDS: ReadonlySet<string> = new Set(["api_key", "env", "login", "other"]);
/** Every event name an Automation trigger can listen for: the events the trigger catalogue names as the source of a trigger. */
const TRIGGER_EVENTS: readonly string[] = [...new Set(registry.triggers.flatMap((t) => { const src = t.source as { event?: string; events?: string[] } | undefined; return src?.events ?? (src?.event ? [src.event] : []); }))];

export const consumers = {
  /**
   * Events in, Runs out: the host runs this once per event a trigger listens for, after it is committed. An event a Run's own step made carries that Run's id, and from it the Automation and the chain depth
   * (the Run's depth plus one), so an Automation that makes the record it listens for is dropped as a self-trigger and a chain of them stops at the depth limit.
   */
  "automations.triggers": {
    on: TRIGGER_EVENTS,
    async run(ctx: Ctx, event: { id: string; name: string; payload: Record<string, unknown>; runId?: string }): Promise<void> {
      const parent = event.runId ? loadRunPlan(ctx as unknown as AutoCtx, event.runId) : undefined;
      await consumeEvent(ctx as unknown as AutoCtx, {
        id: event.id, type: event.name, payload: event.payload,
        ...(parent ? { origin: `automation:${parent.link.automationId}`, depth: (parent.link.depth ?? 0) + 1 } : {}),
      });
    },
  },
  "automations.connector_offer": {
    on: ["vault.item_created"],
    run(ctx: Ctx, event: { payload?: Record<string, unknown>; actor?: string }): void {
      const payload = event.payload ?? {};
      const itemId = typeof payload["itemId"] === "string" ? payload["itemId"] : "";
      const name = typeof payload["name"] === "string" ? payload["name"] : "";
      if (itemId === "") return;
      // a card, a note, a code, an SSH key or an AI account is not an app to connect
      if (typeof payload["kind"] === "string" && !CONNECTOR_KINDS.has(payload["kind"])) return;
      recordSavedItem(ctx.db as OfferDb, { itemId, name, fieldKeys: [] }, ctx.now(), payload["scope"] === "mine" && typeof event.actor === "string" ? event.actor : "");
    },
  },
};
export const periodic = {
  "automations.schedule_tick": { everyMs: SCHEDULE_EVERY_MS, run: (ctx: Ctx) => runDueSchedules(ctx as AutoCtx) },
};
export const hostCalls = {
  /** The inbound webhook route asks this: does the URL belong to a live, turned-on automation, and if so start its Run. Null is the one answer to every refusal. */
  "automations.accept_hook": (ctx: Ctx, i: Parameters<typeof acceptHook>[1]) => acceptHook(ctx as unknown as AutoCtx, i),
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
