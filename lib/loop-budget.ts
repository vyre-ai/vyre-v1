// One turn budget for the whole server (27 Nov 2026, the Mac-hosted freeze). The hook pump, the projections pump and the folder sweep each gave the event loop back after 20 ms of their own work, so
// together, each running up to its own 20 ms before the loop could serve a timer or a request, they held it for 40 ms and more, and a pass over a hundred consumers each under its own budget held it for
// a second. Here the work of all of them is counted together: `loopOverBudget()` is true once TURN_BUDGET_MS has passed since the loop last ran, and `await loopTurn()` gives it back. Callers that
// yield in the same turn wait on one shared immediate, so they all resume after the loop has served its timers, with a fresh budget between them.
import { TURN_BUDGET_MS } from "./yield-loop.ts";

let since = performance.now();
let pending: Promise<void> | null = null;

/** The most one unit of pump or start-up work (a hook delivery, a projection step) may run before the next unit waits for the loop: a request's own turn is not delayed by more than a unit. */
export const UNIT_MS = 5;

/** Has the work of the server's loops used the turn's budget (`ms`, the turn's by default) since the event loop last ran? */
export const loopOverBudget = (ms: number = TURN_BUDGET_MS): boolean => performance.now() - since >= ms;

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

/** `await loopTurn()` when the budget is used, else nothing: call at the end of every step of a loop. `ms`: a smaller budget, for a loop whose units each take a few milliseconds (UNIT_MS). */
export async function loopYield(ms: number = TURN_BUDGET_MS): Promise<void> {
  if (loopOverBudget(ms)) await loopTurn();
}
