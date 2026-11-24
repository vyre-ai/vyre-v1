// ui/InlineConfirm logic: the states of an in-place "Delete X? Cancel / Delete" strip, as a pure machine, so every transition is tested without a screen.
//   wary   the strip has just appeared. The press that opened it (or its double-click, or an Enter held down) may still be landing, so Delete does nothing yet.
//   armed  Delete does its work once.
//   spent  Delete was pressed and the strip is still on screen: the caller's work is running, or it failed and left the ask open. Delete does nothing until the strip arms again (the same wait), so
//          a double-press never deletes twice and a failed delete can be tried again. A caller whose work succeeded closes the strip, which ends it.
//   gone   Cancel or Escape: nothing more fires.
export type ConfirmState = "wary" | "armed" | "spent" | "gone";
export type ConfirmEvent = "arm" | "confirm" | "cancel";

/** How long a new strip ignores Delete: longer than a double-click (the OS default is 500 ms at most), short enough that nobody waits on it. */
export const ARM_MS = 600;

const wait = { ms: ARM_MS };
/** What a new strip waits now. Tests of screens that press Delete at once set 0 (the strip then arms as it mounts); the strip's own tests set it per strip with `armMs`. */
export function setArmDelay(ms: number): void {
  wait.ms = ms;
}
export function armDelay(): number {
  return wait.ms;
}

export interface ConfirmStep {
  state: ConfirmState;
  /** What the caller must do for this event: run the destructive action, run the cancel, or nothing. */
  fire: "confirm" | "cancel" | null;
}

export function step(state: ConfirmState, event: ConfirmEvent): ConfirmStep {
  if (state === "gone") return { state, fire: null }; // after a cancel nothing fires
  if (event === "arm") return { state: "armed", fire: null }; // from wary (first wait) or spent (the wait after a press)
  if (event === "cancel") return { state: "gone", fire: "cancel" }; // Cancel and Escape work at once, in any state
  return state === "armed" ? { state: "spent", fire: "confirm" } : { state, fire: null }; // confirm: only when armed
}
