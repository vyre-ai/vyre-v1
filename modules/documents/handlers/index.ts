// Handlers of the documents module: template fields, preview and fill, template marks and the template list (fill.ts); the Vyre document, its PDF and its signing places (native.ts).

import { fillHandlers } from "./fill.ts";
import { nativeHandlers } from "./native.ts";

// native.ts answers fields, preview and fill for both kinds of template (a Word file goes to fill.ts), and adds the PDF of a Vyre document and where its signers sign
export const handlers = { ...fillHandlers, ...nativeHandlers };

export { configureDocuments, fill, placeholders, FillError } from "./fill.ts";
export type { DocumentsDrivers } from "./fill.ts";
