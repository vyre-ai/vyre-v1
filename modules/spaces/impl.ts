// Spaces module (lane L7a). Stays `stub` until the rest of the module lands and the lead flips status after regenerating.
import { handlers } from "./handlers/index.ts";
import { STEP_EVENTS, completeStep } from "./projections.ts";

export { handlers, STEP_EVENTS, completeStep as autoComplete };
export const projections = {};
export const codecs = {};
