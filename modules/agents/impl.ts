// agents module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: what the module reads from the event log. `consumers` lists, by name, the events each one reads and what it does with one; the host runs them after commit, at least once, so each is safe to repeat.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { onFileVersion, onTurn } from "./handlers/crud.ts";
import { onMessageReceived } from "./handlers/routines.ts";
import type { FileVersionEvent, TurnEvent } from "./handlers/crud.ts";
import type { AgentsCtx } from "./projections.ts";

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
