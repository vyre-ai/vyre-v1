// What a running site leaves behind (r42-sites-run, slice 4): its output as stored log lines, its CPU and memory a minute at a time, its request counts.
// `Collector.tick` is called every couple of seconds by the host's scheduler. It never throws: a Docker call that fails leaves the cursor where it was and the next tick asks again.
import { LogFollower } from "./logs.ts";
import type { LogSource } from "./logs.ts";
import { RequestMeter, minuteOf, parseAccess, requestLine, usageOf } from "./metrics.ts";
import type { Access, DockerStats } from "./metrics.ts";
import * as st from "./store.ts";
import type { OpsDb } from "./store.ts";

/** The part of the sites runner the collector uses. */
export interface CollectRunner {
  logsSince(containerId: string, sinceSec: number): Promise<string[]>;
  stats(containerId: string): Promise<DockerStats | null>;
}

/** One container whose output is kept: the site's own app, a worker, or a job run. */
export interface Target {
  siteId: string;
  /** what its lines belong to: the deployment id for the app, the service id, the run id */
  scope: string;
  source: LogSource;
  containerId: string;
  /** adds to the site's CPU and memory (the app and its workers do; a job run does not) */
  counts: boolean;
}

export interface CollectDeps {
  db: OpsDb;
  runner(): CollectRunner | null;
  now(): number;
  /** the site a host name belongs to, or null (a request for any other host is ignored) */
  siteOfHost(host: string): string | null;
}

const POLL_MS = 1500;
/** A busy site lists this many requests a round; the counts in the charts stay exact. */
export const REQUEST_LINES_PER_ROUND = 500;
const HOUSEKEEPING_MS = 10 * 60_000;
const PARALLEL = 4;

/** The containers to follow now: each site's serving container, its running workers, and its job runs in progress. */
export function targets(db: OpsDb): Target[] {
  const out: Target[] = [];
  for (const r of db.all(
    "SELECT id, container_id, current_deployment FROM sites_site WHERE deleted_at IS NULL AND container_id IS NOT NULL",
  ) as Record<string, unknown>[])
    out.push({
      siteId: String(r["id"]),
      scope: r["current_deployment"] ? String(r["current_deployment"]) : String(r["id"]),
      source: "app",
      containerId: String(r["container_id"]),
      counts: true,
    });
  for (const v of st.listServices(db))
    if (v.containerId && (v.state === "starting" || v.state === "running"))
      out.push({ siteId: v.siteId, scope: v.id, source: "app", containerId: v.containerId, counts: true });
  for (const r of st.openRuns(db))
    if (r.containerId && r.state === "running")
      out.push({ siteId: r.siteId, scope: r.id, source: "jobs", containerId: r.containerId, counts: false });
  return out;
}

export class Collector {
  private d: CollectDeps;
  private followers = new Map<string, { f: LogFollower; at: number; items: { at: number; text: string }[] }>();
  /** request lines wait here and are written together each round, so a busy site is one insert batch, not one write a request */
  private pending = new Map<string, { lines: { at: number; text: string }[]; lost: number }>();
  private meters = new Map<string, RequestMeter>();
  private usageMinute = new Map<string, number>();
  private housekept = 0;
  private busy = false;
  constructor(d: CollectDeps) {
    this.d = d;
  }

  /** A line of the ingress's access log. A request for a host that is no site's, or a line that is not a finished request, is ignored. */
  access(line: string): void {
    const a = parseAccess(line);
    if (!a) return;
    const siteId = this.d.siteOfHost(a.host);
    if (!siteId) return;
    this.recordRequest(siteId, a);
  }

  recordRequest(siteId: string, a: Access): void {
    let m = this.meters.get(siteId);
    if (!m) {
      m = new RequestMeter();
      this.meters.set(siteId, m);
    }
    const closed = m.record(a.at, a.status, a.ms);
    if (closed) st.putRequests(this.d.db, siteId, closed.at, closed);
    let p = this.pending.get(siteId);
    if (!p) {
      p = { lines: [], lost: 0 };
      this.pending.set(siteId, p);
    }
    if (p.lines.length < REQUEST_LINES_PER_ROUND) p.lines.push({ at: a.at, text: requestLine(a) });
    else p.lost++;
  }

  private flushRequests(now: number): void {
    for (const [siteId, p] of this.pending) {
      if (p.lost > 0)
        p.lines.push({ at: now, text: `... ${p.lost} more ${p.lost === 1 ? "request" : "requests"} not listed` });
      if (p.lines.length > 0) st.addLogs(this.d.db, siteId, "requests", "requests", p.lines);
    }
    this.pending.clear();
  }

  /** One round. A second call while one is running returns at once. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.d.now();
      const all = targets(this.d.db);
      const live = new Set(all.map((t) => t.containerId));
      for (const k of [...this.followers.keys()]) if (!live.has(k)) this.followers.delete(k);
      await each(all, PARALLEL, (t) => this.follow(t, now));
      await this.sample(all, now);
      this.flushMeters(now);
      this.flushRequests(now);
      if (now - this.housekept > HOUSEKEEPING_MS) {
        this.housekept = now;
        this.housekeep(all);
      }
    } catch {
      /* the next round asks again */
    } finally {
      this.busy = false;
    }
  }

  /** Read what a container printed since the last read now (a job's last lines, before its container is removed). */
  async drain(t: Target): Promise<void> {
    await this.follow(t, this.d.now(), true);
  }

  private async follow(t: Target, now: number, force = false): Promise<void> {
    const r = this.d.runner();
    if (!r) return;
    let w = this.followers.get(t.containerId);
    if (!w) {
      const items: { at: number; text: string }[] = [];
      const f = new LogFollower(
        { read: (since) => r.logsSince(t.containerId, since), sink: (at, text) => items.push({ at, text }) },
        st.getCursor(this.d.db, t.siteId, t.scope),
      );
      w = { f, at: 0, items };
      this.followers.set(t.containerId, w);
    }
    if (!force && now - w.at < POLL_MS) return;
    w.at = now;
    const items = w.items;
    try {
      await w.f.poll();
    } catch {
      return;
    }
    if (items.length > 0) {
      st.addLogs(this.d.db, t.siteId, t.scope, t.source, items.splice(0, items.length));
      st.setCursor(this.d.db, t.siteId, t.scope, w.f.cursor.ns);
    }
  }

  /** Once a minute per site: the CPU and memory of everything of the site that counts, added up. */
  private async sample(all: readonly Target[], now: number): Promise<void> {
    const r = this.d.runner();
    if (!r) return;
    const minute = minuteOf(now);
    const bySite = new Map<string, Target[]>();
    for (const t of all)
      if (t.counts && (this.usageMinute.get(t.siteId) ?? 0) < minute)
        bySite.set(t.siteId, [...(bySite.get(t.siteId) ?? []), t]);
    await each([...bySite.entries()], PARALLEL, async ([siteId, ts]) => {
      let cpu = 0;
      let mem = 0;
      let any = false;
      for (const t of ts) {
        let u;
        try {
          u = usageOf((await r.stats(t.containerId)) ?? {});
        } catch {
          u = null;
        }
        if (!u) continue;
        any = true;
        cpu += u.cpu;
        mem += u.memMb;
      }
      if (!any) return;
      this.usageMinute.set(siteId, minute);
      st.putUsage(this.d.db, siteId, minute, { cpu: Math.round(cpu * 10) / 10, memMb: Math.round(mem * 10) / 10 });
    });
  }

  /** A minute of requests is written once the next minute has begun, or when nothing came for a minute. */
  private flushMeters(now: number): void {
    for (const [siteId, m] of this.meters)
      if (m.open !== 0 && m.open < minuteOf(now)) {
        const c = m.take();
        if (c) st.putRequests(this.d.db, siteId, c.at, c);
      }
  }

  private housekeep(all: readonly Target[]): void {
    for (const siteId of new Set(all.map((t) => t.siteId))) {
      st.trimScopes(this.d.db, siteId);
      st.trimSite(this.d.db, siteId);
    }
  }
}

/** `fn` over `xs`, at most `n` at a time; one that throws does not stop the rest. */
export async function each<T>(xs: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const lane = async (): Promise<void> => {
    while (i < xs.length) {
      const x = xs[i++] as T;
      try {
        await fn(x);
      } catch {
        /* one failing container does not stop the others */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, lane));
}
