// Site metrics (r42-sites-run, slice 4): CPU, memory, requests and response time, one sample a minute, kept for a day.
// Pure code: Docker's stats JSON in, samples out; the request meter counts what the ingress logged. The sampler (sampler.ts) and the store call these.

/** What `GET /containers/<id>/stats?stream=false` returns, the fields used. */
export interface DockerStats {
  read?: string;
  cpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> };
}

export interface Usage {
  /** percent of ONE cpu, so 100 is one full core and 250 is two and a half */
  cpu: number;
  memMb: number;
  memLimitMb: number;
}

const MB = 1024 * 1024;
/** Memory a person means: what the app holds, not the file cache the kernel lends it (Docker's own `stats` command subtracts it the same way). */
export function memoryOf(s: DockerStats): { used: number; limit: number } {
  const m = s.memory_stats;
  const usage = m?.usage ?? 0;
  const cache = m?.stats?.["inactive_file"] ?? m?.stats?.["total_inactive_file"] ?? m?.stats?.["cache"] ?? 0;
  return { used: Math.max(0, usage - (cache < usage ? cache : 0)), limit: m?.limit ?? 0 };
}

/** CPU percent between two readings inside one stats answer (Docker sends the earlier one as precpu_stats). Zero when the answer has no earlier reading. */
export function usageOf(s: DockerStats): Usage | null {
  const cur = s.cpu_stats?.cpu_usage?.total_usage;
  const sys = s.cpu_stats?.system_cpu_usage;
  if (typeof cur !== "number" || typeof sys !== "number") return null;
  const pre = s.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const preSys = s.precpu_stats?.system_cpu_usage ?? 0;
  const dCpu = cur - pre;
  const dSys = sys - preSys;
  const cpus = s.cpu_stats?.online_cpus ?? 1;
  const cpu = dSys > 0 && dCpu >= 0 && preSys > 0 ? (dCpu / dSys) * cpus * 100 : 0;
  const mem = memoryOf(s);
  return {
    cpu: Math.round(cpu * 10) / 10,
    memMb: Math.round((mem.used / MB) * 10) / 10,
    memLimitMb: Math.round(mem.limit / MB),
  };
}

export interface Sample {
  /** the minute this covers, ms since the epoch, at the start of the minute */
  at: number;
  cpu: number;
  memMb: number;
  requests: number;
  errors: number;
  /** median and 95th percentile response time in ms, 0 when there were no requests */
  p50: number;
  p95: number;
}

export const MINUTE = 60_000;
export const KEEP_MINUTES = 24 * 60;
export const minuteOf = (t: number): number => Math.floor(t / MINUTE) * MINUTE;

/** The percentile of a list (nearest rank); 0 for an empty list. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i] as number;
}

/** Counts the requests of one site inside one minute. Bounded: at most MAX_TIMES response times are kept (a reservoir), the counts stay exact. */
export const MAX_TIMES = 2000;
export class RequestMeter {
  private minute = 0;
  private requests = 0;
  private errors = 0;
  private times: number[] = [];
  private seen = 0;
  /** rolls to a new minute when t is in one; returns the finished minute's totals (null when none was open or t is not later) */
  record(
    t: number,
    status: number,
    ms: number,
  ): { at: number; requests: number; errors: number; p50: number; p95: number } | null {
    const m = minuteOf(t);
    let done: ReturnType<RequestMeter["record"]> = null;
    if (this.minute !== 0 && m > this.minute) {
      done = this.take();
    }
    if (m < this.minute) return done; // a late line for a minute already closed is not counted twice
    this.minute = m;
    this.requests++;
    if (status >= 500) this.errors++;
    this.seen++;
    if (this.times.length < MAX_TIMES) this.times.push(ms);
    else {
      // reservoir: a deterministic replace keeps the memory fixed without a random source
      this.times[this.seen % MAX_TIMES] = ms;
    }
    return done;
  }
  /** Close the open minute (the sampler calls it when the minute is over and nothing newer arrived). */
  take(): { at: number; requests: number; errors: number; p50: number; p95: number } | null {
    if (this.minute === 0) return null;
    const out = {
      at: this.minute,
      requests: this.requests,
      errors: this.errors,
      p50: Math.round(percentile(this.times, 50)),
      p95: Math.round(percentile(this.times, 95)),
    };
    this.minute = 0;
    this.requests = 0;
    this.errors = 0;
    this.times = [];
    this.seen = 0;
    return out;
  }
  get open(): number {
    return this.minute;
  }
}

/** A Caddy access-log line (JSON), reduced to what a site's page needs. Null for any line that is not a finished request with a host. */
export interface Access {
  at: number;
  host: string;
  method: string;
  uri: string;
  status: number;
  ms: number;
  bytes: number;
}
export function parseAccess(line: string): Access | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o === null || typeof o !== "object") return null;
  const r = o as {
    ts?: number;
    status?: number;
    duration?: number;
    size?: number;
    request?: { host?: string; method?: string; uri?: string };
  };
  if (typeof r.ts !== "number" || typeof r.status !== "number" || typeof r.request?.host !== "string") return null;
  const host = r.request.host.toLowerCase().replace(/:\d+$/, "");
  return {
    at: Math.round(r.ts * 1000),
    host,
    method: String(r.request.method ?? "GET").slice(0, 10),
    uri: String(r.request.uri ?? "/").slice(0, 300),
    status: r.status,
    ms: Math.round((r.duration ?? 0) * 1000),
    bytes: typeof r.size === "number" ? r.size : 0,
  };
}

/** The line a Requests log shows: `GET /path 200 12ms`. A query string never reaches the log (it can carry a token). */
export function requestLine(a: Access): string {
  const path = a.uri.split("?")[0] ?? "/";
  return `${a.method} ${path} ${a.status} ${a.ms}ms`;
}

/** The newest `n` samples, filling a gap with nothing so a chart shows a quiet hour as quiet, not as a joined line. Oldest first. */
export function window(samples: readonly Sample[], now: number, minutes: number): (Sample | null)[] {
  const end = minuteOf(now);
  const by = new Map<number, Sample>();
  for (const s of samples) by.set(s.at, s);
  const out: (Sample | null)[] = [];
  for (let i = minutes - 1; i >= 0; i--) out.push(by.get(end - i * MINUTE) ?? null);
  return out;
}

/** Fewer points for a chart: `points` buckets over the window, each the mean CPU and memory, the summed requests and errors, the worst 95th percentile. */
export function bucketed(win: readonly (Sample | null)[], points: number): (Sample | null)[] {
  if (points >= win.length) return [...win];
  const size = win.length / points;
  const out: (Sample | null)[] = [];
  for (let i = 0; i < points; i++) {
    const part = win.slice(Math.floor(i * size), Math.floor((i + 1) * size)).filter((x): x is Sample => x !== null);
    if (part.length === 0) {
      out.push(null);
      continue;
    }
    const n = part.length;
    out.push({
      at: part[0]!.at,
      cpu: Math.round((part.reduce((a, s) => a + s.cpu, 0) / n) * 10) / 10,
      memMb: Math.round((part.reduce((a, s) => a + s.memMb, 0) / n) * 10) / 10,
      requests: part.reduce((a, s) => a + s.requests, 0),
      errors: part.reduce((a, s) => a + s.errors, 0),
      p50: Math.round(part.reduce((a, s) => a + s.p50, 0) / n),
      p95: Math.max(...part.map((s) => s.p95)),
    });
  }
  return out;
}

/** The "Right now" cards: the newest sample against what the site is allowed, in the words a person reads. */
export interface RightNow {
  cpu: { value: number; of: number };
  mem: { valueMb: number; ofMb: number };
  requestsPerMin: number;
  p95: number;
  errorRate: number;
}
export function rightNow(latest: Sample | null, limits: { cpus: number; memoryMb: number }): RightNow {
  const s = latest;
  return {
    cpu: { value: s?.cpu ?? 0, of: limits.cpus * 100 },
    mem: { valueMb: s?.memMb ?? 0, ofMb: limits.memoryMb },
    requestsPerMin: s?.requests ?? 0,
    p95: s?.p95 ?? 0,
    errorRate: s && s.requests > 0 ? Math.round((s.errors / s.requests) * 1000) / 10 : 0,
  };
}
