// @reads /modules/git/migrations/0001_git_core.sql
// git (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureGit, isProtectedCall } from "./handlers/ops.ts";
export type { GitDrivers, Exec, ExecOptions, ExecResult } from "./handlers/ops.ts";
