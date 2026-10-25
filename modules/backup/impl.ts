// backup: handlers, projections and codecs. The host loads this file once the manifest says status live.
// The host calls configureBackup once at boot with the Space's data source, the export sink and the S3 transport.
export { handlers, configureBackup } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};
