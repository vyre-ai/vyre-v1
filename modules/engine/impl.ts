// engine module entry (lane L2). The host loads the generated stubs while manifests/engine.ts says `status: 'stub'`; the last engine packet flips it to live
// (host/modules.json, ruling 25) after the contract tests pass against these handlers. Capabilities not listed in `handlers` stay on their stubs until then.
//
// Also here: the runtime that wires the turn engine to this module's SQL (queue, lease, messages, parked tool calls), so a second host that takes a thread over
// with recover() replays the same message bodies, and a tool call held at the Gate parks the turn on its task (turn.waiting) until resume().
import { createTurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { EngineOptions, TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import { handlers as table } from "./handlers/index.ts";
import { bindEngine, mintEngineId, sqlLeases, sqlMessages, sqlQueue, sqlWaits } from "./projections.ts";
import type { Db } from "./projections.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { bridgeConsumers } from "./handlers/bridge.ts";
import { gateResumeConsumers } from "./handlers/gate-resume.ts";
import { captureConsumers, capturePeriodic } from "./handlers/capture.ts";
import { closeNoAccountTasks, engineHost, ensureRuntime, setEngineHost, wakeAfterAnswer, wakeAfterUnblock } from "./runtime.ts";
import { onTaskEvent, sweepBaton } from "./handlers/task-baton.ts";
import type { EngineCtx } from "./projections.ts";

// Every engine capability first makes sure the runtime exists on a daemon that wired the engine seam (the first call builds it; a daemon without the seam leaves it unbound).
export const handlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(table as unknown as Record<string, Handler>).map(([name, fn]) => [name, (async (ctx, input) => { await ensureRuntime(ctx as never); return fn(ctx, input); }) as Handler]),
);

export { nodeCliLauncher, nodeCliReport } from "./node-cli.ts";

/** The host half arrives here at boot (ruling 31 and 32): the runtime opens real sessions through it. */
export const hostSeams = { setEngineHost };

/** The runtime is built at boot, not at the first message, and recovers threads a dead host left mid-turn. */
export const periodic = {
  "engine.runtime": { everyMs: 5_000, run: async (ctx: EngineCtx): Promise<void> => { await ensureRuntime(ctx); } },
  /** A baton an agent stopped on goes to a person after nudgeMinutes (handlers/task-baton.ts). */
  "engine.task_baton_sweep": {
    everyMs: 60_000,
    run: async (ctx: EngineCtx): Promise<string[]> => {
      const host = engineHost();
      if (!host) return [];
      return sweepBaton(ctx, { call: host.call, now: () => ctx.now(), ...(host.log ? { log: host.log } : {}) }, await ensureRuntime(ctx));
    },
  },
  ...capturePeriodic,
};

/** A task reached Done: if it was the Unblock for a turn with no account, wake that agent in that thread. */
/**
 * A consumer that hands work to the engine builds the runtime first. The runtime is built by the first engine call and by a periodic job every few seconds, so a message that arrives
 * before either (the first message after a server restart) would find no engine, be skipped and never get a turn. Building here is the same ensureRuntime the first call makes: once, idempotent.
 */
const withRuntime = <C extends Record<string, { run: (ctx: EngineCtx, event: never) => Promise<unknown> }>>(consumers: C): C => Object.fromEntries(
  Object.entries(consumers).map(([name, c]) => [name, { ...c, run: async (ctx: EngineCtx, event: never): Promise<unknown> => { await ensureRuntime(ctx); return c.run(ctx, event); } }]),
) as C;

export const consumers = {
  ...withRuntime(bridgeConsumers),
  ...withRuntime(gateResumeConsumers),
  ...captureConsumers,
  "engine.no_account_sweep": {
    on: ["provider.added"],
    run: async (ctx: EngineCtx): Promise<string[]> => closeNoAccountTasks(ctx.db),
  },
  /** The baton of a work task landed on an agent: wake it in the task's thread (handlers/task-baton.ts). */
  "engine.task_baton": {
    on: ["task.created", "task.assigned", "task.transitioned", "task.delegated", "task.escalated", "task.taken", "task.released", "task.withdrawn"],
    run: async (ctx: EngineCtx, event: Parameters<typeof onTaskEvent>[3]): Promise<string[]> => {
      const engine = await ensureRuntime(ctx);
      const host = engineHost();
      if (!engine || !host) return [];
      return onTaskEvent(ctx, { call: host.call, now: () => ctx.now(), ...(host.log ? { log: host.log } : {}) }, engine, event);
    },
  },
  "engine.block_answered": {
    on: ["block.answered"],
    run: async (ctx: EngineCtx, event: { payload: { threadId: string; blockId: string; by: string } }): Promise<string[]> => ((await wakeAfterAnswer(ctx, event)) ? [event.payload.blockId] : []),
  },
  "engine.unblock": {
    on: ["task.completed"],
    run: async (ctx: EngineCtx, event: { payload: { taskId: string } }): Promise<string[]> => ((await wakeAfterUnblock(ctx, event.payload.taskId)) ? [event.payload.taskId] : []),
  },
};

export interface RuntimeOptions extends Omit<EngineOptions, "queue" | "leases" | "messages" | "waits" | "newId"> {
  db: Db;
}

/** The turn engine on this module's tables. Bind it (bindEngine) so the control handlers reach it. */
export function createEngineRuntime(o: RuntimeOptions): TurnEngine {
  const { db, ...rest } = o;
  const now = o.now ?? Date.now;
  return createTurnEngine({ ...rest, queue: sqlQueue(db), leases: sqlLeases(db), messages: sqlMessages(db, now), waits: sqlWaits(db), newId: (p) => mintEngineId(p, now()) });
}

export { bindEngine, sqlLeases, sqlMessages, sqlQueue, sqlWaits };

/** A Gate task was answered: queue the wake that continues the turn parked on it. Null when this host holds no turn parked on that task. */
export function resumeHeld(engine: TurnEngine, taskId: string, approved: boolean): number | null {
  return engine.resume(taskId, { approved });
}
