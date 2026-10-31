// The connectors module's handlers: the connector framework and runtime (runtime.ts) and the connections (connections.ts).
import { createConnectionsHandlers } from "./connections.ts";
import type { ConnectionsHandlers } from "./connections.ts";
import { createRuntimeHandlers } from "./runtime.ts";
import type { RuntimeHandlers } from "./runtime.ts";
import { createSyncHandlers } from "./sync.ts";
import type { SyncDeps, SyncHandlers } from "./sync.ts";
import { createDiscoverHandlers } from "./discover.ts";
import type { DiscoverHandlers } from "./discover.ts";
import { createStateHandlers } from "./syncstate.ts";
import type { StateHandlers } from "./syncstate.ts";
import { createSpecHandlers } from "./syncspec.ts";
import type { SpecHandlers } from "./syncspec.ts";

export type ConnectorsHandlers = RuntimeHandlers & ConnectionsHandlers & SyncHandlers & SpecHandlers & DiscoverHandlers & StateHandlers;

export function createConnectorsHandlers(deps: SyncDeps): ConnectorsHandlers {
  return { ...createRuntimeHandlers(deps), ...createConnectionsHandlers(deps), ...createSyncHandlers(deps), ...createSpecHandlers(deps), ...createDiscoverHandlers(deps), ...createStateHandlers(deps) };
}

export { noteSchemaChanges, syncRequest, proposedKey, proposedType } from "./sync.ts";
export type { SyncEngine, SyncBindingRow, SchemaChange, PreviewRow } from "./sync.ts";

export { executeAction, runCases, diffDefs } from "./runtime.ts";
export type { ConnectorRow, TestResult, ExecResult, ExecOpts } from "./runtime.ts";
export type { ConnectionRow } from "./connections.ts";
