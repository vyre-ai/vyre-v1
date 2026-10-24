// Tree, blob, trash, version, changeset and agent-staging handlers. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";
import { changesetHandlers } from "./changesets.ts";
import { withAgentStaging } from "./agent-stage.ts";

// versionHandlers replace files.write (binary collision rule) and add files.diff; changesetHandlers wrap files.write and files.create
// (agent writes in a Review changes folder are staged) and add the changesets.* capabilities; withAgentStaging puts the same staging in front of
// files.delete, files.rename, files.move and (once a lint module adds it to this map) files.save.
export const handlers = withAgentStaging({ ...treeHandlers, ...versionHandlers, ...changesetHandlers });

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
