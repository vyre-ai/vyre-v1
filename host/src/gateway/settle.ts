// Read-your-writes for an object a call names that another call is still making (Meier / cold-run fix, 20 Nov 2026). A module writes its own rows while its handler runs; the object becomes a resource that access knows of only
// when that call's commit has been synced (the commit is awaited by the call that made it, and by nobody else). So a second call that names the object in the meantime (the bridge opening the reply thread that a person's own
// call has just made) can find the row and not the resource, and is told "no thread by that name that you can see". It waits here for what is in progress, not for a clock: for the commits in flight, once each, and it
// stops as soon as nothing in progress can register the object (then it truly is unknown, and the call is refused as before).

export interface Settle {
  /** is the object known to access now? */
  known(): boolean;
  /** does the module hold a row for it (so a call that made it may still be registering it)? */
  rowExists(): boolean;
  /** the commits being written, with their syncs */
  inFlight(): readonly Promise<unknown>[];
  /** a handler that writes is running (its commit follows it straight away) */
  writing(): boolean;
  /** let the event loop turn once (a handler that is writing finishes and its commit starts) */
  yieldOnce(): Promise<void>;
}

/** Waits until the object is known, or nothing in progress could make it known. At most `rounds` waits, each on work that is already under way. Returns whether it is known. */
export async function settleRegistration(s: Settle, rounds = 8): Promise<boolean> {
  for (let n = 0; n < rounds; n++) {
    if (s.known()) return true;
    if (!s.rowExists()) return false;
    const pending = s.inFlight();
    if (pending.length > 0) await Promise.all(pending.map((p) => p.catch(() => undefined)));
    else if (s.writing()) await s.yieldOnce();
    else return false;
  }
  return s.known();
}
