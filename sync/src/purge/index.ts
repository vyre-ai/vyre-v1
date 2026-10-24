// Purge, revocation and leaving (ARCH 5.7). Client: hide frames, replica purge, leave. Server: epoch bump and the rescans that make hide frames.
export { createPurgeClient } from "./client.ts";
export type { PurgeClient, PurgeClientOpts } from "./client.ts";
export { applyHides, pullHides } from "./hide.ts";
export type { HideOpts, HideReport } from "./hide.ts";
export { docPrefix } from "./ports.ts";
export type { FolderPort, KeychainPort, OpenDocs, PurgeReason, PurgeStatus } from "./ports.ts";
export { PurgeError, purgeReplica, replicaTables } from "./purge.ts";
export type { PurgeOpts, PurgeReport } from "./purge.ts";
export { bumpEpoch, effectiveEpoch, reindexScope, scopeOf, spaceEpoch, RESCAN_SUMMARY_ROWS } from "./server.ts";
export type { BumpInput, BumpReason, BumpResult, BumpScope, PurgeServerDeps, ReindexInput, ReindexResult } from "./server.ts";
