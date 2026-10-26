// forms (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.
// Every capability of the manifest has a handler here: form definitions, signed and one-use links, the public submit, attribution, Source rules, surveys and bookings.

import { configureForms } from "./handlers/index.ts";

export { handlers, configureForms, linkView } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";

/** Ruling 32: the loader collects this. The daemon calls setFormsHost with the public address of the Space (when it has one) and with null at shutdown. */
export const hostSeams = { setFormsHost: (host: Parameters<typeof configureForms>[0]): void => configureForms(host) };
