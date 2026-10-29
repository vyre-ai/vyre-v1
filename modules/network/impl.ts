// network: handlers, projections and codecs. The host loads this file once the module runs live.
export { handlers } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
import { nodePoll } from "./handlers/enroll.ts";
/** What the host asks of this module on behalf of a computer that joined (host/src/routes/compute.ts): never a capability, never reachable from a session. */
export const hostCalls = { "network.node_poll": nodePoll };
export const codecs = {};
