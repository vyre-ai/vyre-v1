// The capability caller lives in the client layer (apps never call fetch, boundary B4); the session imports it from here.
export { CapError, createCapCaller, indexByCap, queryString } from "../../../../../client/src/gateway/index.ts";
export type { CapCall, CapCallerOptions, CapErrorInit, RouteRow } from "../../../../../client/src/gateway/index.ts";
