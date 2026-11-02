// The setup steps as rows for the Home checklist: one row per step of the person's flow with its state, each reopening the onboarding screen at that step. Nothing is drawn until the
// onboarding host has read the person's progress, so a Space without it shows the rest of the checklist alone.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useWindowDimensions } from "react-native";
import { detectDevice } from "./device.ts";
import { setupRows, setupTop } from "./setup-rows.ts";
import type { SetupRow } from "./setup-rows.ts";
import { openOnboarding, readProgress, watchProgress } from "./store.ts";

export { setupRows, setupTop };
export type { SetupRow };

/** The top steps still to do, on this device, with the draw left to the caller so each screen keeps its own row look. `more` draws the line for the rest; it opens setup at the first of them.
 * `extra` is a row of the caller's own that is not a setup step (the first screen's Email and calendar): it sits after the steps and before the more line. */
export function SetupRows({ render, more, extra = null }: { render(row: SetupRow, open: () => void, index: number): ReactElement; more(count: number, open: () => void): ReactElement; extra?: ReactElement | null }): ReactElement | null {
  const p = useSyncExternalStore(watchProgress, readProgress, () => null);
  const width = useWindowDimensions().width;
  if (!p) return null;
  const top = setupTop(setupRows(p.flow, p.progress, detectDevice(width)));
  return <>{top.rows.map((r, i) => render(r, () => { openOnboarding(r.key); }, i))}{extra}{top.more > 0 ? more(top.more, () => { openOnboarding(top.rows[0]!.key); }) : null}</>;
}
