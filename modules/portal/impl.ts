// portal (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every portal capability has a handler here.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configurePortal, filterRecords, resolveSession, redeemFileLink } from "./handlers/index.ts";
