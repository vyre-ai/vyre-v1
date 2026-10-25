// Capability handlers for console-views (6). The module has no tables: it reads other modules through ctx.call.
import { activity, attention, nav, overview, usage } from "./overview.ts";
import { speed } from "./speed.ts";

export type { ViewCtx } from "../projections.ts";

export const handlers = {
  "console.activity": activity,
  "console.attention": attention,
  "console.nav": nav,
  "console.overview": overview,
  "console.speed": speed,
  "console.usage": usage,
};
