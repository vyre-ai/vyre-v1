// Identity module (lane L7a). The manifest stays `stub` until the lead regenerates the registry with status live (needs gen, which only CI runs).
import { handlers } from "./handlers/index.ts";
import { sessionOfToken } from "./projections.ts";

export { handlers, sessionOfToken };
export const projections = {};
export const codecs = {};
