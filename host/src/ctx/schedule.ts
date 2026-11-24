// ctx.schedule (ARCH B2): run a capability later, as the principal who asked. This is what Gate timeouts (gate.expire, tasks.escalate), Google push polling and
// retry-later work stand on. Jobs live in the host table host_schedule, so a restart keeps them; a tick claims what is due, runs it through the invoke pipeline
// (a port: `run`), deletes it on success and retries with backoff on failure, then parks it as `dead` after `maxTries`. A claim that nobody finished (a crash
// mid-run) is picked up again after `leaseMs`.
import { mintUuid } from "../../../lib/ids.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CapName } from "../../../packages/contracts/src/types.ts";
import { fail } from "../routes/errors.ts";
import { HOST_SERVICE, isTrustedService } from "../../../lib/trust.ts";

/** The modules whose own follow-up calls may run as the host service (ctx.schedule `system`). */
export const SYSTEM_SCHEDULERS: ReadonlySet<string> = new Set(["mail"]);
import type { RawDb } from "./db.ts";

export interface ScheduledCall {
  id: string;
  space: string;
  cap: string;
  input: unknown;
  principal: { kind: Ctx["principal"]["kind"]; id: string };
  actingFor?: string;
  /** trace of the call that scheduled it, so the later run joins the same trace tree; absent when the caller started no trace (a top-level call mints its own inside the pipeline) */
  traceId?: string;
  /** failed runs so far */
  tries: number;
}

export interface ScheduleSeed {
  space: string;
  principal: { kind: Ctx["principal"]["kind"]; id: string };
  actingFor?: string | undefined;
  trace?: { traceId: string } | undefined;
}

export interface ScheduleOptions {
  db: RawDb;
  /** Runs one due call through the invoke pipeline. A throw counts as a failure. */
  run(call: ScheduledCall): Promise<void>;
  now?: () => number;
  /** May this person be the principal of a job the server schedules for them (ctx.schedule `as`)? Answers null for yes, or the plain sentence that says why not. */
  mayRunAs?(person: string): string | null;
  /** Failures before a job is parked as dead. Default 5. */
  maxTries?: number;
  /** Wait after the nth failure. Default 5 s doubling to 10 min. */
  backoffMs?: (tries: number) => number;
  /** A claim older than this is taken again. Default 2 min. */
  leaseMs?: number;
  /** A job that has not settled after this long is ended as failed (with the reason), so one stuck call never holds the queue. Default 5 min. */
  deadlineMs?: number;
  /** Jobs run per tick, oldest due first. Default 50. */
  batch?: number;
  onError?: (call: ScheduledCall, error: unknown, final: boolean) => void;
}

const CAP = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const REL = /^(?:in\s+|\+)?(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_INPUT = 64 * 1024;
const NO_TRACE = "0".repeat(32); // error shape only: an error needs some trace id even when the call has none

/** `at` is epoch milliseconds, an ISO date-time, or a delay from now: "+30s", "in 2h", "5m". Anything else is refused. */
export function parseWhen(at: number | string, now: number, traceId: string = NO_TRACE): number {
  const bad = (why: string): never => {
    throw fail("validation.bad_input", traceId, { message: why, details: { errors: [`at: ${why}`] } });
  };
  if (typeof at === "number") return Number.isFinite(at) && at >= 0 ? Math.floor(at) : bad("not a time");
  if (typeof at !== "string") return bad("not a time");
  const rel = REL.exec(at.trim());
  if (rel) return now + Math.round(Number(rel[1]) * UNIT[rel[2]!.toLowerCase()]!);
  const t = /^\d{4}-\d{2}-\d{2}/.test(at) ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? t : bad("not a time");
}

const DEFAULT_DEADLINE_MS = 300_000;
/** A tick lets the event loop run after this many ms of its own work, so fifty due jobs never hold it together. */
const YIELD_EVERY_MS = 20;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A job that waits, and why: `running` (claimed, not yet settled), `retrying` (failed, waiting for its backoff) or `due` (its time has come and it has not started: behind another job). */
export interface WaitingJob {
  id: string;
  cap: string;
  runAt: number;
  tries: number;
  why: "running" | "retrying" | "due";
  /** when it began to wait or run: the claim time of a job that runs, else the time it was due */
  since: number;
  error: string | null;
}

const defaultBackoff = (tries: number): number => Math.min(600_000, 5_000 * 2 ** Math.max(0, tries - 1));

interface Row {
  id: string;
  space: string;
  cap: string;
  input: string;
  principal_kind: string;
  principal_id: string;
  acting_for: string | null;
  trace_id: string;
  tries: number;
}

export class ScheduleQueue {
  private db: RawDb;
  private o: ScheduleOptions;
  private now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<number> | null = null;

  constructor(o: ScheduleOptions) {
    this.o = o;
    this.db = o.db;
    this.now = o.now ?? Date.now;
    this.db.run(`CREATE TABLE IF NOT EXISTS host_schedule (
      id TEXT PRIMARY KEY, space TEXT NOT NULL, cap TEXT NOT NULL, input TEXT NOT NULL,
      principal_kind TEXT NOT NULL, principal_id TEXT NOT NULL, acting_for TEXT, trace_id TEXT NOT NULL,
      run_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', claimed_at INTEGER, tries INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at INTEGER NOT NULL
    )`);
    this.db.run("CREATE INDEX IF NOT EXISTS host_schedule_due ON host_schedule (state, run_at)");
  }

  /** The ctx.schedule of one call. */
  /** `module` is the module whose capability is making this call; only it may ask for `system` jobs, and only for its own capabilities. */
  forCtx(seed: ScheduleSeed, module?: string): Ctx["schedule"] {
    return (at, cap, input, opts) => this.add(seed, at, cap, input, opts, module);
  }

  async add(
    seed: ScheduleSeed,
    at: number | string,
    cap: CapName | string,
    input: unknown,
    opts?: { as?: string; system?: boolean },
    module?: string,
  ): Promise<string> {
    const traceId = seed.trace?.traceId ?? NO_TRACE;
    let principal = seed.principal;
    let actingFor = seed.actingFor;
    if (opts?.system === true) {
      // a follow-up the module owns (a mail retry): it runs as the host service, so a person's or agent's identity is never replayed later. Only a listed module, only its own capabilities.
      if (!module || !SYSTEM_SCHEDULERS.has(module) || typeof cap !== "string" || !cap.startsWith(`${module}.`))
        throw fail("permission.no_grant", traceId, {
          message: "Only a module's own follow-up calls run as the system.",
        });
      principal = { kind: "service", id: HOST_SERVICE };
      actingFor = undefined;
    }
    if (opts?.as !== undefined) {
      // only the server's own jobs may schedule work as a person (a sync pass runs as the person who set the sync up); that person must be able to run it now
      if (!isTrustedService(seed.principal))
        throw fail("permission.no_grant", traceId, { message: "Only the server schedules work as a person." });
      if (!/^usr_[a-z0-9]+$/.test(opts.as))
        throw fail("validation.bad_input", traceId, { message: "as: not a person" });
      const why = this.o.mayRunAs?.(opts.as) ?? (this.o.mayRunAs ? null : "Nobody may run this for that person here.");
      if (why !== null) throw fail("permission.no_grant", traceId, { message: why });
      principal = { kind: "person", id: opts.as };
      actingFor = undefined;
    }
    const now = this.now();
    const runAt = parseWhen(at, now, traceId);
    if (typeof cap !== "string" || !CAP.test(cap))
      throw fail("validation.bad_input", traceId, {
        message: "not a capability name",
        details: { errors: ["cap: not a capability name"] },
      });
    let json: string;
    try {
      json = JSON.stringify(input ?? null);
    } catch {
      throw fail("validation.bad_input", traceId, {
        message: "input must be plain data",
        details: { errors: ["input: not JSON"] },
      });
    }
    if (json === undefined || json.length > MAX_INPUT)
      throw fail("validation.too_large", traceId, { message: "A scheduled input is limited to 64 KB." });
    const id = `sch_${mintUuid(now).replaceAll("-", "")}`;
    this.db.run(
      "INSERT INTO host_schedule (id, space, cap, input, principal_kind, principal_id, acting_for, trace_id, run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      seed.space,
      cap,
      json,
      principal.kind,
      principal.id,
      actingFor ?? null,
      seed.trace?.traceId ?? "",
      runAt,
      now,
    );
    return id;
  }

  /** Remove a job that has not run. False when it already ran, is running or never existed. */
  cancel(id: string): boolean {
    return this.db.run("DELETE FROM host_schedule WHERE id = ? AND state = 'pending'", id).changes > 0;
  }

  /** Jobs waiting to run (pending), parked after repeated failures (dead). */
  counts(): { pending: number; dead: number } {
    const rows = this.db.all("SELECT state, COUNT(*) AS n FROM host_schedule GROUP BY state") as {
      state: string;
      n: number;
    }[];
    return {
      pending: rows.find((r) => r.state === "pending" || r.state === "running")?.n ?? 0,
      dead: rows.find((r) => r.state === "dead")?.n ?? 0,
    };
  }

  /** The jobs that wait or run now, oldest first, each with why (the status a person or the health check reads). A job set for later that never failed is not waiting. */
  waiting(): WaitingJob[] {
    const now = this.now();
    const rows = this.db.all(
      "SELECT id, cap, run_at, tries, state, claimed_at, last_error FROM host_schedule WHERE state IN ('pending', 'running') ORDER BY run_at, rowid",
    ) as {
      id: string;
      cap: string;
      run_at: number;
      tries: number;
      state: string;
      claimed_at: number | null;
      last_error: string | null;
    }[];
    const out: WaitingJob[] = [];
    for (const r of rows) {
      const why: WaitingJob["why"] | null =
        r.state === "running" ? "running" : r.run_at <= now ? "due" : r.tries > 0 ? "retrying" : null;
      if (why)
        out.push({
          id: r.id,
          cap: r.cap,
          runAt: r.run_at,
          tries: r.tries,
          why,
          since: r.state === "running" ? (r.claimed_at ?? r.run_at) : r.run_at,
          error: r.last_error,
        });
    }
    return out;
  }

  /** Run everything due now. Returns how many jobs ran (success or failure). A tick that is still going is joined, not doubled. */
  tick(): Promise<number> {
    if (!this.ticking)
      this.ticking = this.drain().finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  /** Tick every `everyMs` (default 1 s) until stop(). The timer never keeps the process alive. */
  start(everyMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async drain(): Promise<number> {
    const now = this.now();
    const lease = this.o.leaseMs ?? 120_000;
    const due = this.db.all(
      "SELECT id, space, cap, input, principal_kind, principal_id, acting_for, trace_id, tries FROM host_schedule WHERE (state = 'pending' AND run_at <= ?) OR (state = 'running' AND claimed_at <= ?) ORDER BY run_at, rowid LIMIT ?",
      now,
      now - lease,
      this.o.batch ?? 50,
    ) as Row[];
    let ran = 0;
    let since = performance.now();
    for (const r of due) {
      if (performance.now() - since >= YIELD_EVERY_MS) {
        await yieldLoop();
        since = performance.now();
      }
      // claim: only one ticker wins a row even if two hosts share the file
      const claimed = this.db.run(
        "UPDATE host_schedule SET state = 'running', claimed_at = ? WHERE id = ? AND (state = 'pending' OR (state = 'running' AND claimed_at <= ?))",
        now,
        r.id,
        now - lease,
      ).changes;
      if (!claimed) continue;
      ran++;
      let input: unknown = null;
      try {
        input = JSON.parse(r.input);
      } catch {
        /* stored by add(), always valid; a damaged row fails below */
      }
      const call: ScheduledCall = {
        id: r.id,
        space: r.space,
        cap: r.cap,
        input,
        principal: { kind: r.principal_kind as Ctx["principal"]["kind"], id: r.principal_id },
        ...(r.acting_for ? { actingFor: r.acting_for } : {}),
        ...(r.trace_id ? { traceId: r.trace_id } : {}),
        tries: r.tries,
      };
      try {
        await this.within(this.o.run(call));
        this.db.run("DELETE FROM host_schedule WHERE id = ?", r.id);
      } catch (e) {
        const tries = r.tries + 1;
        const final = tries >= (this.o.maxTries ?? 5);
        const why = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
        if (final)
          this.db.run(
            "UPDATE host_schedule SET state = 'dead', tries = ?, last_error = ?, claimed_at = NULL WHERE id = ?",
            tries,
            why,
            r.id,
          );
        else
          this.db.run(
            "UPDATE host_schedule SET state = 'pending', tries = ?, last_error = ?, claimed_at = NULL, run_at = ? WHERE id = ?",
            tries,
            why,
            this.now() + (this.o.backoffMs ?? defaultBackoff)(tries),
            r.id,
          );
        try {
          this.o.onError?.(call, e, final);
        } catch {
          /* a hook that throws must not strand the jobs behind this one */
        }
      }
    }
    return ran;
  }

  /** A call that has not settled by the deadline is a failure; its late result, if it ever comes, is dropped. A slot is never held by a promise that does not settle. */
  private within(p: Promise<void>): Promise<void> {
    const ms = this.o.deadlineMs ?? DEFAULT_DEADLINE_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const span = ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`;
        reject(new Error(`It did not finish within ${span} and was ended.`));
      }, ms);
      timer.unref();
      p.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
