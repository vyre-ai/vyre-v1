// The connectors module's handlers: the connector framework and runtime (runtime.ts) and the connections (connections.ts).
import { createConnectionsHandlers } from "./connections.ts";
import type { ConnectionsHandlers } from "./connections.ts";
import { createRuntimeHandlers } from "./runtime.ts";
import type { RuntimeHandlers } from "./runtime.ts";
import { createSyncHandlers } from "./sync.ts";
import type { SyncDeps, SyncHandlers } from "./sync.ts";

export type ConnectorsHandlers = RuntimeHandlers & ConnectionsHandlers & SyncHandlers;

export function createConnectorsHandlers(deps: SyncDeps): ConnectorsHandlers {
  return { ...createRuntimeHandlers(deps), ...createConnectionsHandlers(deps), ...createSyncHandlers(deps) };
}

export { noteSchemaChanges, syncRequest, proposedKey, proposedType } from "./sync.ts";
export type { SyncEngine, SyncBindingRow, SchemaChange, PreviewRow } from "./sync.ts";

export { executeAction, runCases, diffDefs } from "./runtime.ts";
export type { ConnectorRow, TestResult, ExecResult, ExecOpts } from "./runtime.ts";
export type { ConnectionRow } from "./connections.ts";
