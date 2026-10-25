// @reads /modules/mounts/migrations/0001_mounts_core.sql
// mounts (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
