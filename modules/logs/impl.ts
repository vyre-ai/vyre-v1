// logs: handlers, projections and codecs. The host loads this file once the manifest says status live.
export { handlers } from "./handlers/index.ts";
export { consumers, inline, projections } from "./projections.ts";
export const codecs = {};
