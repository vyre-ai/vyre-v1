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

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

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
