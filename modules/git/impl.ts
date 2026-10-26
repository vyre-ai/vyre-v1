// @reads /modules/git/migrations/0001_git_core.sql
// git (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

import { configureGit, processExec } from "./handlers/ops.ts";
import type { GitDrivers } from "./handlers/ops.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { configureGit, isProtectedCall } from "./handlers/ops.ts";
export type { GitDrivers, Exec, ExecOptions, ExecResult } from "./handlers/ops.ts";

/** Where the host registers its half at boot (ruling 31): setGitHost gets the working-trees directory and the credential slot the Vault filler writes a GitHub token to. */
export const hostSeams: SeamSetters = {
  setGitHost: (d: Pick<GitDrivers, "treesDir" | "takeCredential"> | null) => configureGit(d === null ? null : { exec: processExec(), ...d }),
};
