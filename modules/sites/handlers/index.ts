// Handlers: sites core, deploy, previews, env, staging password, domains (P-L8_01), promote, rollback and site tables (P-L8_02).
// P-L8_02 owns promote.ts and tables.ts only; the two registration lines here and in impl.ts are the mapping that wires them in.

import { deployHandlers } from "./deploy.ts";
import { domainHandlers } from "./domains.ts";
import { promoteHandlers } from "./promote.ts";
import { tableHandlers } from "./tables.ts";

export const handlers = { ...deployHandlers, ...domainHandlers, ...promoteHandlers, ...tableHandlers };

export { configureSites, handleBranchMerged, sweepMergedPreviews, NETWORK, DEFAULT_BRANCH, stagingHost, previewHost, branchSlug } from "./deploy.ts";
export type { SiteDrivers, SiteRuntime, SiteRouter, SiteDns, BuildRequest, BuildResult, StartRequest, StartResult, RouteSpec } from "./deploy.ts";
export { routeProductionDomains, edgeTarget } from "./domains.ts";
