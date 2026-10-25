// Caddy driver: admin API client, route JSON, the router the Sites module uses, and certificate state.
export { CaddyAdmin, CaddyError } from "./admin.ts";
export type { AdminFetch, AdminOptions } from "./admin.ts";
export { acmePolicy, baseConfig, BASIC_USER, hostOf, LE_STAGING, normalizeHost, normalizeUpstream, RouteError, routeId, ROUTE_PREFIX, routesOf, SERVER, serverJson, siteRoute, withServer } from "./routes.ts";
export type { BaseOptions, BasicAuth, RouteJson } from "./routes.ts";
export { CaddyRouter } from "./router.ts";
export type { CertState, RouteSpec, RouterOptions } from "./router.ts";
export { connectPeer, judgeCert } from "./tls.ts";
export type { CertInfo, PeerCert, PeerFn } from "./tls.ts";
