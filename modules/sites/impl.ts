// sites (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler (promote, rollback and site tables came with P-L8_02).

import { deferredHandlers } from "../../host/src/routes/deferred.ts";

export { inline } from "./projections.ts";
export { routeById, routeBySlug, routeByTicket } from "./handlers/route.ts";
import { registry } from "../../generated/registry.ts";
import { configureDomainEdge, configureRoutes, routeHandlers } from "./handlers/route.ts";
import { domainRouteHandlers } from "./handlers/route-domains.ts";
export { refreshDomainRoutes } from "./handlers/route-domains.ts";

// A site is a route (owner, 2 Nov): handlers/route.ts is what ships. The build pipeline below it (deploy, previews, staging, promote, site tables) is dormant and deferred: each of its capabilities stays registered and
// refuses with "Not in this version yet" (ruling 60, docs/deferred.md). Nothing wires configureSites or dockerRuntime.
const live = { ...routeHandlers, ...domainRouteHandlers };
const dormant = registry.capabilities.filter((c) => c.module === "sites" && !(c.name in live)).map((c) => c.name);
export const handlers = { ...deferredHandlers(dormant), ...live };
export const consumers = {};
export const hostSeams = { configureRoutes, configureDomainEdge };
