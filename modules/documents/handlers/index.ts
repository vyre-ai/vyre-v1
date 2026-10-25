// Handlers of the documents module: template fields, preview and fill, template marks and the template list (fill.ts).

import { fillHandlers } from "./fill.ts";

export const handlers = { ...fillHandlers };

export { configureDocuments, fill, placeholders, FillError } from "./fill.ts";
export type { DocumentsDrivers } from "./fill.ts";
