// conflicts module entry (lane L1). The host loads the generated stubs while host/modules.json says `status: 'stub'`; the lane's live packet flips it (ruling 25) after the contract tests
// pass against these handlers. All 11 capabilities of manifests/conflicts.ts have a handler here.
//
// What the host binds at boot (all optional, each has a working default):
//   openConflict / recordHistory  the two dependencies sync.push calls (PushDeps.openConflict, PushDeps.history)
//   consumers["conflicts.route"]  the async consumer of the sync event conflict.opened: routes the conflict to the assistant or to Needs you
//   setPorts                      the person's assistant (agent turn engine), the entity writers and the protected-field rule
import { handlers as table } from "./handlers/index.ts";
import { onConflictOpened, openConflict, recordHistory } from "./handlers/detect.ts";
import { heuristicProposal, setPorts } from "./projections.ts";
import type { CfCtx, Ports, Proposal } from "./projections.ts";
import type { Handler } from "../../host/src/invoke.ts";
import type { HookEvent } from "../../host/src/daemon/consumers.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

/** Async consumers (host/src/daemon/consumers.ts): conflict.opened is declared by sync; this routes the parked conflict to the assistant or to Needs you. */
export const consumers = {
  "conflicts.route": {
    on: ["conflict.opened"],
    run(ctx: Ctx, event: HookEvent): Promise<unknown> {
      return onConflictOpened(ctx as unknown as CfCtx, { conflictId: String(event.payload["conflictId"]) });
    },
  },
};

export { heuristicProposal, onConflictOpened, openConflict, recordHistory, setPorts };
export type { Ports, Proposal };
export { ensure } from "./projections.ts";
