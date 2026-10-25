// ctx.schedule (ARCH B2): run a capability later, as the principal who asked. This is what Gate timeouts (gate.expire, tasks.escalate), Google push polling and
// retry-later work stand on. Jobs live in the host table host_schedule, so a restart keeps them; a tick claims what is due, runs it through the invoke pipeline
// (a port: `run`), deletes it on success and retries with backoff on failure, then parks it as `dead` after `maxTries`. A claim that nobody finished (a crash
// mid-run) is picked up again after `leaseMs`.
import { mintUuid } from "../../../lib/ids.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CapName } from "../../../packages/contracts/src/types.ts";
import { fail } from "../routes/errors.ts";
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
  /** Failures before a job is parked as dead. Default 5. */
  maxTries?: number;
  /** Wait after the nth failure. Default 5 s doubling to 10 min. */
  backoffMs?: (tries: number) => number;
  /** A claim older than this is taken again. Default 2 min. */
  leaseMs?: number;
  /** Jobs run per tick, oldest due first. Default 50. */
  batch?: number;
  onError?: (call: ScheduledCall, error: unknown, final: boolean) => void;
}

const CAP = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const REL = /^(?:in\s+|\+)?(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_INPUT = 64 * 1024;
const NO_TRACE = "0".repeat(32);   // error shape only: an error needs some trace id even when the call has none

/** `at` is epoch milliseconds, an ISO date-time, or a delay from now: "+30s", "in 2h", "5m". Anything else is refused. */
export function parseWhen(at: number | string, now: number, traceId: string = NO_TRACE): number {
  const bad = (why: string): never => { throw fail("validation.bad_input", traceId, { message: why, details: { errors: [`at: ${why}`] } }); };
  if (typeof at === "number") return Number.isFinite(at) && at >= 0 ? Math.floor(at) : bad("not a time");
  if (typeof at !== "string") return bad("not a time");
  const rel = REL.exec(at.trim());
  if (rel) return now + Math.round(Number(rel[1]) * UNIT[rel[2]!.toLowerCase()]!);
  const t = /^\d{4}-\d{2}-\d{2}/.test(at) ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? t : bad("not a time");
}

const defaultBackoff = (tries: number): number => Math.min(600_000, 5_000 * 2 ** Math.max(0, tries - 1));

interface Row {
  id: string; space: string; cap: string; input: string; principal_kind: string; principal_id: string; acting_for: string | null;
  trace_id: string; tries: number;
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
  forCtx(seed: ScheduleSeed): Ctx["schedule"] {
    return (at, cap, input) => this.add(seed, at, cap, input);
  }

  async add(seed: ScheduleSeed, at: number | string, cap: CapName | string, input: unknown): Promise<string> {
    const traceId = seed.trace?.traceId ?? NO_TRACE;
    const now = this.now();
    const runAt = parseWhen(at, now, traceId);
    if (typeof cap !== "string" || !CAP.test(cap)) throw fail("validation.bad_input", traceId, { message: "not a capability name", details: { errors: ["cap: not a capability name"] } });
    let json: string;
    try { json = JSON.stringify(input ?? null); } catch { throw fail("validation.bad_input", traceId, { message: "input must be plain data", details: { errors: ["input: not JSON"] } }); }
    if (json === undefined || json.length > MAX_INPUT) throw fail("validation.too_large", traceId, { message: "A scheduled input is limited to 64 KB." });
    const id = `sch_${mintUuid(now).replaceAll("-", "")}`;
    this.db.run(
      "INSERT INTO host_schedule (id, space, cap, input, principal_kind, principal_id, acting_for, trace_id, run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, seed.space, cap, json, seed.principal.kind, seed.principal.id, seed.actingFor ?? null, seed.trace?.traceId ?? "", runAt, now,
    );
    return id;
  }

  /** Remove a job that has not run. False when it already ran, is running or never existed. */
  cancel(id: string): boolean {
    return this.db.run("DELETE FROM host_schedule WHERE id = ? AND state = 'pending'", id).changes > 0;
  }

  /** Jobs waiting to run (pending), parked after repeated failures (dead). */
  counts(): { pending: number; dead: number } {
    const rows = this.db.all("SELECT state, COUNT(*) AS n FROM host_schedule GROUP BY state") as { state: string; n: number }[];
    return { pending: rows.find((r) => r.state === "pending" || r.state === "running")?.n ?? 0, dead: rows.find((r) => r.state === "dead")?.n ?? 0 };
  }

  /** Run everything due now. Returns how many jobs ran (success or failure). A tick that is still going is joined, not doubled. */
  tick(): Promise<number> {
    if (!this.ticking) this.ticking = this.drain().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  /** Tick every `everyMs` (default 1 s) until stop(). The timer never keeps the process alive. */
  start(everyMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async drain(): Promise<number> {
    const now = this.now();
    const lease = this.o.leaseMs ?? 120_000;
    const due = this.db.all(
      "SELECT id, space, cap, input, principal_kind, principal_id, acting_for, trace_id, tries FROM host_schedule WHERE (state = 'pending' AND run_at <= ?) OR (state = 'running' AND claimed_at <= ?) ORDER BY run_at, id LIMIT ?",
      now, now - lease, this.o.batch ?? 50,
    ) as Row[];
    let ran = 0;
    for (const r of due) {
      // claim: only one ticker wins a row even if two hosts share the file
      const claimed = this.db.run(
        "UPDATE host_schedule SET state = 'running', claimed_at = ? WHERE id = ? AND (state = 'pending' OR (state = 'running' AND claimed_at <= ?))",
        now, r.id, now - lease,
      ).changes;
      if (!claimed) continue;
      ran++;
      let input: unknown = null;
      try { input = JSON.parse(r.input); } catch { /* stored by add(), always valid; a damaged row fails below */ }
      const call: ScheduledCall = {
        id: r.id, space: r.space, cap: r.cap, input,
        principal: { kind: r.principal_kind as Ctx["principal"]["kind"], id: r.principal_id },
        ...(r.acting_for ? { actingFor: r.acting_for } : {}), ...(r.trace_id ? { traceId: r.trace_id } : {}), tries: r.tries,
      };
      try {
        await this.o.run(call);
        this.db.run("DELETE FROM host_schedule WHERE id = ?", r.id);
      } catch (e) {
        const tries = r.tries + 1;
        const final = tries >= (this.o.maxTries ?? 5);
        const why = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
        if (final) this.db.run("UPDATE host_schedule SET state = 'dead', tries = ?, last_error = ?, claimed_at = NULL WHERE id = ?", tries, why, r.id);
        else this.db.run("UPDATE host_schedule SET state = 'pending', tries = ?, last_error = ?, claimed_at = NULL, run_at = ? WHERE id = ?", tries, why, this.now() + (this.o.backoffMs ?? defaultBackoff)(tries), r.id);
        this.o.onError?.(call, e, final);
      }
    }
    return ran;
  }
}
