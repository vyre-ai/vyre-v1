// The sources module's handlers: intake, sources, deliveries and linking (hooks.ts). The sync engine (sync.ts) is a library the connectors' Run kind `connector_sync` runs.
import { createHooksHandlers } from "./hooks.ts";
import type { HooksHandlers } from "./hooks.ts";
import type { SourcesDeps } from "../projections.ts";

export type SourcesHandlers = HooksHandlers;

export function createSourcesHandlers(deps: SourcesDeps): SourcesHandlers {
  return createHooksHandlers(deps);
}

export { runSync, undoPush, retryPush, flushOutbox, confirmDeletes, resolveConflict, removedAtSource } from "./sync.ts";
export type { SyncBinding, SyncDeps, SyncOptions, SyncReport, SyncFieldMap, Direction, ConflictRule } from "./sync.ts";
export type { SourceRow, DeliveryRow, Candidate, IngestOut } from "./hooks.ts";
