// Capability handlers for reports-client (spec 4.18, b9; ARCH 7.14). Preview, submit, send, list, get, resolved, policy and health are in submit.ts.
// The replay sandbox (needs server.logs and console.access) is in replay.ts; the host mounts it for the Engineer MCP toolset and the Console.

import { get, health, list, policy_get, policy_set, preview, resolved, send_to_vyre, submit } from "./submit.ts";

export type { ReportSources, ReportsCtx, ReportsDrivers, ReportsService } from "./submit.ts";
export { configureReports } from "./submit.ts";
export { configureReplay, replayRun } from "./replay.ts";

export const handlers = {
  "reports.preview": preview,
  "reports.submit": submit,
  "reports.send_to_vyre": send_to_vyre,
  "reports.list": list,
  "reports.get": get,
  "reports.resolved": resolved,
  "reports.policy_get": policy_get,
  "reports.policy_set": policy_set,
  "reports.health": health,
};
