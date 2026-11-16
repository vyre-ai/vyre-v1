// The phone keeps its own history (mobile/shell/model.ts) beside the hub's: a row pressed on the phone opens a screen on that stack and tells the hub nothing. So the browser's Back (the bridge,
// history-bridge.ts) asks here when the hub has nothing to go back to: the phone pops its own stack, then goes to its first screen, and only then is there nothing to go back to.
let handler: (() => boolean) | null = null;

/** The phone host registers how its Back works: true when it moved. Returns what unregisters it. */
export function registerPhoneBack(fn: () => boolean): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/** The phone's own Back; false when there is no phone or it is on its first screen. */
export function phoneBack(): boolean {
  return handler?.() === true;
}
