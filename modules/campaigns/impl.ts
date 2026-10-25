// campaigns (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler here. The engine pass (advance) and the warmup health seam (recordWarmupHealth) are exported for the host and the warmup client.

export { handlers, advance, configureCampaigns, poolOptedIn, recordWarmupHealth } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
