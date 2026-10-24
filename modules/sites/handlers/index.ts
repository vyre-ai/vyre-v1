// Handlers for this packet: sites core, deploy, previews, env, staging password and domains.
// Promote, rollback and site tables (P-L8_02) are served by the generated stubs until that packet adds them.

import { deployHandlers } from "./deploy.ts";
import { domainHandlers } from "./domains.ts";

export const handlers = { ...deployHandlers, ...domainHandlers };

export { configureSites, handleBranchMerged, sweepMergedPreviews, NETWORK, DEFAULT_BRANCH, stagingHost, previewHost, branchSlug } from "./deploy.ts";
export type { SiteDrivers, SiteRuntime, SiteRouter, SiteDns, BuildRequest, BuildResult, StartRequest, StartResult, RouteSpec } from "./deploy.ts";
export { routeProductionDomains, edgeTarget } from "./domains.ts";
