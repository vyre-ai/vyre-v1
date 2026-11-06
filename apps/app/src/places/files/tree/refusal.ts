// A Files menu action is a capability call the Space can refuse (no right to delete, offline, the item is gone). The refusal has to reach the person, so it shows in the top bar's notice slot,
// in plain words, instead of the button doing nothing.
import { notices } from "../../../shell/noticeslot/model.ts";

/** What went wrong, in one line: "Could not move it to Trash: <the Space's reason>". */
export function refusalText(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `${what}: ${msg}` : `${what}.`;
}

/** Run a call whose answer the screen does not wait for; if it is refused, say so. */
export function tellIfRefused(call: Promise<unknown>, what: string): void {
  Promise.resolve(call).catch((e: unknown) => { notices.pass(refusalText(e, what)); });
}
