// Tasks module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
import { handlers } from "./handlers/index.ts";

export { handlers };
import { countNeedsYou } from "./handlers/state.ts";
export { findStuck, mintApprovalToken, readApprovalToken, ACT_KEYS } from "./handlers/act.ts";
export { applyMove, checkMove, commitMove, planMove, submitTarget, afterReview } from "./handlers/state.ts";

/** What the Space switcher shows as Needs you on this person's tile (spaces.attention, P-L7_21): the same count as tasks.count_needs_you, asked for the person the host call runs as. */
export const hostCalls = {
  "tasks.attention": async (ctx: Parameters<typeof countNeedsYou>[0]): Promise<number> => {
    try { return Number(((await countNeedsYou(ctx, {} as never)) as { count?: number }).count ?? 0); } catch { return 0; }
  },
};
