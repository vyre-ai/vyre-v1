// The setup steps as rows for the Home checklist, as plain data (no component, so a .ts test can import it): one row per step of the person's flow with its state.
import type { FlowKind, Progress, StepState } from "./flow.ts";
import { stateOn, visibleSteps } from "./device.ts";
import type { Device } from "./device.ts";

export interface SetupRow { key: string; title: string; note: string; state: StepState }

/** What the new chat shows on the first day: the top three steps still to do, the ones not put off first, and how many more wait. Done steps have left. */
export function setupTop(rows: readonly SetupRow[], most = 3): { rows: SetupRow[]; more: number } {
  const left = [...rows.filter((r) => r.state === "open"), ...rows.filter((r) => r.state === "later")];
  return { rows: left.slice(0, most), more: Math.max(0, left.length - most) };
}

/** The steps this device shows (a browser has no sessions or folders, a phone no Chrome and its own step is done); the Mac app shows all. */
export function setupRows(flow: FlowKind, progress: Progress, device: Device = "mac"): SetupRow[] {
  return visibleSteps(flow, device).map((s) => ({ key: s.key, title: s.title, note: s.line, state: stateOn(progress, s, device) }));
}
