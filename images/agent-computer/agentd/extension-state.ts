// What Vyre for Chrome inside an agent computer is doing, said plainly. An MV3 extension's service worker is stopped by Chromium when it is idle and woken by its next event, so "no worker right now"
// is the normal resting state of an extension that is installed and fine; only a missing extension is a problem.
export type ExtensionState = "running" | "asleep" | "missing";
export interface ExtensionStatus { configured: boolean; workers: number; state: ExtensionState }

export function extensionStatus(configured: boolean, workers: number): ExtensionStatus {
  return { configured, workers, state: !configured ? "missing" : workers > 0 ? "running" : "asleep" };
}
