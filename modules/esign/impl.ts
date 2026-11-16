// esign (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

import { setEsignHost } from "./handlers/vyre.ts";

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureEsign, documenso, parseLock } from "./handlers/index.ts";
export { setEsignHost };

/** Where the daemon hands this module the Space's public address at boot: the loader reads this export. */
export const hostSeams: import("../../host/src/seams/index.ts").SeamSetters = { setEsignHost };
