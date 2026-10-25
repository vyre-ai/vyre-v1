// Handlers for the campaigns module (lane L8): build.ts defines a campaign, send.ts runs it and holds warmup.
// All 22 capabilities of the manifest are served here.

import { buildHandlers } from "./build.ts";
import { sendHandlers } from "./send.ts";

export const handlers = { ...buildHandlers, ...sendHandlers };

export { advance, poolOptedIn, recordWarmupHealth, warmupCap } from "./send.ts";
export type { PassResult } from "./send.ts";
export { configureCampaigns } from "../projections.ts";
export type { CampaignConfig } from "../projections.ts";
