// Tree, blob, trash and version handlers for this packet. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";

// versionHandlers replace files.write (binary collision rule) and add files.diff.
export const handlers = { ...treeHandlers, ...versionHandlers };

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
