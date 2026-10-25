// reports-client: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureReports once at boot with the bundle sources and the reports.vyre.run client, and configureReplay with the replay sandbox.
export { handlers, configureReports, configureReplay, replayRun } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};
