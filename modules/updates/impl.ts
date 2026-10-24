// updates: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureUpdates once at boot with the release feed, the pinned release key and the installer.
export { handlers, configureUpdates } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};
