// The config pane of an Automation (spec 3.7): the generated screens' builtins ui:AutomationConfig and ui:PromoteSheet, and the extras the shell supplies (who can be picked, where links go).
export { AutomationConfig } from "./AutomationConfig.tsx";
export type { AutomationConfigProps, ConfigTab } from "./AutomationConfig.tsx";
export { PromoteSheet } from "./PromoteSheet.tsx";
export type { PromoteSheetProps } from "./PromoteSheet.tsx";
export { ConfigExtrasProvider, useConfigExtras } from "./data.tsx";
export type { ConfigDirectory, ConfigExtras, DirEntry } from "./data.tsx";
