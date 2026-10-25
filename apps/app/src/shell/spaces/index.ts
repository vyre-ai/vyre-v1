// The shell: rail, tabs, title bar, Space switcher and the hub that holds one session per Space (spec 3.0, 2.1, ARCH 7.0).
export { Shell, teamOnly } from "./Shell.tsx";
export type { PlaceContext, ShellProps } from "./Shell.tsx";
export { HubProvider, useHub, useHubState, useSpaceWatch } from "./context.tsx";
export { SPACE_SWITCH_BUDGET_MS, createShellHub, titleText } from "./hub.ts";
export type { HubOptions, HubState, ShellHub, ShellTheme, SpaceSession } from "./hub.ts";
export { HARBOR, NORTHWIND, PERSONAL, SEED_DEFS } from "./model.ts";
export type { SpaceDef } from "./model.ts";
