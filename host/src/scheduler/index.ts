// The scheduler (ARCH 1.2): the daemon's clock. Jobs run on an interval or once a day at a fixed time; a job never overlaps itself; a failing job is counted and reported, never fatal.
// The scheduler stamps `lastTickAt` on every tick: the `scheduler` host probe reads it, so a stalled event loop shows up in health. Automations, Journeys and campaigns have their own
// schedules in their modules; this one runs the host's chores (probes, command queues, idempotency purge, log retention).
import type { Logger } from "../../../packages/contracts/src/ctx.ts";

export type Schedule =
  | { everyMs: number; /** run once as soon as the scheduler starts */ immediate?: boolean }
  | { daily: { hour: number; minute: number }; utc?: boolean };

export interface JobSpec {
  name: string;
  schedule: Schedule;
  run(): Promise<void> | void;
  /** a run still going after this long is reported as timed out (it keeps running; the next run is skipped until it ends). Default 60 s. */
  timeoutMs?: number;
}

export interface JobStatus {
  name: string;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
  lastStartedAt: number | null;
  lastMs: number | null;
  lastError: string | null;
  nextAt: number;
}

export interface SchedulerOptions {
  now?: () => number;
  /** how often due jobs are looked for, default 1000 ms */
  tickMs?: number;
  log?: Logger;
  /** called after every run; the daemon turns these into log rows */
  onRun?: (r: { job: string; ok: boolean; ms: number; error?: string }) => void;
}

interface Job {
  spec: JobSpec;
  nextAt: number;
  running: boolean;
  runs: number;
  failures: number;
  skipped: number;
  lastStartedAt: number | null;
  lastMs: number | null;
  lastError: string | null;
}

/** The first moment after `after` that is `hour:minute` (local time, or UTC). */
export function nextDaily(after: number, hour: number, minute: number, utc = false): number {
  const d = new Date(after);
  if (utc) d.setUTCHours(hour, minute, 0, 0); else d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= after) { if (utc) d.setUTCDate(d.getUTCDate() + 1); else d.setDate(d.getDate() + 1); }
  return d.getTime();
}

export class Scheduler {
  private jobs = new Map<string, Job>();
  private now: () => number;
  private tickMs: number;
  private log: Logger | undefined;
  private onRun: NonNullable<SchedulerOptions["onRun"]>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = new Set<Promise<void>>();
  lastTickAt: number | null = null;

  constructor(o: SchedulerOptions = {}) {
    this.now = o.now ?? Date.now;
    this.tickMs = o.tickMs ?? 1000;
    this.log = o.log;
    this.onRun = o.onRun ?? (() => {});
  }

  add(spec: JobSpec): void {
    if (this.jobs.has(spec.name)) throw new Error(`job ${spec.name} is already scheduled`);
    const s = spec.schedule;
    if ("everyMs" in s && !(s.everyMs >= 1)) throw new Error(`job ${spec.name}: everyMs must be at least 1`);
    const t = this.now();
    const nextAt = "everyMs" in s ? (s.immediate ? t : t + s.everyMs) : nextDaily(t, s.daily.hour, s.daily.minute, s.utc ?? false);
    this.jobs.set(spec.name, { spec, nextAt, running: false, runs: 0, failures: 0, skipped: 0, lastStartedAt: null, lastMs: null, lastError: null });
  }

  remove(name: string): boolean { return this.jobs.delete(name); }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({ name: j.spec.name, running: j.running, runs: j.runs, failures: j.failures, skipped: j.skipped, lastStartedAt: j.lastStartedAt, lastMs: j.lastMs, lastError: j.lastError, nextAt: j.nextAt }));
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = this.now();
    this.timer = setInterval(() => { void this.tick(); }, this.tickMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await Promise.allSettled([...this.inflight]);
  }

  /** Run every job that is due. Resolves when those runs have finished. Tests call this directly with a fake clock. */
  async tick(): Promise<void> {
    const t = this.now();
    this.lastTickAt = t;
    const started: Promise<void>[] = [];
    for (const j of this.jobs.values()) {
      if (t < j.nextAt) continue;
      const s = j.spec.schedule;
      if (j.running) { j.skipped++; j.nextAt = "everyMs" in s ? t + s.everyMs : nextDaily(t, s.daily.hour, s.daily.minute, s.utc ?? false); continue; }
      j.nextAt = "everyMs" in s ? t + s.everyMs : nextDaily(t, s.daily.hour, s.daily.minute, s.utc ?? false);
      started.push(this.runJob(j));
    }
    await Promise.all(started);
  }

  private runJob(j: Job): Promise<void> {
    j.running = true;
    j.lastStartedAt = this.now();
    const t0 = j.lastStartedAt;
    const timeoutMs = j.spec.timeoutMs ?? 60_000;
    const p = (async () => {
      let timedOut = false;
      const watchdog = setTimeout(() => { timedOut = true; this.log?.warn("scheduler.job_slow", { job: j.spec.name, timeoutMs }); }, timeoutMs);
      watchdog.unref();
      try {
        await j.spec.run();
        j.lastError = timedOut ? `ran longer than ${timeoutMs} ms` : null;
        this.report(j, t0, true);
      } catch (e) {
        j.failures++;
        j.lastError = e instanceof Error ? e.message : String(e);
        this.report(j, t0, false);
      } finally {
        clearTimeout(watchdog);
        j.running = false;
      }
    })();
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  private report(j: Job, t0: number, ok: boolean): void {
    j.runs++;
    j.lastMs = this.now() - t0;
    this.onRun({ job: j.spec.name, ok, ms: j.lastMs, ...(ok ? {} : { error: j.lastError ?? "failed" }) });
    if (!ok) this.log?.error("scheduler.job_failed", { job: j.spec.name, error: j.lastError });
  }
}
