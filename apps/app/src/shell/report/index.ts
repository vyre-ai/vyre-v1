// Report a problem (P-L9_16): the sheet, its store, the capture rings, the offline outbox and the shell hook-up.
export { ReportSheet, useReportState } from "./ReportSheet.tsx";
export type { ReportSheetProps } from "./ReportSheet.tsx";
export { ReportController } from "./controller.ts";
export type { Policy, ReportDeps, ReportState, Status, SubmitResult } from "./controller.ts";
export { buildBundle, scrubText } from "./bundle.ts";
export type { Bundle, ReportContext, SubmitIn } from "./bundle.ts";
export { createMemoryOutbox } from "./outbox.ts";
export type { Outbox, PendingOp } from "./outbox.ts";
export { Captures, Ring, captures } from "./ring.ts";
export type { CapturedError, CapturedEvent, LogLine, Snapshot } from "./ring.ts";
export { LEFT_OUT, previewRows } from "./rows.ts";
export type { PreviewRow } from "./rows.ts";
export { isReportKey } from "./keys.ts";
export { installReport } from "./install.ts";
export type { InstallOptions } from "./install.ts";
