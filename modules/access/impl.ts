// Access module (lane L7a). Host keeps this stub until a later packet flips status to live.
import { handlers } from "./handlers/index.ts";
import { consumers, inline } from "./projections.ts";

export { handlers };
export const projections = { inline, consumers };
export const codecs = {};
export { inline, consumers };
