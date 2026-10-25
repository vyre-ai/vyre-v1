// Members module (lane L7a). The manifest stays `stub` until P-CI_02 lands (ruling 25: a module's status is runtime state in host/modules.json).
import { drainJoins, invitesSeam } from "./handlers/invite.ts";
import { handlers } from "./handlers/index.ts";

export { handlers };
/** The host builds identity's ctx.invites from this (peek never spends, accept queues the join effects), and the scheduler calls drainJoins to retry steps that failed. */
export { drainJoins, invitesSeam };
export const projections = { inline: {}, consumers: {} };
export const codecs = {};
