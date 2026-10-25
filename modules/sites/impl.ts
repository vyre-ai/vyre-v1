// sites (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler (promote, rollback and site tables came with P-L8_02).

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureSites, handleBranchMerged, sweepMergedPreviews, routeProductionDomains } from "./handlers/index.ts";
