// Handlers of the git module: repository operations through the git binary (ops.ts).

import { opsHandlers } from "./ops.ts";

export const handlers = { ...opsHandlers };

export { configureGit, isProtectedCall, processExec } from "./ops.ts";
export type { GitDrivers, Exec, ExecOptions, ExecResult } from "./ops.ts";
