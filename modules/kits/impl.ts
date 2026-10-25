// kits (lane L8). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

import { configureKits } from "./handlers/index.ts";
import type { KitsConfig } from "./handlers/index.ts";

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureKits, runKitScript, runKitTests, runSandboxed } from "./handlers/index.ts";

/** Ruling 31: the loader collects this. The daemon calls setKitsHost with the Kit source it builds (host/src/seams/kits.ts) and calls it with null at shutdown. */
export const hostSeams = { setKitsHost: (host: Pick<KitsConfig, "source" | "resources"> | null): void => configureKits(host) };
