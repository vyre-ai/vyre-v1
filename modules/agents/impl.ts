// agents module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: what the module reads from the event log. `consumers` lists, by name, the events each one reads and what it does with one; the host runs them after commit, at least once, so each is safe to repeat.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { OWNER_LEFT, onFileVersion, onDisplayNameChanged, onPersonCreated, onPersonLeft, onTurn, renameOldAssistants, restoreAgentFiles, retire, upgradeStarterAgentMd } from "./handlers/crud.ts";
import { onMessageReceived } from "./handlers/routines.ts";
import { memoryGuideConsumers } from "./memory-guide.ts";
import type { FileVersionEvent, PersonLeftEvent, PrincipalEvent, SettingChangedEvent, TurnEvent } from "./handlers/crud.ts";
import { agentOf } from "./projections.ts";
import type { AgentsCtx } from "./projections.ts";
import { setPluginsHost } from "./handlers/plugins.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

/** The boot check: right after start, then every 15 seconds, each agent's AGENT.md and agent.toml are in its folder; a missing one is put back from the agent record (P-L5_30). */
export const periodic = {
  "agents.agent_files": { everyMs: 15_000, immediate: true, run: (ctx: AgentsCtx): Promise<string[]> => restoreAgentFiles(ctx) },
  /** Once at boot (it repeats every 15 minutes in case the people list was not ready at boot; once renamed nothing matches): an assistant still called "<First> Assistant" becomes "<First>’s Assistant"; one the person renamed is left alone. */
  "agents.assistant_names": { everyMs: 15 * 60_000, immediate: true, run: (ctx: AgentsCtx): Promise<string[]> => renameOldAssistants(ctx) },
  /** At boot and every 15 minutes: an AGENT.md that is still the untouched old nine-line starter gets today's default as a new version; an edited one is never touched. */
  "agents.agent_md_upgrade": { everyMs: 15 * 60_000, immediate: true, run: (ctx: AgentsCtx): Promise<string[]> => upgradeStarterAgentMd(ctx) },
};

export { restoreAgentFiles };

/** The host's half for plugins (host/src/seams/plugins.ts): fetching a marketplace or a plugin as a map of text files. */
export const hostSeams = { setPluginsHost };

export const consumers = {
  ...memoryGuideConsumers,
  /** A person's account exists (claim or join): they get their private assistant, with or without an AI account. */
  "agents.ensure_assistant": {
    on: ["principal.created"],
    run: (ctx: AgentsCtx, event: PrincipalEvent): Promise<string[]> => onPersonCreated(ctx, event),
  },
  /** A person left or was removed: their assistant goes with them, what was not handed on pauses and their routines stop. */
  "agents.person_left": {
    on: ["member.removed"],
    run: (ctx: AgentsCtx, event: PersonLeftEvent): Promise<string[]> => onPersonLeft(ctx, event),
  },
  /** A person changed their display name: an assistant still wearing the default for the old name follows to the new one. */
  "agents.assistant_rename": {
    on: ["settings.changed"],
    run: (ctx: AgentsCtx, event: SettingChangedEvent): Promise<string[]> => onDisplayNameChanged(ctx, event),
  },
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
  /** the folders of the agents a person owns, for the removal wizard to move their ownership with the agents (ruling 88) */
  "agents.folders_of": (ctx: Ctx, i: { person: string }): { agentId: string; folderId: string }[] =>
    rows(ctx, `SELECT "id", "folderId" FROM agents_agent WHERE "ownerId" = ? AND "deletedAt" IS NULL`, i.person).map((r) => ({ agentId: String(r["id"]), folderId: String(r["folderId"]) })),
  "agents.owned_by": (ctx: Ctx, i: { person: string }) => ({
    // the person's private assistant is theirs alone: it is not something to hand on, so the wizard does not list it (it goes with the person, below)
    agents: kept(rows(ctx, `SELECT "id", "name" FROM agents_agent WHERE "ownerId" = ? AND "deletedAt" IS NULL AND "kind" <> 'assistant'`, i.person), "agent", "name"),
    routines: kept(rows(ctx, `SELECT "id", "title" FROM agents_routine WHERE "ownerId" = ?`, i.person), "routine", "title"),
  }),
  "agents.reassign_owned": async (ctx: Ctx, i: { person: string; kind: string; action: string; to?: string }): Promise<number> => {
    const now = ctx.now();
    try {
      if (i.kind === "agents") {
        // a private assistant is never handed on: it ends with its person (agents.person_left), whatever is done with their other agents
        const OTHERS = `"ownerId" = ? AND "deletedAt" IS NULL AND "kind" <> 'assistant'`;
        if (i.action === "reassign" && i.to) return ctx.db.run(`UPDATE agents_agent SET "ownerId" = ?, "updatedAt" = ? WHERE ${OTHERS}`, i.to, now, i.person).changes;
        const mine = rows(ctx, `SELECT * FROM agents_agent WHERE ${OTHERS}`, i.person);
        if (i.action === "pause") {
          const live = mine.filter((r) => Number(r["paused"]) === 0);
          for (const r of live) {
            ctx.db.run(`UPDATE agents_agent SET "paused" = 1, "pausedReason" = ?, "pausedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, OWNER_LEFT, now, now, String(r["id"]));
            ctx.emit("agent.paused", String(r["id"]), { agentId: String(r["id"]), reason: OWNER_LEFT, by: i.person });
          }
          return live.length;
        }
        if (i.action === "delete") {
          // through the one path, so what the agents were doing stops with them
          for (const r of mine) await retire(ctx as unknown as AgentsCtx, agentOf(r), i.person);
          return mine.length;
        }
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
