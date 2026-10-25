// Fake Docker, Caddy and DNS drivers for sites tests. They record every call so a test can assert what reached the router and the runtime.

import type { BuildRequest, BuildResult, CertState, RouteSpec, SiteDns, SiteDrivers, SiteRouter, SiteRuntime, StartRequest, StartResult } from "../handlers/deploy.ts";

export const SPACE_DOMAIN = "acme.vyre.run";

export class FakeRuntime implements SiteRuntime {
  builds: BuildRequest[] = [];
  starts: StartRequest[] = [];
  stops: string[] = [];
  running = new Map<string, StartRequest>();
  /** per branch: how the next build ends; default is a good build */
  outcomes = new Map<string, Partial<BuildResult>>();
  failStart: string | null = null;
  containerLogs: string[] = ["container: listening on 3000"];
  private seq = 0;

  async build(req: BuildRequest): Promise<BuildResult> {
    this.builds.push(req);
    const planned = this.outcomes.get(req.branch);
    if (planned && planned.ok === false) return { ok: false, log: planned.log ?? ["build failed"] };
    this.seq += 1;
    const out: BuildResult = { ok: true, image: `vyre-site/${req.siteId}:${this.seq}`, commit: `c0ffee${String(this.seq).padStart(2, "0")}`, log: planned?.log ?? [`building ${req.branch}`, "done"] };
    if (planned?.pullRequest !== undefined) out.pullRequest = planned.pullRequest;
    return out;
  }

  async start(req: StartRequest): Promise<StartResult> {
    if (this.failStart) throw new Error(this.failStart);
    this.starts.push(req);
    this.seq += 1;
    const containerId = `ctr_${this.seq}`;
    this.running.set(containerId, req);
    return { containerId, upstream: `${req.name}:3000` };
  }

  async stop(containerId: string): Promise<void> {
    this.stops.push(containerId);
    this.running.delete(containerId);
  }

  async logs(_containerId: string, tail: number): Promise<string[]> {
    return this.containerLogs.slice(-tail);
  }
}

export class FakeRouter implements SiteRouter {
  routes = new Map<string, RouteSpec>();
  history: string[] = [];
  certs = new Map<string, CertState>();

  async setRoute(spec: RouteSpec): Promise<void> {
    this.routes.set(spec.host, spec);
    this.history.push(`set ${spec.host}`);
  }

  async removeRoute(host: string): Promise<void> {
    this.routes.delete(host);
    this.history.push(`remove ${host}`);
  }

  async certState(host: string): Promise<CertState> {
    return this.certs.get(host) ?? "pending";
  }
}

export class FakeDns implements SiteDns {
  good = new Set<string>();
  checks: { domain: string; target: string }[] = [];

  async check(domain: string, target: string): Promise<boolean> {
    this.checks.push({ domain, target });
    return this.good.has(domain);
  }
}

export function fakeDrivers(): { drivers: SiteDrivers; runtime: FakeRuntime; router: FakeRouter; dns: FakeDns } {
  const runtime = new FakeRuntime();
  const router = new FakeRouter();
  const dns = new FakeDns();
  return { drivers: { runtime, router, dns, spaceDomain: SPACE_DOMAIN }, runtime, router, dns };
}
