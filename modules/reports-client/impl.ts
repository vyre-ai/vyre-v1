// reports-client: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureReports once at boot with the bundle sources and the reports.vyre.run client, and configureReplay with the replay sandbox.
import { deferredHandlers } from "../../host/src/routes/deferred.ts";
import { configureReports, handlers as real } from "./handlers/index.ts";

export { configureReports, configureReplay, replayRun } from "./handlers/index.ts";
export { inline, projections } from "./projections.ts";

// The host hands the bundle sources and the reports.vyre.run client through this seam at boot (host/src/seams/reports.ts); until it has, a capability here answers "not available on this server yet".
// The replay sandbox is not wired by the host: replayRun refuses without it, and reports.submit does not use it.
export const hostSeams = { configureReports };
// The inbound webhook stays deferred: reports.resolved takes the service's call at POST /hooks/reports, which needs its signature check and a route to this module before it may be open to a caller.
export const handlers = { ...real, ...deferredHandlers(["reports.resolved"]) };
export const consumers = {};
export const codecs = {};
