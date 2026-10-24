// A harness for steps: a ctx whose capability calls are scripted and logged, a clock the test moves, and a small stand-in for the Run engine (`MiniRun`) so a whole plan can be walked,
// parked on a wait and woken, the way modules/runs `drive` does it. The stand-in is test code only; the real engine is in modules/runs.
import { runStep } from "../handlers/control.ts";
import type { StepCall, StepEnv, StepNode, StepResult, WaitSpec } from "../handlers/control.ts";
import type { StepsCtx } from "../projections.ts";
import { NOW } from "./seed.ts";

type Callee = (input: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Called { cap: string; input: any }   // eslint-disable-line @typescript-eslint/no-explicit-any

export function harness(calls: Record<string, Callee> = {}, over: Partial<StepEnv> = {}) {
  let clock = NOW;
  const log: Called[] = [];
  const map: Record<string, Callee> = { ...calls };
  const ctx: StepsCtx = {
    space: "spc_test", principal: { kind: "service", id: "svc_run" }, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => clock,
    async call(cap, input) {
      log.push({ cap, input });
      const f = map[cap];
      if (!f) throw new Error(`unexpected call to ${cap}`);
      return f(input);
    },
  };
  const env: StepEnv = { ctx, run: { id: "run_t1", label: "Welcome email" }, ...over };
  return {
    ctx, env, log,
    callee(cap: string, f: Callee): void { map[cap] = f; },
    advance(ms: number): void { clock += ms; },
    now: (): number => clock,
    only(cap: string): Called[] { return log.filter((c) => c.cap === cap); },
  };
}
export type Harness = ReturnType<typeof harness>;

/** The error code a step threw. */
export const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

export type MiniState = "running" | "waiting" | "succeeded" | "failed" | "canceled";
/** Walks a plan one step at a time like the Run engine: keeps each step's result, follows `next`, parks on a wait, and is woken by an event or the clock. */
export class MiniRun {
  state: MiniState = "running";
  outputs: Record<string, unknown> = {};
  trail: string[] = [];
  wait: WaitSpec | undefined;
  error: { code: string; message: string } | undefined;
  private cur: string | undefined;
  private started = new Map<string, number>();
  private resumed = false;
  private h: Harness;
  private plan: StepNode[];
  private trigger: unknown;
  private sandbox: boolean;
  constructor(h: Harness, plan: StepNode[], trigger: unknown = {}, sandbox = false) {
    this.h = h; this.plan = plan; this.trigger = trigger; this.sandbox = sandbox;
    this.cur = plan[0]?.id;
  }

  async run(): Promise<this> {
    while (this.cur !== undefined && this.state === "running") {
      const n = this.plan.find((p) => p.id === this.cur)!;
      const idx = this.plan.indexOf(n);
      if (!this.started.has(n.id)) this.started.set(n.id, this.h.now());
      const call: StepCall = { attempt: 1, key: `run_t1:${n.id}:1`, outputs: this.outputs, sandbox: this.sandbox, resumed: this.resumed, trigger: this.trigger, startedAt: this.started.get(n.id)! };
      let r: StepResult;
      try { r = await runStep(this.h.env, n, call); }
      catch (e) {
        const er = (e as { error?: { code?: string; message?: string } }).error;
        this.error = { code: er?.code ?? "step.failed", message: er?.message ?? (e as Error).message };
        this.state = "failed";
        return this;
      }
      this.resumed = false;
      if (r.wait) { this.wait = r.wait; this.state = "waiting"; return this; }
      this.trail.push(n.id);
      this.outputs[n.id] = r.output;
      this.cur = r.next === undefined ? this.plan[idx + 1]?.id : r.next ?? undefined;
    }
    if (this.cur === undefined && this.state === "running") this.state = "succeeded";
    return this;
  }
  /** An event arrives: a cancel-on event ends the Run, the event the wait is for resumes it. */
  async event(type: string, payload: Record<string, unknown> = {}): Promise<this> {
    const w = this.wait;
    if (this.state !== "waiting" || !w) return this;
    if (w.cancelOn?.includes(type)) { this.state = "canceled"; this.wait = undefined; return this; }
    if (w.event && w.event.event === type) {
      const f = w.event.filter as Record<string, unknown> | undefined;
      if (!f || Object.entries(f).every(([k, v]) => JSON.stringify(payload[k]) === JSON.stringify(v))) return this.resume();
    }
    return this;
  }
  /** The clock moved: a wait whose time or timeout has come resumes. */
  async tick(): Promise<this> {
    const w = this.wait;
    if (this.state !== "waiting" || !w) return this;
    const now = this.h.now();
    if ((w.at !== undefined && now >= w.at) || (w.timeoutAt !== undefined && now >= w.timeoutAt)) return this.resume();
    return this;
  }
  /** Resume after something outside decided (an approval was acted on). */
  async resume(): Promise<this> {
    this.state = "running";
    this.wait = undefined;
    this.resumed = true;
    return this.run();
  }
}
