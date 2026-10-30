// The setup steps as rows for the Home checklist: one row per step of the person's flow with its state, each reopening the onboarding screen at that step. Nothing is drawn until the
// onboarding host has read the person's progress, so a Space without it shows the rest of the checklist alone.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { FlowKind, Progress, StepState } from "./flow.ts";
import { stateOn, visibleSteps } from "./device.ts";
import type { Device } from "./device.ts";
import { openOnboarding, readProgress, watchProgress } from "./store.ts";

export interface SetupRow { key: string; title: string; note: string; state: StepState }

/** The steps this device shows (a browser has no sessions or folders, a phone no Chrome and its own step is done); the Mac app shows all. */
export function setupRows(flow: FlowKind, progress: Progress, device: Device = "mac"): SetupRow[] {
  return visibleSteps(flow, device).map((s) => ({ key: s.key, title: s.title, note: s.line, state: stateOn(progress, s, device) }));
}

/** The rows, with the draw left to the caller so Home keeps its own row look. */
export function SetupRows({ render }: { render(row: SetupRow, open: () => void, index: number): ReactElement }): ReactElement | null {
  const p = useSyncExternalStore(watchProgress, readProgress, () => null);
  if (!p) return null;
  return <>{setupRows(p.flow, p.progress).map((r, i) => render(r, () => { openOnboarding(r.key); }, i))}</>;
}
