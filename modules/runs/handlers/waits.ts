// Waits on an event (P-L6_25). A Wait step that names an event parks its Run with a wait row (the event, a filter on its payload, a time to give up, events that cancel it). One consumer, runs.wake,
// takes events for those waits: the host asks `wantsEvent(type)` for every event type before invoking anything, and the answer comes from the waits that are open right now, so an event
// nobody waits for costs a set lookup and never a call. The set is kept by this process: a wait that is saved adds to it (noteWait), and at boot the host primes it from the wait table (primeWaits).
// A cancel-on event is wanted too: it stops the Run. A wait's own timeout is not an event: the clock consumer (runs.sweep_waits) ends it.
import { allWaits } from "../projections.ts";
import type { RunsCtx, WaitRow } from "../projections.ts";
import { wake } from "./engine.ts";

const exact = new Set<string>();
const prefixes = new Set<string>();   // "journey.*" waits for every journey event

function add(name: unknown): void {
  if (typeof name !== "string" || name === "") return;
  if (name.endsWith(".*")) prefixes.add(name.slice(0, -1)); else exact.add(name);
}

/** Remember what this wait needs to hear. */
export function noteWait(w: Pick<WaitRow, "on" | "cancelOn">): void {
  const on = w.on as { event?: unknown } | undefined;
  if (on && typeof on === "object") add(on.event);
  const cancel = w.cancelOn as { events?: unknown[] } | unknown[] | undefined;
  for (const c of Array.isArray(cancel) ? cancel : cancel?.events ?? []) add(c);
}

/** Does any open wait need this event type? A superset is fine (a wait that has since ended is not removed until restart); `wake` checks each wait's own rule. */
export function wantsEvent(type: string): boolean {
  if (exact.has(type)) return true;
  for (const p of prefixes) if (type.startsWith(p)) return true;
  return false;
}

/** At boot: what the waits left in the table need. Returns how many waits it read. */
export function primeWaits(ctx: RunsCtx): number {
  exact.clear(); prefixes.clear();
  const waits = allWaits(ctx.db);
  for (const w of waits) noteWait(w);
  return waits.length;
}

/** The consumer: a matching event ends a wait (the Run is resumed and driven on), a cancel-on event stops the Run. */
export async function wakeFromEvent(ctx: RunsCtx, event: { name: string; payload: unknown }): Promise<string[]> {
  return wake(ctx, { type: event.name, payload: event.payload });
}
