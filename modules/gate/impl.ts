// Gate module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// recover() runs at boot; sweep() is the catch-up for timeouts the scheduler missed; the consumer rejects what a removed person had asked to send.
import { handlers } from "./handlers/index.ts";
import { rejectAllOf, recover } from "./handlers/hold.ts";
import { sweep } from "./handlers/approve.ts";
import type { GateCtx } from "./projections.ts";

export { handlers, recover, rejectAllOf, sweep };
export { ACTS, effectiveRule, summaryLine } from "./projections.ts";

/** Async consumers by name: the events each one reads and what it does with one. */
export const consumers = {
  /** An agent was deleted: what it had held at the Gate is dropped, so nobody can approve an act of an agent that is gone (hole 10). */
  "gate.agent_deleted": {
    on: ["agent.deleted"],
    async run(ctx: GateCtx, event: { payload: { agentId: string } }): Promise<string[]> {
      return rejectAllOf(ctx, event.payload.agentId, "The agent that asked was deleted.");
    },
  },
  "gate.member_removed": {
    on: ["member.removed"],
    async run(ctx: GateCtx, event: { payload: { personId: string; reason?: string } }): Promise<string[]> {
      return rejectAllOf(ctx, event.payload.personId, event.payload.reason ?? "The person who asked was removed.");
    },
  },
};
