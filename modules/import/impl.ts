// import module entry (lane L3). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// `setHost` gives the module the one thing it cannot take from ctx: the value behind a Vault handle, for Airtable and Notion keys.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { setHost } from "./projections.ts";
import type { ImportHost } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { setHost } from "./projections.ts";

/** The Vault value behind a handle, for Airtable and Notion keys (ruling 32). The daemon calls this with its driver of the same name at boot. */
export function setImportHost(h: ImportHost | null): void { setHost(h ?? undefined); }
export const hostSeams = { setImportHost };
export { convert, parseDate, parseNumber, inferType, compileTransform, suggest } from "./mapping.ts";
export { parseCsvText, readXlsx, unzip } from "./sources.ts";
