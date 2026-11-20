// The capability caller lives in the client layer (apps never call fetch, boundary B4); the session imports it from here.
export { CapError, createCapCaller, indexByCap, queryString } from "../../../../../client/src/gateway/index.ts";
export type { CapCall, CapCallerOptions, CapErrorInit, RouteRow } from "../../../../../client/src/gateway/index.ts";
export { probeDirectSpace, spaceIdAt } from "../../../../../client/src/gateway/space-probe.ts";
export { findSpace, findSpaceQuietly, relayShaped } from "../../../../../client/src/gateway/find-space.ts";
export type { Found, QuietOptions } from "../../../../../client/src/gateway/find-space.ts";
export { clearOldData, hasOldData, healStaleWorker } from "../../../../../client/src/gateway/old-data.ts";
