// email-builder-api (lane L8). The host loads the generated stub handlers while the manifest status is stub, and this module once it is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureEmailBuilder } from "./handlers/index.ts";

import { configureEmailBuilder as configure } from "./handlers/index.ts";
import type { AskDriver } from "./handlers/index.ts";

/** The host binds the Ask driver by name at boot (ruling 32): an agent turn in a private Ask pane about the design. Null clears it. */
export const hostSeams = { configureEmailBuilder: (o: { ask: AskDriver | null } | null): void => configure(o ?? { ask: null }) };
