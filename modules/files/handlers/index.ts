// Tree, blob, trash, version, lint, changeset and agent-staging handlers. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";
import { lintHandlers } from "./lint.ts";
import { changesetHandlers } from "./changesets.ts";
import { withAgentStaging } from "./agent-stage.ts";

// versionHandlers replace files.write (binary collision rule) and add files.diff; lintHandlers add files.lint, files.save, files.share; changesetHandlers wrap
// files.write and files.create (agent writes in a Review changes folder are staged) and add the changesets.* capabilities; withAgentStaging puts the same staging
// in front of files.delete, files.rename, files.move and files.save.
export const handlers = withAgentStaging({ ...treeHandlers, ...versionHandlers, ...lintHandlers, ...changesetHandlers });

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
