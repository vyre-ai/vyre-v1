// portal extras: portal.file_link and portal.post. handlers/index.ts spreads extraHandlers into the portal handler map.

import { fileLinkHandlers } from "./fileLink.ts";
import { postHandlers } from "./post.ts";

export const extraHandlers = { ...fileLinkHandlers, ...postHandlers };

export { redeemFileLink } from "./fileLink.ts";
export { peekLink } from "./peek.ts";
export type { PeekDb, PeekedLink } from "./peek.ts";
