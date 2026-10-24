// Tree, blob, trash, version and lint handlers. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";
import { lintHandlers } from "./lint.ts";

// versionHandlers replace files.write (binary collision rule) and add files.diff; lintHandlers add files.lint, files.save, files.share.
export const handlers = { ...treeHandlers, ...versionHandlers, ...lintHandlers };

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
