// Handlers of the mounts module: the engine (mount lifecycle, sync pass, device reports, lag) over the providers.

import { engineHandlers } from "./engine.ts";
import { nativeHandlers } from "./native.ts";
import { withReversals } from "../../../lib/reversal.ts";
import { REVERSALS } from "./reversals.ts";

const base = { ...engineHandlers, ...nativeHandlers };
/** A person putting back an earlier revision of a mounted file that an agent had changed teaches that agent (lib/reversal.ts, memory.corrections.record). */
export const handlers = withReversals(base, REVERSALS);

export { SYNC_INTERVAL_MS, DEVICE_OFFLINE_MS, LAG_DEGRADED_S, LAG_DOWN_S, LIVE_POLL_MS, CLIENT_FRESH_MS } from "./engine.ts";
export { providerOf, exportMimeFor, PROVIDER_LABEL } from "./providers.ts";
export type { Provider, MountRec, RemoteItem, PullBatch, MountKind, MountMode } from "./providers.ts";
