// What each chat's right pane was showing: open or not, and which of its own tabs. Kept for as long as the app is open, so a chat's pane comes back as it was when its tab is returned to.
import type { TabKey } from "../rightpane/model.ts";

export const PANE_MEMORY = new Map<string, { open: boolean; tab?: TabKey }>();

/** For tests and sample places: every chat starts with nothing remembered. */
export function forgetPanes(): void {
  PANE_MEMORY.clear();
}
