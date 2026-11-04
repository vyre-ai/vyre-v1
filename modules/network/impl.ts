// network: handlers, projections and codecs. The host loads this file once the module runs live.
export { handlers } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
import { nodePoll } from "./handlers/enroll.ts";
/** What the host asks of this module on behalf of a computer that joined (host/src/routes/compute.ts): never a capability, never reachable from a session. */
export const hostCalls = { "network.node_poll": nodePoll };
export const codecs = {};
import { machineAlertsNotify } from "./handlers/machines.ts";
import type { NetworkCtx } from "./handlers/index.ts";
/** Once a minute: each machine alert that is new goes to the Inbox of every admin, once while it lasts (handlers/machines.ts). */
export const periodic = { "network.machine_alerts": { everyMs: 60_000, run: (ctx: NetworkCtx) => machineAlertsNotify(ctx, {}) } };
