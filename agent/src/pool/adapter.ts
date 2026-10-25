// The pool behind the turn engine. The engine opens a session for every turn and closes it when the turn ends (agent/src/turn-engine/engine.ts); with the pool in between, "open"
// is a lease on a warm session and "close" gives it back, still warm. A session that was cancelled is not given back warm: its stream is half read, so it is closed.
import type { EngineSession, OpenSession, SessionSpec, StoredMessage, ToolResult, TurnInput } from "../turn-engine/types.ts";
import type { EnginePool, Lease, PoolSpec } from "./pool.ts";

/** Which pool entry a turn's session spec belongs to: the engine, account and model it runs on, and the person whose it is. */
export type ResolveSpec = (spec: SessionSpec) => PoolSpec;

export function poolOpenSession(pool: EnginePool, resolve: ResolveSpec): OpenSession {
  return async (spec) => {
    const lease = await pool.acquire(resolve(spec));
    return leased(pool, lease);
  };
}

function leased(pool: EnginePool, lease: Lease): EngineSession {
  const s = lease.session;
  let dirty = false;
  let given = false;
  return {
    get warm() { return lease.warm; },
    get providerLatencyMs() { return s.providerLatencyMs; },
    send: (input: TurnInput) => s.send(input),
    sendToolResult: (id: string, r: ToolResult) => s.sendToolResult(id, r),
    inject: (m: StoredMessage) => s.inject(m),
    async cancel() {
      dirty = true;
      await s.cancel();
    },
    async close() {
      if (given) return;
      given = true;
      await pool.release(lease, { reuse: !dirty });
    },
  };
}

/** The warm hint the client sends when a thread with an agent is opened or the composer gains focus (engine.warm). Never throws and never waits. */
export function warmHint(pool: EnginePool, resolve: ResolveSpec, spec: SessionSpec): void {
  try { pool.hint(resolve(spec)); } catch { /* a hint that cannot be resolved is no hint */ }
}
