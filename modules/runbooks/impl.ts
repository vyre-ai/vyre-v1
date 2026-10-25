// @reads /modules/runbooks/migrations/0001_runbooks.sql
// runbooks (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { parseBlocks, requestStop } from "./handlers/run.ts";
export type { Block } from "./handlers/run.ts";
