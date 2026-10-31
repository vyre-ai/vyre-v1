// The setup steps as rows for the Home checklist: one row per step of the person's flow with its state, each reopening the onboarding screen at that step. Nothing is drawn until the
// onboarding host has read the person's progress, so a Space without it shows the rest of the checklist alone.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { setupRows } from "./setup-rows.ts";
import type { SetupRow } from "./setup-rows.ts";
import { openOnboarding, readProgress, watchProgress } from "./store.ts";

export { setupRows };
export type { SetupRow };

/** The rows, with the draw left to the caller so Home keeps its own row look. */
export function SetupRows({ render }: { render(row: SetupRow, open: () => void, index: number): ReactElement }): ReactElement | null {
  const p = useSyncExternalStore(watchProgress, readProgress, () => null);
  if (!p) return null;
  return <>{setupRows(p.flow, p.progress).map((r, i) => render(r, () => { openOnboarding(r.key); }, i))}</>;
}
