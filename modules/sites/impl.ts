// sites (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Capabilities not listed in handlers (promote, rollback, table_create, table_promote, tables) stay on the stubs until P-L8_02.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureSites, handleBranchMerged, sweepMergedPreviews, routeProductionDomains } from "./handlers/index.ts";
