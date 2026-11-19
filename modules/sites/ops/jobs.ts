// Scheduled jobs of a site (r42-sites-run, slice 5): a command that runs in the site's own image on a schedule, with a history.
// Explicit state machine. A run is queued, running, or ended (succeeded, failed, timed_out, canceled, skipped, interrupted); `step` is the only way a run changes and every pair is tested.
// `tick` decides what a schedule asks for right now: at most one run per tick, never two at once for one job, never a storm of missed runs after downtime.
import { latestBefore, next, parseCron } from "./cron.ts";

export type RunState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "canceled"
  | "skipped"
  | "interrupted";
export const ENDED: readonly RunState[] = ["succeeded", "failed", "timed_out", "canceled", "skipped", "interrupted"];
export const isEnded = (s: RunState): boolean => ENDED.includes(s);

export interface Job {
  id: string;
  siteId: string;
  name: string;
  schedule: string;
  /** a list of words, run without a shell unless the first words are `sh -c` */
  command: string[];
  zone: string;
  enabled: boolean;
  timeoutSec: number;
  /** the schedule slot last handled (ms), so a slot is never run twice; 0 before the first tick */
  lastSlot: number;
}

export interface Run {
  id: string;
  jobId: string;
  state: RunState;
  /** the schedule slot this run answers, or the time of a manual run */
  slot: number;
  by: "schedule" | "person";
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  /** one plain sentence for any end that is not a success */
  note?: string;
}

export type RunEvent =
  | { t: "start"; at: number }
  | { t: "finish"; at: number; code: number }
  | { t: "timeout"; at: number }
  | { t: "cancel"; at: number }
  /** the server restarted and the process is gone */
  | { t: "lost"; at: number }
  /** a queued run waited too long (the server was down) */
  | { t: "expire"; at: number };

export const QUEUE_MAX_MS = 10 * 60_000;
export const NOTE = {
  skipped: "The last run was still going, so this one did not start.",
  timed_out: (sec: number) => `It ran longer than ${sec} seconds and was stopped.`,
  failed: (code: number) => `It ended with an error (exit code ${code}).`,
  canceled: "It was canceled.",
  interrupted: "The server restarted while it ran, so it was cut short.",
  expired: "The server was down when it was due, and it was too late to run.",
} as const;

export type Stepped = { ok: true; run: Run; same: boolean } | { ok: false; why: string };

/** The one place a run changes. A repeat of the event that ended a run is accepted and changes nothing; any other event after an end is refused. */
export function step(run: Run, ev: RunEvent, job: Pick<Job, "timeoutSec">): Stepped {
  const end = (state: RunState, extra: Partial<Run> = {}): Stepped => ({
    ok: true,
    same: false,
    run: { ...run, state, endedAt: ev.at, ...extra },
  });
  const target: RunState | null =
    ev.t === "finish"
      ? ev.code === 0
        ? "succeeded"
        : "failed"
      : ev.t === "timeout"
        ? "timed_out"
        : ev.t === "cancel"
          ? "canceled"
          : ev.t === "lost"
            ? "interrupted"
            : ev.t === "expire"
              ? "skipped"
              : null;
  if (isEnded(run.state)) {
    if (target !== null && target === run.state) return { ok: true, run, same: true };
    return { ok: false, why: "That run has already ended." };
  }
  if (run.state === "queued") {
    if (ev.t === "start") return { ok: true, same: false, run: { ...run, state: "running", startedAt: ev.at } };
    if (ev.t === "cancel") return end("canceled", { note: NOTE.canceled });
    if (ev.t === "expire") return end("skipped", { note: NOTE.expired });
    // a queued run has no process to finish, time out or lose: it stays queued and is started or expired
    if (ev.t === "lost") return { ok: true, same: true, run };
    return { ok: false, why: "That run has not started." };
  }
  // running
  switch (ev.t) {
    case "start":
      return { ok: true, same: true, run };
    case "finish":
      return ev.code === 0
        ? end("succeeded", { exitCode: 0 })
        : end("failed", { exitCode: ev.code, note: NOTE.failed(ev.code) });
    case "timeout":
      return end("timed_out", { note: NOTE.timed_out(job.timeoutSec) });
    case "cancel":
      return end("canceled", { note: NOTE.canceled });
    case "lost":
      return end("interrupted", { note: NOTE.interrupted });
    case "expire":
      return { ok: false, why: "That run is already going." };
  }
}

export interface TickOut {
  /** a run to create (queued, or already ended as skipped), or null */
  create: { state: "queued" | "skipped"; slot: number; note?: string } | null;
  /** the job after the tick: lastSlot moved past what was handled */
  job: Job;
  /** the next slot after now, for "Next run" on the page; null when the schedule never fires */
  nextAt: number | null;
}

/** The longest a scheduler may have been away and still run the one slot it missed. Longer than this, the missed slot is dropped. */
export const CATCH_UP_MS = 60 * 60_000;

/** What the schedule asks for at `now`, given the runs so far. Never more than one run: a restart after a long stop runs the latest missed slot once, not every one. */
export function tick(job: Job, runs: readonly Run[], now: number): TickOut {
  let cron;
  try {
    cron = parseCron(job.schedule);
  } catch {
    return { create: null, job, nextAt: null };
  }
  const nextAt = next(cron, now, job.zone);
  if (!job.enabled) return { create: null, job, nextAt: null };
  if (job.lastSlot === 0) return { create: null, job: { ...job, lastSlot: now - (now % 60_000) }, nextAt };
  const slot = latestBefore(cron, now, job.zone, Math.min(CATCH_UP_MS, now - job.lastSlot));
  if (slot === null || slot <= job.lastSlot) return { create: null, job, nextAt };
  const busy = runs.some((r) => r.jobId === job.id && !isEnded(r.state));
  const moved = { ...job, lastSlot: slot };
  return busy
    ? { create: { state: "skipped", slot, note: NOTE.skipped }, job: moved, nextAt }
    : { create: { state: "queued", slot }, job: moved, nextAt };
}

/** A person asked for a run now. Refused while one is going, so a double press does not start two. */
export function runNow(
  job: Job,
  runs: readonly Run[],
  now: number,
): { ok: true; slot: number } | { ok: false; why: string } {
  if (runs.some((r) => r.jobId === job.id && !isEnded(r.state))) return { ok: false, why: "It is already running." };
  return { ok: true, slot: now };
}

/** Turning a job on again does not run what was missed while it was off. */
export function resume(job: Job, now: number): Job {
  return { ...job, enabled: true, lastSlot: now - (now % 60_000) };
}

export interface Caps {
  perSite: number;
  server: number;
}
export const RUN_CAPS: Caps = { perSite: 2, server: 4 };

/** Which queued runs may start now, oldest first, under the caps on running jobs of one site and of the whole server. */
export function startable(
  queued: readonly { run: Run; siteId: string }[],
  running: readonly { siteId: string }[],
  caps: Caps = RUN_CAPS,
): string[] {
  const bySite = new Map<string, number>();
  for (const r of running) bySite.set(r.siteId, (bySite.get(r.siteId) ?? 0) + 1);
  let all = running.length;
  const out: string[] = [];
  for (const q of [...queued].sort((a, b) => a.run.queuedAt - b.run.queuedAt)) {
    if (all >= caps.server) break;
    const n = bySite.get(q.siteId) ?? 0;
    if (n >= caps.perSite) continue;
    out.push(q.run.id);
    bySite.set(q.siteId, n + 1);
    all++;
  }
  return out;
}

export const KEEP_RUNS = 50;
/** The ids of runs to delete: the oldest ended runs past the newest KEEP_RUNS; a queued or running run is never deleted. */
export function prune(runs: readonly Run[], keep: number = KEEP_RUNS): string[] {
  const ended = runs.filter((r) => isEnded(r.state)).sort((a, b) => b.queuedAt - a.queuedAt);
  return ended.slice(keep).map((r) => r.id);
}

/** After a restart: what to do with every run the store says is not ended. Running runs are lost (their process is gone); queued runs wait or expire. */
export function recover(runs: readonly Run[], now: number): { id: string; ev: RunEvent }[] {
  const out: { id: string; ev: RunEvent }[] = [];
  for (const r of runs) {
    if (r.state === "running") out.push({ id: r.id, ev: { t: "lost", at: now } });
    else if (r.state === "queued" && now - r.queuedAt > QUEUE_MAX_MS)
      out.push({ id: r.id, ev: { t: "expire", at: now } });
  }
  return out;
}

/** Check a job a person wrote, in one plain sentence per problem; null when it is fine. */
export function checkJob(
  j: { schedule: string; command: string[]; timeoutSec: number; zone: string },
  validZone: (z: string) => boolean,
): string | null {
  try {
    parseCron(j.schedule);
  } catch (e) {
    return e instanceof Error ? e.message : "That schedule cannot be read.";
  }
  if (j.command.length === 0 || j.command.some((w) => typeof w !== "string" || w === ""))
    return "Give the command to run.";
  if (j.command.join(" ").length > 2000) return "That command is too long.";
  if (!Number.isInteger(j.timeoutSec) || j.timeoutSec < 5 || j.timeoutSec > 6 * 3600)
    return "A job may run between 5 seconds and 6 hours.";
  if (!validZone(j.zone)) return "That time zone is not known.";
  return null;
}
