// The trail of memory (owner design 30 Oct 2026, ruling 5): one row for every change to a fact or a page, by a person, an agent or upkeep: who, what, when, why and from where.
// Rows are only ever added. They hold ids, places and short reasons, never the words of a fact, so an erase can leave its line without leaving the content behind.
import { actorOf, mintId } from "./projections.ts";
import type { Layer, MemCtx } from "./projections.ts";

export type ActorKind = "person" | "agent" | "upkeep" | "system";
export type TrailAction = "create" | "edit" | "merge" | "delete" | "restore" | "archive" | "erase" | "learn" | "undo" | "accept" | "reject" | "promote" | "flag" | "resolve";

export interface Who { actor: string; actingFor?: string; kind: ActorKind }

/** The upkeep job acts as itself, not as the person whose key or schedule started it. */
export const UPKEEP: Who = { actor: "upkeep", kind: "upkeep" };

/** Who is making this call: the caller (a person, an agent) and, for an agent, the person it acts for. */
export function whoIs(ctx: Pick<MemCtx, "principal" | "actingFor">): Who {
  const p = ctx.principal;
  const kind: ActorKind = p.kind === "agent" ? "agent" : p.kind === "person" || p.kind === "actor" ? "person" : "system";
  const acting = ctx.actingFor;
  return { actor: p.id, ...(acting && acting !== p.id ? { actingFor: acting } : {}), kind };
}

export interface TrailScope { layer?: Layer | null; ownerRef?: string | null; agentId?: string | null; projectId?: string | null }

export interface TrailIn extends TrailScope {
  action: TrailAction;
  factId?: string;
  pageId?: string;
  who?: Who;
  /** Where the change came from, for example `chat:thr_x`, `tool:memory_forget`, `upkeep:rule`. */
  source?: string;
  reason?: string;
  /** Ids and numbers only. Never the text of a fact or a page. */
  detail?: Record<string, string | number | boolean | null>;
  runId?: string;
}

/** Add one line to the trail. Returns its id. */
export function trail(ctx: Pick<MemCtx, "db" | "now" | "principal" | "actingFor">, t: TrailIn): string {
  const id = mintId("trl", ctx.now());
  const who = t.who ?? whoIs(ctx);
  ctx.db.run(
    "INSERT INTO memory_trail (id, at, action, fact_id, page_id, layer, owner_ref, agent_id, project_id, actor, acting_for, actor_kind, source, reason, detail, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, ctx.now(), t.action, t.factId ?? null, t.pageId ?? null, t.layer ?? null, t.ownerRef ?? null, t.agentId ?? null, t.projectId ?? null, who.actor, who.actingFor ?? null, who.kind,
    t.source ?? null, t.reason ?? null, t.detail ? JSON.stringify(t.detail) : null, t.runId ?? null,
  );
  return id;
}

/** The person a change counts for: an agent's change counts for the person it acts for. */
export const onBehalfOf = (ctx: Pick<MemCtx, "principal" | "actingFor">): string => actorOf(ctx);
