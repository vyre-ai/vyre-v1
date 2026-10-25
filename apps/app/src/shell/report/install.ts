// Hooks the sheet into the shell: the shared Menu's "Report a problem" item, the Help menu and Cmd-Shift-/, and the window event the
// error states raise ("vyre:report-problem" with the trace id of the failed action).
import { setReportProblemHandler } from "../../../../../ui/src/Menu/index.tsx";
import { REPORT_PROBLEM_EVENT } from "../../../../../ui/src/States/index.tsx";
import type { ReportController } from "./controller.ts";
import { isReportKey } from "./keys.ts";
import type { ReportKeyEvent } from "./keys.ts";
import { captures } from "./ring.ts";

interface Target {
  addEventListener(type: string, fn: (e: never) => void): void;
  removeEventListener(type: string, fn: (e: never) => void): void;
}

export interface InstallOptions {
  /** The place that is open, for a report from the menu key or Cmd-Shift-/ . */
  currentPlace(): string;
  platform?: "mac" | "other";
  /** document for keys, window for the error event (both default to the globals). */
  keyTarget?: Target | null;
  eventTarget?: Target | null;
}

/** Returns the remover. Safe on native, where there is no window and the menu path alone is wired. */
export function installReport(ctl: ReportController, o: InstallOptions): () => void {
  const platform = o.platform ?? "mac";
  const g = globalThis as { document?: Target; window?: Target };
  const keys = o.keyTarget === undefined ? g.document ?? null : o.keyTarget;
  const events = o.eventTarget === undefined ? g.window ?? null : o.eventTarget;
  const offMenu = setReportProblemHandler((c) => ctl.open({ place: o.currentPlace(), ...(c.label ? { itemId: c.label } : {}) }));
  const onKey = (e: ReportKeyEvent & { preventDefault?: () => void }): void => {
    if (!isReportKey(e, platform)) return;
    e.preventDefault?.();
    ctl.open({ place: o.currentPlace() });
  };
  const onError = (e: { detail?: { traceId?: string; code?: string; message?: string } }): void => {
    const d = e.detail ?? {};
    if (d.message) captures.noteError({ code: d.code ?? "error", message: d.message, at: Date.now(), ...(d.traceId ? { traceId: d.traceId } : {}) });
    ctl.open({ place: o.currentPlace(), ...(d.traceId ? { itemId: d.traceId } : {}) });
  };
  keys?.addEventListener("keydown", onKey as never);
  events?.addEventListener(REPORT_PROBLEM_EVENT, onError as never);
  return () => {
    offMenu();
    keys?.removeEventListener("keydown", onKey as never);
    events?.removeEventListener(REPORT_PROBLEM_EVENT, onError as never);
  };
}
