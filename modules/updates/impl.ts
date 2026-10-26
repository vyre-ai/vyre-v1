// updates: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureUpdates once at boot with the release feed, the pinned release key and the installer.
export { handlers, configureUpdates } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};
// Ruling 32: the host registers its release key, feed and installer drivers under this name (host/src/seams/updates.ts).
import { configureUpdates as configure } from "./handlers/index.ts";
export const hostSeams = { configureUpdates: configure };
