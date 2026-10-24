// portal (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// portal.file_link and portal.post stay on the stubs until a packet adds them.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configurePortal, filterRecords, resolveSession } from "./handlers/index.ts";
