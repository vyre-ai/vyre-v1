// portal (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// portal.file_link and portal.post stay on the stubs until a packet adds them.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configurePortal, filterRecords, resolveSession, peekLink } from "./handlers/index.ts";

// Ruling 32: the host registers the mailer under this name (host/src/seams/comms.ts createPortalHost).
import { configurePortal as configure } from "./handlers/index.ts";
export const hostSeams = { configurePortal: configure };
