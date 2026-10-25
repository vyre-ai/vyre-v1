// Events module entry (lane L6). The host loads these handlers once host/modules.json says `live` (ARCH 12.4, ruling 25).
// Host seams the live boot must give this module (ruling 31): `setEventsHost` (the event log read port and the signed POST port, host/src/seams/events-ports.ts) and
// `setEventsDispatch` (starts a capability as the system, so the events.webhooks_out consumer can begin each delivery). Until they are set, event reads and deliveries answer
// internal.unavailable and webhooks.health reports down, so a server that forgot to wire them says so.
import { handlers } from "./handlers/index.ts";
import { codecs, consumers, inline, projections, setEventsDispatch, setEventsHost } from "./projections.ts";

export { handlers, codecs, consumers, inline, projections, setEventsDispatch, setEventsHost };
export { dueDeliveries, fanOut, webhooksOut } from "./projections.ts";

/** Where the host registers its half at boot: the loader reads this export. */
export const hostSeams = { setEventsHost, setEventsDispatch };
