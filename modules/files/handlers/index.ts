// Tree, blob, trash and version handlers for this packet. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";

export const handlers = treeHandlers;

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
