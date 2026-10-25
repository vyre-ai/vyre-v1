// Capability handlers for updates (spec 3.10, b13 releases; ARCH 7.10). Channel, check, status, history, compatibility and health are in channels.ts;
// apply and roll back are in apply.ts. Every capability but app_compat needs server.update (the pipeline checks it).

import { app_compat, channel_set, check, health, history, status } from "./channels.ts";
import { apply, rollback } from "./apply.ts";

export type { Installer, ReleaseFeed, UpdateCtx, UpdateDrivers } from "./channels.ts";
export { configureUpdates } from "./channels.ts";

export const handlers = {
  "updates.status": status,
  "updates.channel_set": channel_set,
  "updates.check": check,
  "updates.apply": apply,
  "updates.rollback": rollback,
  "updates.history": history,
  "updates.app_compat": app_compat,
  "updates.health": health,
};
