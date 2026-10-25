// Identity module (lane L7a). The manifest stays `stub` until the lead regenerates the registry with status live (needs gen, which only CI runs).
import { handlers } from "./handlers/index.ts";
import { configureSessionTokens, sessionOfToken } from "./projections.ts";

export { handlers, sessionOfToken };
/** The host hands identity its session-token seam (mint a gateway token for a devices session, end a session at the gateway) through this setter at boot. */
export const hostSeams = { setSessionTokens: configureSessionTokens };
export const projections = {};
export const codecs = {};
