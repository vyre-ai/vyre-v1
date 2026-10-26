// reports-client: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureReports once at boot with the bundle sources and the reports.vyre.run client, and configureReplay with the replay sandbox.
import { deferredHandlers } from "../../host/src/routes/deferred.ts";
import { handlers as real } from "./handlers/index.ts";

export { configureReports, configureReplay, replayRun } from "./handlers/index.ts";
export { inline, projections } from "./projections.ts";

// Report a problem is deferred (ruling 60, docs/deferred.md): every capability is registered and refuses with "Not in this version yet" until the host has its reports.vyre.run client and replay sandbox.
// The deferred packet swaps this line for `export { handlers } from "./handlers/index.ts"` and brings `consumers` back.
export const handlers = deferredHandlers(Object.keys(real));
export const consumers = {};
export const codecs = {};
