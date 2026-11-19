// Keeps a site's workers up and runs its scheduled jobs (r42-sites-run, slice 5). `Supervisor.tick` is called every couple of seconds with the collector's tick; it holds no state of its own that a restart would lose:
// every change goes through the state machines (workers.ts, jobs.ts) and is saved on the row it belongs to, and the containers are found again by the ids on those rows.
//   workers  a row in `starting` with no container is started; one in `starting` or `running` whose container stopped crashed (backoff or failed, as workers.ts says); one in `stopped`, `backoff` or `failed` with a
//            container has it removed; one that runs an older deploy's image is restarted on the newest
//   jobs     the schedule makes at most one run per tick (jobs.ts, tick); queued runs start under the caps; a running run ends when its container does, when it runs past its limit, or is cancelled; a run whose
//            container is gone after a restart is interrupted
// A job or a worker runs in the site's own image with the environment the site's running container already has: the Vault is never read again outside a person's call.
import { recover, startable, step, tick as jobTick, KEEP_RUNS, prune } from "./jobs.ts";
import type { Job, Run, RunEvent } from "./jobs.ts";
import { advance } from "./workers.ts";
import type { Service, ServiceEvent } from "./workers.ts";
import * as st from "./store.ts";
import type { OpsDb } from "./store.ts";
import { each } from "./collect.ts";
import type { Target } from "./collect.ts";

export interface SuperRunner {
  state(containerId: string): Promise<{ running: boolean; exitCode?: number; oom?: boolean } | null>;
  startProcess(a: {
    siteId: string;
    id: string;
    kind: "service" | "job";
    image: string;
    cmd: string[];
    env: Record<string, string>;
    limits: { cpus: number; memoryMb: number };
  }): Promise<{ containerId: string; name: string; note?: string }>;
  remove(containerId: string): Promise<void>;
  envOf(containerId: string): Promise<Record<string, string> | null>;
}

export interface SuperDeps {
  db: OpsDb;
  runner(): SuperRunner | null;
  now(): number;
  /** reads what a job's container printed last, before the container is removed */
  drain(t: Target): Promise<void>;
  /** a new id with a prefix */
  id(prefix: string): string;
}

/** What a site runs on now: its serving container (for the environment), its newest image, and its limits. Null when it is not running. */
export interface SiteContext {
  siteId: string;
  containerId: string;
  deploymentId: string;
  image: string;
  limits: { cpus: number; memoryMb: number };
}

export function siteContext(db: OpsDb, siteId: string): SiteContext | null {
  const r = (
    db.all(
      "SELECT id, container_id, current_deployment, limits FROM sites_site WHERE id = ? AND deleted_at IS NULL AND container_id IS NOT NULL",
      siteId,
    ) as Record<string, unknown>[]
  )[0];
  if (!r || !r["current_deployment"]) return null;
  const d = (
    db.all("SELECT image FROM sites_deployment WHERE id = ?", r["current_deployment"]) as Record<string, unknown>[]
  )[0];
  if (!d?.["image"]) return null;
  let lim: { cpus?: number; memoryMb?: number } = {};
  try {
    lim = typeof r["limits"] === "string" ? JSON.parse(r["limits"]) : {};
  } catch {
    /* the default stands */
  }
  return {
    siteId,
    containerId: String(r["container_id"]),
    deploymentId: String(r["current_deployment"]),
    image: String(d["image"]),
    limits: { cpus: lim.cpus ?? 1, memoryMb: lim.memoryMb ?? 512 },
  };
}

const PARALLEL = 4;
const NO_SITE = "The site is not running, so this could not start. Deploy it first.";

export class Supervisor {
  private d: SuperDeps;
  private busy = false;
  constructor(d: SuperDeps) {
    this.d = d;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = this.d.runner();
      if (!r) return;
      const ctxOf = new Map<string, SiteContext | null>();
      const ctx = (siteId: string): SiteContext | null => {
        if (!ctxOf.has(siteId)) ctxOf.set(siteId, siteContext(this.d.db, siteId));
        return ctxOf.get(siteId) ?? null;
      };
      await each(st.listServices(this.d.db), PARALLEL, (v) => this.service(r, v, ctx(v.siteId)));
      await this.jobs(r, ctx);
    } catch {
      /* the next tick goes on from what was saved */
    } finally {
      this.busy = false;
    }
  }

  // ---- workers

  private apply(v: Service, ev: ServiceEvent, containerId?: string | null): Service {
    const out = advance(v, ev).service;
    st.saveService(this.d.db, out, containerId);
    return out;
  }

  private async service(r: SuperRunner, v0: st.ServiceRow, site: SiteContext | null): Promise<void> {
    const now = this.d.now();
    let v: Service = v0;
    let cid = v0.containerId ?? null;
    // a service that should not run has no container
    if ((v.state === "stopped" || v.state === "backoff" || v.state === "failed") && cid) {
      await r.remove(cid).catch(() => undefined);
      st.saveService(this.d.db, v, null);
      cid = null;
    }
    // it stopped by itself: that is a crash
    if ((v.state === "starting" || v.state === "running") && cid) {
      const s = await r.state(cid);
      if (!s || !s.running) {
        await r.remove(cid).catch(() => undefined);
        v = this.apply(v, { t: "exited", at: now, code: s?.exitCode ?? 255, ...(s?.oom ? { oom: true } : {}) }, null);
        cid = null;
      }
    }
    // a newer deploy: restart on its image
    if (
      (v.state === "starting" || v.state === "running") &&
      cid &&
      site &&
      v0.deploymentId &&
      v0.deploymentId !== site.deploymentId
    ) {
      await r.remove(cid).catch(() => undefined);
      v = this.apply(v, { t: "restart", at: now }, null);
      cid = null;
    }
    v = advance(v, { t: "tick", at: now }).service;
    // backoff over, or just wanted: start it
    if (v.state === "starting" && !cid) {
      if (!site) {
        st.saveService(this.d.db, { ...v, state: "stopped", note: NO_SITE }, null);
        return;
      }
      try {
        const env = (await r.envOf(site.containerId)) ?? {};
        const made = await r.startProcess({
          siteId: v.siteId,
          id: v.id,
          kind: "service",
          image: site.image,
          cmd: v0.command,
          env,
          limits: site.limits,
        });
        v = advance(v, { t: "spawned", at: now }).service;
        st.saveService(this.d.db, v, made.containerId);
        this.d.db.run("UPDATE sites_service SET deployment_id = ? WHERE id = ?", site.deploymentId, v.id);
        return;
      } catch (e) {
        v = advance(v, { t: "spawned", at: now }).service;
        v = advance(v, { t: "exited", at: now, code: 255 }).service;
        st.saveService(
          this.d.db,
          { ...v, note: `It could not start: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` },
          null,
        );
        return;
      }
    }
    st.saveService(this.d.db, v);
  }

  // ---- jobs

  private async jobs(r: SuperRunner, ctx: (siteId: string) => SiteContext | null): Promise<void> {
    const now = this.d.now();
    const db = this.d.db;
    const jobs = new Map(st.listJobs(db).map((j) => [j.id, j]));
    let open = st.openRuns(db);

    // 1. runs that are going: end the ones whose container ended, ran too long, or is gone
    const alive = new Set<string>();
    await each(
      open.filter((x) => x.state === "running" && x.containerId),
      PARALLEL,
      async (x) => {
        const j = jobs.get(x.jobId);
        const s = await r.state(x.containerId as string);
        const t: Target = {
          siteId: x.siteId,
          scope: x.id,
          source: "jobs",
          containerId: x.containerId as string,
          counts: false,
        };
        if (s?.running) {
          alive.add(x.id);
          if (j && x.startedAt !== undefined && now - x.startedAt > j.timeoutSec * 1000) {
            await this.drain(t);
            await r.remove(x.containerId as string).catch(() => undefined);
            this.end(x, { t: "timeout", at: now }, j);
          }
          return;
        }
        if (s) {
          await this.drain(t);
          await r.remove(x.containerId as string).catch(() => undefined);
          this.end(x, { t: "finish", at: now, code: s.exitCode ?? 1 }, j);
        }
      },
    );
    open = st.openRuns(db);
    for (const ev of recover(open, now, alive)) {
      const x = open.find((o) => o.id === ev.id);
      if (x) this.end(x, ev.ev, jobs.get(x.jobId));
    }

    // 2. the schedule
    open = st.openRuns(db);
    for (const j of jobs.values()) {
      const t = jobTick(
        j,
        open.filter((o) => o.jobId === j.id),
        now,
      );
      if (t.job.lastSlot !== j.lastSlot) st.saveJob(db, t.job);
      if (t.create) {
        const run: Run = {
          id: this.d.id("jrx"),
          jobId: j.id,
          state: t.create.state,
          slot: t.create.slot,
          by: "schedule",
          queuedAt: now,
          ...(t.create.state === "skipped" ? { endedAt: now, note: t.create.note } : {}),
        };
        st.insertRun(db, j.siteId, run);
      }
    }

    // 3. queued runs start, under the caps
    open = st.openRuns(db);
    const queued = open.filter((o) => o.state === "queued").map((run) => ({ run, siteId: run.siteId }));
    const running = open.filter((o) => o.state === "running").map((o) => ({ siteId: o.siteId }));
    const may = new Set(startable(queued, running));
    for (const q of queued) {
      if (!may.has(q.run.id)) continue;
      const j = jobs.get(q.run.jobId);
      const site = ctx(q.siteId);
      if (!j) {
        this.end(q.run, { t: "cancel", at: now }, undefined);
        continue;
      }
      if (!site) {
        // no site to run in: wait for it a while, then give up in plain words
        if (now - q.run.queuedAt > 60_000) this.end(q.run, { t: "expire", at: now }, j, NO_SITE);
        continue;
      }
      try {
        const env = (await r.envOf(site.containerId)) ?? {};
        const made = await r.startProcess({
          siteId: q.siteId,
          id: q.run.id,
          kind: "job",
          image: site.image,
          cmd: j.command,
          env,
          limits: site.limits,
        });
        const next = step(q.run, { t: "start", at: now }, j);
        if (next.ok) st.saveRun(db, next.run, "queued", made.containerId);
        else await r.remove(made.containerId).catch(() => undefined);
      } catch (e) {
        this.failToStart(q.run, j, `It could not start: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      }
    }

    // 4. history stays bounded
    for (const j of jobs.values()) {
      const all = st.listRuns(db, j.id, KEEP_RUNS * 4);
      const gone = prune(all);
      if (gone.length > 0) {
        for (const id of gone) st.dropScope(db, j.siteId, id);
        st.deleteRuns(db, gone);
      }
    }
  }

  private async drain(t: Target): Promise<void> {
    try {
      await this.d.drain(t);
    } catch {
      /* the lines the collector already kept stay */
    }
  }

  /** A queued run that could not be started: it goes through running to failed, so the history says it failed and why. */
  private failToStart(x: Run, j: Job, note: string): void {
    const now = this.d.now();
    const a = step(x, { t: "start", at: now }, j);
    if (!a.ok) return;
    const b = step(a.run, { t: "finish", at: now, code: 127 }, j);
    if (b.ok) st.saveRun(this.d.db, { ...b.run, note }, "queued");
  }

  /** The one way a run ends here: the state machine decides, the save only lands if the run is still where it was read. */
  private end(x: Run, ev: RunEvent, j: Job | undefined, note?: string): void {
    const out = step(x, ev, { timeoutSec: j?.timeoutSec ?? 600 });
    if (!out.ok || out.same) return;
    const next = note ? { ...out.run, note } : out.run;
    st.saveRun(this.d.db, next, x.state);
  }
}
