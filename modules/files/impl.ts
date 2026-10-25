// files (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS } from "./handlers/tree.ts";
export { configureSheets } from "./handlers/index.ts";
export type { SheetsDrivers } from "./handlers/index.ts";

import { configureFilesHost } from "./handlers/roots.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

/** Where the host registers its half at boot (ruling 31): setFilesHost gives the module the way to register its root folders as access resources (ruling 65). */
export const hostSeams: SeamSetters = { setFilesHost: configureFilesHost };
