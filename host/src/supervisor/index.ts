// The supervisor (ARCH 1.2, spec 4.18): keeps the daemon's services up. A service is a unit with a start function; when it exits without being stopped, the supervisor restarts it after a backoff
// until it has crashed `maxRestarts` times inside `windowMs`, then marks it failed (down) and leaves it for a person (Console, Infrastructure, Services, Restart). Every state change is reported so
// health_service always shows what is running. A restart asked for in Console arrives through `restart(name)`.
import { spawn } from "node:child_process";
import type { Logger } from "../../../packages/contracts/src/ctx.ts";

export interface UnitExit { code?: number | null; signal?: string | null; error?: string }
export interface RunningUnit {
  /** stop the unit and resolve once it is gone */
  stop(): Promise<void>;
  /** resolves when the unit ends by itself or after stop() */
  exited: Promise<UnitExit>;
}
export interface RestartPolicy {
  /** more crashes than this inside windowMs marks the service failed */
  maxRestarts: number;
  windowMs: number;
  /** wait before restart n (1-based); the last value repeats */
  backoffMs: readonly number[];
}
export const DEFAULT_POLICY: RestartPolicy = { maxRestarts: 5, windowMs: 60_000, backoffMs: [200, 1000, 5000] };

export interface ServiceSpec {
  name: string;
  start(): Promise<RunningUnit>;
  policy?: Partial<RestartPolicy>;
}

export type ServiceState = "healthy" | "degraded" | "down";
export type Phase = "idle" | "starting" | "running" | "backoff" | "stopped" | "failed";
export interface ServiceStatus {
  name: string;
  phase: Phase;
  state: ServiceState;
  startedAt: number;
  restarts: number;
  lastExit?: UnitExit;
}

export interface SupervisorOptions {
  now?: () => number;
  /** wait; tests pass an instant one */
  sleep?: (ms: number) => Promise<void>;
  /** called on every state change (the daemon writes health_service) */
  report?: (s: ServiceStatus) => void;
  log?: Logger;
}

interface Entry {
  spec: ServiceSpec;
  policy: RestartPolicy;
  unit: RunningUnit | null;
  phase: Phase;
  startedAt: number;
  restarts: number;
  crashes: number[];
  lastExit?: UnitExit;
  /** bumped on every start and stop so a late exit of an old unit is ignored */
  gen: number;
}

const stateOf = (p: Phase): ServiceState => (p === "running" ? "healthy" : p === "failed" || p === "stopped" ? "down" : "degraded");

export class Supervisor {
  private entries = new Map<string, Entry>();
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private report: (s: ServiceStatus) => void;
  private log: Logger | undefined;

  constructor(o: SupervisorOptions = {}) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref(); }));
    this.report = o.report ?? (() => {});
    this.log = o.log;
  }

  add(spec: ServiceSpec): void {
    if (this.entries.has(spec.name)) throw new Error(`service ${spec.name} is already registered`);
    this.entries.set(spec.name, { spec, policy: { ...DEFAULT_POLICY, ...spec.policy }, unit: null, phase: "idle", startedAt: this.now(), restarts: 0, crashes: [], gen: 0 });
  }

  has(name: string): boolean { return this.entries.has(name); }
  names(): string[] { return [...this.entries.keys()]; }

  status(name?: string): ServiceStatus[] {
    return [...this.entries.values()].filter((e) => !name || e.spec.name === name).map((e) => this.snapshot(e));
  }

  private snapshot(e: Entry): ServiceStatus {
    return { name: e.spec.name, phase: e.phase, state: stateOf(e.phase), startedAt: e.startedAt, restarts: e.restarts, ...(e.lastExit ? { lastExit: e.lastExit } : {}) };
  }

  private set(e: Entry, phase: Phase): void {
    e.phase = phase;
    try { this.report(this.snapshot(e)); } catch (err) { this.log?.warn("supervisor.report_failed", { service: e.spec.name, error: err instanceof Error ? err.message : String(err) }); }
  }

  private get(name: string): Entry {
    const e = this.entries.get(name);
    if (!e) throw new Error(`no such service: ${name}`);
    return e;
  }

  /** Start a service that is not running. Resolves when the first start has finished (or failed into backoff). */
  async start(name: string): Promise<void> {
    const e = this.get(name);
    if (e.phase === "running" || e.phase === "starting") return;
    e.crashes = [];
    await this.launch(e);
  }

  async startAll(): Promise<void> {
    for (const name of this.entries.keys()) await this.start(name);
  }

  private async launch(e: Entry): Promise<void> {
    const gen = ++e.gen;
    this.set(e, "starting");
    let unit: RunningUnit;
    try {
      unit = await e.spec.start();
    } catch (err) {
      if (e.gen !== gen) return;
      await this.onExit(e, gen, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (e.gen !== gen) { await unit.stop().catch(() => {}); return; }   // stopped while starting
    e.unit = unit;
    e.startedAt = this.now();
    this.set(e, "running");
    void unit.exited.then((x) => this.onExit(e, gen, x), (err: unknown) => this.onExit(e, gen, { error: err instanceof Error ? err.message : String(err) }));
  }

  private async onExit(e: Entry, gen: number, exit: UnitExit): Promise<void> {
    if (e.gen !== gen) return;   // we stopped it, or a newer unit replaced it
    e.unit = null;
    e.lastExit = exit;
    const t = this.now();
    e.crashes = e.crashes.filter((c) => t - c < e.policy.windowMs);
    e.crashes.push(t);
    this.log?.warn("supervisor.exit", { service: e.spec.name, code: exit.code ?? null, error: exit.error ?? null, crashes: e.crashes.length });
    if (e.crashes.length > e.policy.maxRestarts) { e.gen++; this.set(e, "failed"); return; }
    this.set(e, "backoff");
    const wait = e.policy.backoffMs[Math.min(e.crashes.length, e.policy.backoffMs.length) - 1] ?? 0;
    await this.sleep(wait);
    if (e.gen !== gen) return;   // stopped or restarted by hand while waiting
    e.restarts++;
    await this.launch(e);
  }

  /** Stop a service and keep it stopped until start() or restart(). */
  async stop(name: string): Promise<void> {
    const e = this.get(name);
    e.gen++;
    const unit = e.unit;
    e.unit = null;
    if (unit) await unit.stop().catch((err: unknown) => this.log?.warn("supervisor.stop_failed", { service: name, error: err instanceof Error ? err.message : String(err) }));
    if (e.phase !== "idle") this.set(e, "stopped");
  }

  async stopAll(): Promise<void> {
    for (const name of [...this.entries.keys()].reverse()) await this.stop(name);
  }

  /** The restart a person asked for: stop, start, count it, clear the crash history. */
  async restart(name: string): Promise<ServiceStatus> {
    const e = this.get(name);
    await this.stop(name);
    e.crashes = [];
    e.restarts++;
    await this.launch(e);
    return this.snapshot(e);
  }
}

// ---- units

export interface ProcessUnitOptions {
  env?: Record<string, string>;
  cwd?: string;
  /** signal sent first, default SIGTERM */
  signal?: NodeJS.Signals;
  /** SIGKILL after this long, default 5000 */
  killAfterMs?: number;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}

/** A unit that is a child process (Caddy, a sidecar). `exited` resolves when the process ends. */
export function processUnit(cmd: string, args: readonly string[], o: ProcessUnitOptions = {}): () => Promise<RunningUnit> {
  return () => new Promise<RunningUnit>((resolve, reject) => {
    const child = spawn(cmd, [...args], { env: { ...process.env, ...o.env }, ...(o.cwd ? { cwd: o.cwd } : {}), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let done = false;
    const exited = new Promise<UnitExit>((res) => {
      child.once("exit", (code, signal) => { done = true; res({ code, signal }); });
      child.once("error", (err) => { done = true; res({ error: err.message }); });
    });
    child.stdout?.on("data", (d: Buffer) => o.onOutput?.("stdout", d.toString()));
    child.stderr?.on("data", (d: Buffer) => o.onOutput?.("stderr", d.toString()));
    child.once("spawn", () => resolve({
      exited,
      async stop() {
        if (done) return;
        child.kill(o.signal ?? "SIGTERM");
        const timer = setTimeout(() => { if (!done) child.kill("SIGKILL"); }, o.killAfterMs ?? 5000);
        timer.unref();
        await exited;
        clearTimeout(timer);
      },
    }));
    child.once("error", (err) => reject(err));
  });
}
