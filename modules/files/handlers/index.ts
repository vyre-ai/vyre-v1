// Tree, blob, trash, version, lint, changeset and agent-staging handlers. Later packets add the rest of the manifest.

import { treeHandlers } from "./tree.ts";
import { versionHandlers } from "./versions.ts";
import { lintHandlers } from "./lint.ts";
import { sheetsHandlers } from "./sheets.ts";
import { listHandlers } from "./lists.ts";
import { changesetHandlers } from "./changesets.ts";
import { viewerHandlers } from "./viewer.ts";
import { withAgentStaging } from "./agent-stage.ts";
import { purgeHandlers } from "./purge.ts";
import { withRoots } from "./roots.ts";

// listHandlers add files.shared_with_me and files.knowledge;
// versionHandlers replace files.write (binary collision rule) and add files.diff; lintHandlers add files.lint, files.save, files.share; sheetsHandlers add the sheets.* table capabilities;
// changesetHandlers wrap files.write and files.create (agent writes in a Review changes folder are staged) and add the changesets.* capabilities; withAgentStaging puts the same staging
// in front of files.delete, files.rename, files.move and files.save.
export const handlers = withRoots(withAgentStaging({ ...treeHandlers, ...versionHandlers, ...lintHandlers, ...sheetsHandlers, ...listHandlers, ...changesetHandlers, ...viewerHandlers, ...purgeHandlers }));

export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS, TREE_ROOTS, KNOWLEDGE_CHILDREN } from "./tree.ts";
export { configureSheets, sheetsHooks } from "./sheets.ts";
export type { SheetsDrivers } from "./sheets.ts";
export { configureViewer } from "./viewer.ts";
export type { ViewerConfig } from "./viewer.ts";
export { configureFilesHost, registerRoots } from "./roots.ts";
export type { FilesHost } from "./roots.ts";
