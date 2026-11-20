// esign (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

import { expireDue, setEsignHost } from "./handlers/vyre.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureEsign, documenso, parseLock } from "./handlers/index.ts";
export { setEsignHost };

/** Where the daemon hands this module the Space's public address at boot: the loader reads this export. */
export const hostSeams: import("../../host/src/seams/index.ts").SeamSetters = { setEsignHost };

/** Open envelopes past their time end, and each is told once, even when nobody touches it again (every minute; one read when none is due). */
export const periodic = {
  "esign.expire_due": { everyMs: 60_000, run: (ctx: Ctx) => expireDue(ctx) },
};
