// Tree, blob, trash, version and changeset handlers. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";
import { changesetHandlers } from "./changesets.ts";

// versionHandlers replace files.write (binary collision rule) and add files.diff; changesetHandlers wrap files.write and files.create
// (agent writes in a Review changes folder are staged) and add the changesets.* capabilities.
export const handlers = { ...treeHandlers, ...versionHandlers, ...changesetHandlers };

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
