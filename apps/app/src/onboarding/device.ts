// Where onboarding runs, because the steps differ by device (journey table D): the Mac and Windows apps do everything; a browser cannot read the disk, so sessions and folders are
// hidden; a phone also has no Chrome extension, and its own step ("Your phone") is already done.
import { stepsOf } from "./flow.ts";
import type { FlowKind, Progress, StepDef, StepState } from "./flow.ts";
import { stateOf } from "./flow.ts";

export type Device = "mac" | "win" | "web" | "phone";

const HIDDEN: Record<Device, readonly string[]> = { mac: [], win: [], web: ["import_sessions", "local_folders"], phone: ["import_sessions", "local_folders", "chrome"] };

/** The device this page runs on: a phone by width, the desktop app by its Tauri bridge (Mac or Windows by platform), otherwise a browser. */
export function detectDevice(width?: number): Device {
  const g = globalThis as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown; navigator?: { platform?: string; userAgent?: string } };
  if (width !== undefined && width > 0 && width <= 520) return "phone";
  if (g.__TAURI__ !== undefined || g.__TAURI_INTERNALS__ !== undefined) return /win/i.test(g.navigator?.platform ?? g.navigator?.userAgent ?? "") ? "win" : "mac";
  return "web";
}

export const visibleSteps = (flow: FlowKind, device: Device): readonly StepDef[] => stepsOf(flow).filter((s) => !HIDDEN[device].includes(s.card));

/** A step's state on this device: "Your phone" is done on the phone itself. */
export function stateOn(progress: Progress, step: StepDef, device: Device): StepState {
  return step.card === "phone" && device === "phone" ? "done" : stateOf(progress, step.key);
}

export function countsOn(flow: FlowKind, progress: Progress, device: Device): { done: number; later: number; total: number } {
  const steps = visibleSteps(flow, device);
  return { done: steps.filter((s) => stateOn(progress, s, device) === "done").length, later: steps.filter((s) => stateOn(progress, s, device) === "later").length, total: steps.length };
}

/** The step after `key` that is not done on this device, wrapping to one put off before it; null when none is left. */
export function nextOn(flow: FlowKind, progress: Progress, key: string, device: Device): string | null {
  const steps = visibleSteps(flow, device), at = steps.findIndex((s) => s.key === key);
  const open = (s: StepDef): boolean => stateOn(progress, s, device) !== "done";
  return steps.slice(at + 1).find(open)?.key ?? steps.slice(0, Math.max(at, 0)).find(open)?.key ?? null;
}

export function resumeOn(flow: FlowKind, progress: Progress, device: Device): string | null {
  const steps = visibleSteps(flow, device);
  return steps.find((s) => stateOn(progress, s, device) === "open")?.key ?? steps.find((s) => stateOn(progress, s, device) === "later")?.key ?? null;
}
