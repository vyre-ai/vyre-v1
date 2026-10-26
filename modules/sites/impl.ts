// sites (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler (promote, rollback and site tables came with P-L8_02).

import { deferredHandlers } from "../../host/src/routes/deferred.ts";
import { handlers as real } from "./handlers/index.ts";

export { inline } from "./projections.ts";
export { configureSites, handleBranchMerged, sweepMergedPreviews, routeProductionDomains } from "./handlers/index.ts";

// Sites is deferred (ruling 60, docs/deferred.md): every capability is registered and refuses with "Not in this version yet" until the host builds the Docker runtime, Caddy router and DNS drivers.
// The deferred packet swaps this line for `export { handlers } from "./handlers/index.ts"` and brings `consumers` back.
export const handlers = deferredHandlers(Object.keys(real));
export const consumers = {};
