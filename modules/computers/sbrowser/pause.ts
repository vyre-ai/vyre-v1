// Pause an agent's Space browser (lane r42-computer, owner-approved desk, 19 Nov). A person presses Pause: the agent's next browser call does not fail and does not run, it waits here, spending nothing,
// and goes on when they press Resume. It is not a take-over (nobody is steering): the page stays as it is and the agent's work simply holds still. Taking over, stopping the agent and the agent being deleted
// all end a pause, so a pause is never left behind by anything that moves on. A pause nobody comes back to ends by itself after PAUSE_MAX_MS.
// A call that has waited WAIT_MS gives up with one plain line (it has not run), so a forgotten pause cannot hold a request open for good; the agent tries once more when told to go on.
import { ensure, rowsOf } from "../projections.ts";
import type { CompCtx } from "../projections.ts";

export const PAUSE_MAX_MS = 30 * 60_000;
export let WAIT_MS = 5 * 60_000;
/** Tests: a shorter wait (default 5 minutes). */
export function setWaitMs(ms: number | null): void {
  WAIT_MS = ms ?? 5 * 60_000;
}
export const PAUSED_LINE =
  "A person paused your browser. Your call has not run. They will resume it, or you can go on without the browser; it comes back by itself after 30 minutes.";

export const STOPPED_LINE = "You were stopped. Your call did not run.";

export interface Pause {
  profileId: string;
  personId: string;
  since: number;
}

type Db = Pick<CompCtx, "db" | "now">;

/** The pause on a profile, or null. One that has run out is removed here, so a read is also the expiry. */
export function pauseOf(ctx: Db, profileId: string): Pause | null {
  ensure(ctx.db);
  const r = rowsOf(
    ctx.db,
    "SELECT profile_id, person_id, since FROM computers_browser_pause WHERE profile_id = ?",
    profileId,
  )[0];
  if (!r) return null;
  const since = Number(r["since"]);
  if (ctx.now() - since >= PAUSE_MAX_MS) {
    ctx.db.run("DELETE FROM computers_browser_pause WHERE profile_id = ?", profileId);
    wake(profileId);
    return null;
  }
  return { profileId, personId: String(r["person_id"]), since };
}
export const pausedBy = (ctx: Db, profileId: string): string | null => pauseOf(ctx, profileId)?.personId ?? null;

export function setPause(ctx: Db, profileId: string, personId: string): void {
  ensure(ctx.db);
  ctx.db.run("DELETE FROM computers_browser_pause WHERE profile_id = ?", profileId);
  ctx.db.run(
    "INSERT INTO computers_browser_pause (profile_id, person_id, since) VALUES (?, ?, ?)",
    profileId,
    personId,
    ctx.now(),
  );
}
/**
 * End the pause (resume, take over, stop, agent gone) and let the calls that wait go on. `stopped`: the agent was stopped, so the calls that wait do not run at all (a stop must never be followed by one more
 * click). True when there was a pause.
 */
export function dropPause(ctx: Pick<CompCtx, "db">, profileId: string, o: { stopped?: boolean } = {}): boolean {
  ensure(ctx.db);
  const had = rowsOf(ctx.db, "SELECT 1 FROM computers_browser_pause WHERE profile_id = ?", profileId).length > 0;
  ctx.db.run("DELETE FROM computers_browser_pause WHERE profile_id = ?", profileId);
  wake(profileId, o.stopped === true);
  return had;
}

// the calls waiting, by profile: a resume wakes them, and each looks at the table again (the table, not the wake, is the truth)
const waiting = new Map<string, Set<(stopped: boolean) => void>>();
function wake(profileId: string, stopped = false): void {
  const s = waiting.get(profileId);
  if (!s) return;
  waiting.delete(profileId);
  for (const f of [...s]) f(stopped);
}
/** How many calls of this daemon wait on a profile now (tests, the Console's line). */
export const waitingOn = (profileId: string): number => waiting.get(profileId)?.size ?? 0;

/**
 * Held while the profile is paused. Resolves "go" when it is not (or stops being), "stopped" when the agent was stopped meanwhile (the call must not run), and "gave_up" after WAIT_MS (tests: setWaitMs).
 * A call that arrives with no pause goes at once, without a timer.
 */
export async function waitWhilePaused(
  ctx: Db,
  profileId: string,
  waitMs: number = WAIT_MS,
): Promise<"go" | "stopped" | "gave_up"> {
  const until = Date.now() + waitMs;
  while (pauseOf(ctx, profileId) !== null) {
    const left = until - Date.now();
    if (left <= 0) return "gave_up";
    const stopped = await new Promise<boolean>((done) => {
      const set = waiting.get(profileId) ?? new Set<(stopped: boolean) => void>();
      waiting.set(profileId, set);
      const t = setTimeout(
        () => {
          set.delete(finish);
          done(false);
        },
        Math.min(left, 30_000),
      );
      const finish = (st: boolean): void => {
        clearTimeout(t);
        set.delete(finish);
        done(st);
      };
      set.add(finish);
    });
    if (stopped) return "stopped";
  }
  return "go";
}

/**
 * Everything a browser call must pass before it reaches the browser service, in the one order that cannot be raced: wait out a pause, then read the hold, and if a pause appeared while the hold was being
 * read, wait again and read the hold again. So a take-over that ended a pause is seen by the call it let go (it gets the hold, and is refused), a stop that ended it means the call does not run, and no step
 * between the last pause check and the call can start a pause that the call then ignores. `skip`: a look (status, stop) that runs through a pause and a hold.
 */
export async function admitAfterPause<H>(
  ctx: Db,
  profileId: string,
  skip: boolean,
  readHold: () => Promise<H | null>,
  waitMs: number = WAIT_MS,
): Promise<{ ok: true; hold: H | null; readAt: number } | { ok: false; why: "gave_up" | "stopped" }> {
  for (;;) {
    if (!skip) {
      const waited = await waitWhilePaused(ctx, profileId, waitMs);
      if (waited !== "go") return { ok: false, why: waited };
    }
    const readAt = Date.now();
    const hold = await readHold();
    if (skip || hold !== null || pauseOf(ctx, profileId) === null) return { ok: true, hold, readAt };
  }
}

/** The agent's turn ended by a stop or a failure: every pause on its profiles (its own and its askers') ends, and the calls that wait do not run. A stop never depends on a second call from a browser. */
export function dropPausesOfAgent(ctx: Pick<CompCtx, "db">, agentId: string): number {
  ensure(ctx.db);
  const rows = rowsOf(
    ctx.db,
    "SELECT profile_id FROM computers_browser_pause WHERE profile_id = ? OR profile_id LIKE ?",
    agentId,
    `${agentId}-%`,
  );
  for (const r of rows) dropPause(ctx, String(r["profile_id"]), { stopped: true });
  return rows.length;
}
