// templates handlers: the gallery of one-item packages in Kit format, preview of what one adds, install through the kits module, and save as a template.

import { galleryHandlers } from "./gallery.ts";

export const handlers = { ...galleryHandlers };

export { EMPTY_STARTERS, KINDS } from "./gallery.ts";
export type { TemplateKind, TemplateRow } from "./gallery.ts";
