// @reads /modules/documents/migrations/0001_documents.sql
// documents (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureDocuments } from "./handlers/fill.ts";
export type { DocumentsDrivers } from "./handlers/fill.ts";
