// Members module (lane L7a). The manifest stays `stub` until P-CI_02 lands (ruling 25: a module's status is runtime state in host/modules.json).
import { drainJoins, invitesSeam } from "./handlers/invite.ts";
import { handlers } from "./handlers/index.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { MembersCtx } from "./projections.ts";

export { handlers };
/** The host builds identity's ctx.invites from this (peek never spends, accept queues the join effects), and the scheduler calls drainJoins to retry steps that failed. */
export { drainJoins, invitesSeam };
export const projections = { inline: {}, consumers: {} };

/** Join steps that did not work (a channel add, a group, the company mail and calendar match) are tried again every two minutes, as the system; each is idempotent, so a step that worked is never run twice. */
export const periodic = {
  "members.join_retry": { everyMs: 120_000, run: async (ctx: Ctx) => { await drainJoins(ctx as unknown as MembersCtx, undefined, { periodic: true }); } },
};
export const codecs = {};

/** Host calls (host/src/daemon/consumers.ts): what identity's ctx.invites runs, with this module's ctx (members_* tables). */
export const hostCalls = {
  "members.invite_peek": (ctx: Ctx, input: { code: string }) => invitesSeam(ctx as unknown as MembersCtx).peek(input.code),
  "members.invite_accept": (ctx: Ctx, input: { inviteId: string; personId: string }) => { invitesSeam(ctx as unknown as MembersCtx).accept(input.inviteId, input.personId); return null; },
};
