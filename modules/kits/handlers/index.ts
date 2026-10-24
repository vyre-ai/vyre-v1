// kits handlers: the Kit format and install sheet, install, update and rollback, publish with tests, and the script sandbox.

import { installHandlers } from "./install.ts";
import { publishHandlers } from "./publish.ts";

export const handlers = { ...installHandlers, ...publishHandlers };

export { configureKits, checkKit, sheetOf, compareSemver } from "./install.ts";
export type { KitManifest, KitItem, KitScript, KitTest, KitSource, KitsConfig, FixtureSpace, InstallSheet } from "./install.ts";
export { runKitTests, runKitScript, reportDenials } from "./publish.ts";
export { runSandboxed } from "./sandbox.ts";
export type { SandboxOptions, SandboxResult } from "./sandbox.ts";
