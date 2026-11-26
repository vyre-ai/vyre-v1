// One turn budget for the whole server (27 Nov 2026, the Mac-hosted freeze). The hook pump, the projections pump and the folder sweep each gave the event loop back after 20 ms of their own work, so
// together, each running up to its own 20 ms before the loop could serve a timer or a request, they held it for 40 ms and more, and a pass over a hundred consumers each under its own budget held it for
// a second. Here the work of all of them is counted together: `loopOverBudget()` is true once TURN_BUDGET_MS has passed since the loop last ran, and `await loopTurn()` gives it back. Callers that
// yield in the same turn wait on one shared immediate, so they all resume after the loop has served its timers, with a fresh budget between them.
import { TURN_BUDGET_MS } from "./yield-loop.ts";

let since = performance.now();
let pending: Promise<void> | null = null;

/** Has the work of the server's loops used the turn's budget since the event loop last ran? */
export const loopOverBudget = (): boolean => performance.now() - since >= TURN_BUDGET_MS;

/** Give the event loop a turn; one immediate is shared by every caller that asks before it fires. */
export function loopTurn(): Promise<void> {
  pending ??= new Promise<void>((done) =>
    setImmediate(() => {
      pending = null;
      since = performance.now();
      done();
    }),
  );
  return pending;
}

/** `await loopTurn()` when the budget is used, else nothing: call at the end of every step of a loop. */
export async function loopYield(): Promise<void> {
  if (loopOverBudget()) await loopTurn();
}
