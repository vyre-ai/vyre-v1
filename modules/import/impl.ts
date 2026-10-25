// import module entry (lane L3). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// `setHost` gives the module the one thing it cannot take from ctx: the value behind a Vault handle, for Airtable and Notion keys.
import type { Handler } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { setHost } from "./projections.ts";
export { convert, parseDate, parseNumber, inferType, compileTransform, suggest } from "./mapping.ts";
export { parseCsvText, readXlsx, unzip } from "./sources.ts";
