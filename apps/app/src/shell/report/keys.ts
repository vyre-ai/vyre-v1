// Cmd-Shift-/ opens the sheet (spec 3.0, 5). Cmd on a Mac, Ctrl elsewhere. The shell keyboard map (P-L9_15) lists the same shortcut for Settings > Keyboard.
export interface ReportKeyEvent {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function isReportKey(e: ReportKeyEvent, platform: "mac" | "other"): boolean {
  const mod = platform === "mac" ? e.metaKey === true : e.ctrlKey === true;
  const other = platform === "mac" ? e.ctrlKey === true : e.metaKey === true;
  if (!mod || other || e.altKey === true || e.shiftKey !== true) return false;
  return e.key === "/" || e.key === "?" || e.code === "Slash";
}
