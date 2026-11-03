// One computer at a time runs a Personal Space's scheduled work (lane l-multidevice). Every computer holds the whole Space, so without this each would fire the same automation, pull the same
// calendar and run the same nightly job. The lease is one row of network_runner, a table every computer copies: holder, what it is, since when, until when.
//   - the holder renews it every 30 s for 90 s;
//   - a computer takes it when it is missing or has run out (the holder slept), unless a server of the Space is awake: a server takes it from a computer at once;
//   - two computers that took it in the same moment, before they synced, settle on one: the row is a cell like any other, so the later write wins on both and the other stops.
// Scheduled runs are also keyed (automation id + scheduled time, runs.start derives the Run's id from that key), so two computers that both ran a tick in that moment make one Run.
export const LEASE_MS = 90_000;
export const RENEW_MS = 30_000;
export const LEASE_ID = "scheduled";

export interface Lease { peer_id: string; kind: string; since: number; expires_at: number }
export type RunnerMove = "renew" | "take" | "wait";

/** What this computer does about the lease now. `serverAwake`: a server of the Space other than this one was heard from lately. */
export function decide(me: { id: string; kind: string }, lease: Lease | null, now: number, serverAwake: boolean): RunnerMove {
  if (lease && lease.peer_id === me.id) return "renew";
  if (me.kind === "server" && (!lease || lease.kind !== "server" || lease.expires_at <= now)) return "take";
  if (lease && lease.expires_at > now) return "wait";
  return serverAwake ? "wait" : "take";
}

/** Module jobs that look after this computer's own state, so every computer runs them: its agents' files on disk, and the turns its own engine holds. */
export const EVERY_COMPUTER: ReadonlySet<string> = new Set(["agents.agent_files", "engine.runtime"]);
