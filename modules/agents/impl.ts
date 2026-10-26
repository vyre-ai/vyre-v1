// agents module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: what the module reads from the event log. `consumers` lists, by name, the events each one reads and what it does with one; the host runs them after commit, at least once, so each is safe to repeat.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { onFileVersion, onTurn } from "./handlers/crud.ts";
import { onMessageReceived } from "./handlers/routines.ts";
import type { FileVersionEvent, TurnEvent } from "./handlers/crud.ts";
import type { AgentsCtx } from "./projections.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export const consumers = {
  /** A person saved agent.toml or AGENT.md in Files: a text that passes becomes what the next run uses, one that does not raises agent.config_error and the last good version keeps running. */
  "agents.config_watch": {
    on: ["file.version_added"],
    run: (ctx: AgentsCtx, event: FileVersionEvent): Promise<string[]> => onFileVersion(ctx, event),
  },
  /** The engine's turns keep the status honest: Working while a turn runs, Awake for two minutes after. */
  /** A message was posted: a watcher on that channel starts a run under its owner (P-CC_34). */
  "agents.watchers": {
    on: ["message.received"],
    run: (ctx: AgentsCtx, event: Parameters<typeof onMessageReceived>[1]): Promise<string[]> => onMessageReceived(ctx, event),
  },
  "agents.turn_started": {
    on: ["turn.started"],
    run: async (ctx: AgentsCtx, event: TurnEvent): Promise<void> => { onTurn(ctx, "started", event); },
  },
  "agents.turn_ended": {
    on: ["turn.completed", "turn.failed", "turn.cancelled"],
    run: async (ctx: AgentsCtx, event: TurnEvent): Promise<void> => { onTurn(ctx, "ended", event); },
  },
};

export { askerOf, markRoutineRan, routineLabel, routineVia, BUILTIN_SKILLS, CREATE_AGENT_SKILL, createAgentPlan } from "./projections.ts";
export { readTemplate, templateVersion } from "./handlers/routines.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it. The host runs them with this module's ctx, so no other module reads these tables.
 * `owned_by` answers { <kind>: { count, sample } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type Row = Record<string, unknown>;
const rows = (ctx: Ctx, sql: string, ...a: unknown[]): Row[] => { try { return ctx.db.all(sql, ...a) as Row[]; } catch { return []; } };
const kept = (r: Row[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const hostCalls = {
  "agents.owned_by": (ctx: Ctx, i: { person: string }) => ({
    agents: kept(rows(ctx, `SELECT "id", "name" FROM agents_agent WHERE "ownerId" = ? AND "deletedAt" IS NULL`, i.person), "agent", "name"),
    routines: kept(rows(ctx, `SELECT "id", "title" FROM agents_routine WHERE "ownerId" = ?`, i.person), "routine", "title"),
  }),
  "agents.reassign_owned": (ctx: Ctx, i: { person: string; kind: string; action: string; to?: string }): number => {
    const now = ctx.now();
    try {
      if (i.kind === "agents") {
        if (i.action === "reassign" && i.to) return ctx.db.run(`UPDATE agents_agent SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" = ? AND "deletedAt" IS NULL`, i.to, now, i.person).changes;
        if (i.action === "pause") return ctx.db.run(`UPDATE agents_agent SET "paused" = 1, "pausedReason" = ?, "pausedAt" = ?, "updatedAt" = ? WHERE "ownerId" = ? AND "deletedAt" IS NULL AND "paused" = 0`, "The owner was removed", now, now, i.person).changes;
        if (i.action === "delete") return ctx.db.run(`UPDATE agents_agent SET "deletedAt" = ?, "updatedAt" = ? WHERE "ownerId" = ? AND "deletedAt" IS NULL`, now, now, i.person).changes;
      }
      if (i.kind === "routines") {
        if (i.action === "pause") return ctx.db.run(`UPDATE agents_routine SET "enabled" = 0, "updatedAt" = ? WHERE "ownerId" = ? AND "enabled" = 1`, now, i.person).changes;
        if (i.action === "reassign" && i.to) return ctx.db.run(`UPDATE agents_routine SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" = ?`, i.to, now, i.person).changes;
        if (i.action === "delete") return ctx.db.run(`DELETE FROM agents_routine WHERE "ownerId" = ?`, i.person).changes;
      }
    } catch { /* no table yet: nothing to move */ }
    return 0;
  },
};
