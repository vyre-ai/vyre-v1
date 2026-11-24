// @reads /modules/documents/migrations/0001_documents.sql
// documents (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
import { configureDocuments } from "./handlers/fill.ts";

export { configureDocuments };
export type { DocumentsDrivers } from "./handlers/fill.ts";

/** The host hands the module its Word-to-PDF converter here (host/src/seams/documents-pdf.ts); a machine with none hands an empty one, and the module sets the PDF itself. */
export const hostSeams = { configureDocuments };
