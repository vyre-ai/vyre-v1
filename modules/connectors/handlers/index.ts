// The connectors module's handlers: the connector framework and runtime (runtime.ts) and the connections (connections.ts).
import { createConnectionsHandlers } from "./connections.ts";
import type { ConnectionsHandlers } from "./connections.ts";
import { createRuntimeHandlers } from "./runtime.ts";
import type { RuntimeHandlers } from "./runtime.ts";
import type { ConnectorsDeps } from "../projections.ts";

export type ConnectorsHandlers = RuntimeHandlers & ConnectionsHandlers;

export function createConnectorsHandlers(deps: ConnectorsDeps): ConnectorsHandlers {
  return { ...createRuntimeHandlers(deps), ...createConnectionsHandlers(deps) };
}

export { executeAction, runCases, diffDefs } from "./runtime.ts";
export type { ConnectorRow, TestResult, ExecResult, ExecOpts } from "./runtime.ts";
export type { ConnectionRow } from "./connections.ts";
