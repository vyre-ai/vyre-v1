// What the sites module needs of the machine (a site is a route): where a target is, whether its port answers, and its log. A computer on a node is reached over the node's own socket; one on this machine by its
// container address. With no computer, a port is on this machine, which is allowed only where the daemon runs on the person's own computer: in a container (a server) that would be vyred's own network.
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { dialPort } from "./port-fetch.ts";
import type { PortRequest, PortSink } from "./port-fetch.ts";

export interface SiteTarget { computerId?: string; port?: number; folderId?: string; container?: string }
export interface SitesHostDeps {
  origin(): { origin: string; relay: boolean } | null;
  /** The host artifacts are served from, apart from the app's origin, or null where none is set up. */
  artifactHost?(): string | null;
  /** the node a computer lives on, or null for this machine */
  nodeOf(computerId: string): string | null;
  /** the container address of a computer on this machine */
  localAddress(computerId: string): Promise<string | null>;
  localLogs(computerId: string, slug: string, lines: number): Promise<string[]>;
  stream: {
    portFetch(nodeId: string, a: { computerId: string; port: number; request: PortRequest }, sink: PortSink): void;
    ask(nodeId: string, kind: string, input: unknown): Promise<unknown>;
    connected(nodeId: string): boolean;
  };
  /** true when this daemon runs in a container */
  contained: boolean;
  artifacts?: { folder(siteId: string, title: string): Promise<string>; put(folderId: string, name: string, base64: string, mime: string): Promise<void> };
  /** a deployed site's own container on this server: its address on the site's network (the sites module's runner answers) */
  containerAddress?(containerId: string): Promise<string | null>;
  /** what the sites module needs to build and run sites here: the Docker socket, values filled from the Vault, the sites' address, and Caddy */
  deploy?: { runnerLink?: { socketPath: string; token(): string }; take(ref: string): string | undefined; tmp?: string; sitesDomain(): string | null; domainOf(siteId: string): string | null; hostRoute(siteId: string, up: boolean): Promise<void> };
}

const MIME: Readonly<Record<string, string>> = { ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf", ".woff2": "font/woff2" };
export const mimeOf = (name: string): string => MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
const LOCAL_MAX = 25 * 1024 * 1024;
const LOCAL_FILES = 200;

/** SiteDns, a plain lookup: does the name reach this machine, by its CNAME or by the address it resolves to? */
export async function dnsPointsAt(domain: string, to: { hostname?: string; ip?: string }, lookup: Pick<typeof dns, "resolveCname" | "resolve4"> = dns): Promise<boolean> {
  if (to.hostname) {
    try { if ((await lookup.resolveCname(domain)).some((c) => c.toLowerCase().replace(/\.$/, "") === (to.hostname as string).toLowerCase())) return true; } catch { /* no CNAME: an address may still match */ }
  }
  let mine: string[] = to.ip ? [to.ip] : [];
  if (to.hostname) { try { mine = [...mine, ...(await lookup.resolve4(to.hostname))]; } catch { /* the name has no address */ } }
  if (mine.length === 0) return false;
  try { return (await lookup.resolve4(domain)).some((a) => mine.includes(a)); } catch { return false; }
}

/** Is this address reachable from the internet? A node behind NAT shows a private peer address, and that says it has no public one. */
export const publicIp = (a: string | null | undefined): string | null => {
  const ip = (a ?? "").replace(/^::ffff:/, "");
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? ip : null;
};

export interface EdgeRouter { setRoute(a: { host: string; upstream: string; auth: null }): Promise<void>; removeRoute(host: string): Promise<void>; certState(host: string): Promise<"pending" | "issued" | "failed"> }

/**
 * Custom domains: Caddy on the machine that runs the site. On this machine that is the Space's own Caddy; on a node the question goes over its socket. Container addresses change when a computer restarts, so
 * the daemon writes these routes again on a timer.
 */
export function createDomainEdge(d: SitesHostDeps & { router: EdgeRouter | null; peerAddress(nodeId: string): string | null }) {
  const local = (t: SiteTarget): boolean => t.computerId === undefined || d.nodeOf(t.computerId) === null;
  const upstream = async (t: SiteTarget, port: number): Promise<string> => {
    const address = t.computerId ? await d.localAddress(t.computerId) : "host.docker.internal";
    if (!address) throw new Error("The computer it runs on is asleep.");
    return `${address}:${port}`;
  };
  return {
    public: async (t: SiteTarget): Promise<{ hostname?: string; ip?: string } | null> => {
      if (!local(t)) { const ip = publicIp(d.peerAddress(d.nodeOf(t.computerId as string) as string)); return ip ? { ip } : null; }
      const o = d.origin();
      if (!o || o.relay || !d.router) return null;
      return { hostname: new URL(o.origin).hostname };
    },
    dnsOk: (domain: string, to: { hostname?: string; ip?: string }) => dnsPointsAt(domain, to),
    setRoute: async (t: SiteTarget, domain: string, port: number): Promise<void> => {
      if (local(t)) { if (!d.router) throw new Error("This server has no Caddy."); await d.router.setRoute({ host: domain, upstream: await upstream(t, port), auth: null }); return; }
      await d.stream.ask(d.nodeOf(t.computerId as string) as string, "edge", { op: "set", computerId: t.computerId, domain, port });
    },
    removeRoute: async (t: SiteTarget, domain: string): Promise<void> => {
      if (local(t)) { await d.router?.removeRoute(domain); return; }
      await d.stream.ask(d.nodeOf(t.computerId as string) as string, "edge", { op: "remove", domain });
    },
    certIssued: async (t: SiteTarget, domain: string): Promise<boolean> => {
      if (local(t)) return (await d.router?.certState(domain)) === "issued";
      return (await d.stream.ask(d.nodeOf(t.computerId as string) as string, "edge", { op: "cert", domain })) === "issued";
    },
  };
}

export function createSitesHost(d: SitesHostDeps) {
  async function fetchTarget(t: SiteTarget, request: PortRequest, sink: PortSink): Promise<void> {
    if (t.port === undefined) { sink.fail("It has no port."); return; }
    if (t.container !== undefined) {
      const address = d.containerAddress ? await d.containerAddress(t.container).catch(() => null) : null;
      if (!address) { sink.fail("The app is not running. Deploy it again."); return; }
      dialPort(address, t.port, request, sink);
      return;
    }
    if (t.computerId === undefined) {
      if (d.contained) { sink.fail("A port needs a computer on a server."); return; }
      dialPort("127.0.0.1", t.port, request, sink);
      return;
    }
    const node = d.nodeOf(t.computerId);
    if (node !== null) {
      if (!d.stream.connected(node)) { sink.fail("The computer it runs on is not connected."); return; }
      d.stream.portFetch(node, { computerId: t.computerId, port: t.port, request }, sink);
      return;
    }
    const address = await d.localAddress(t.computerId).catch(() => null);
    if (!address) { sink.fail("The computer it runs on is asleep."); return; }
    dialPort(address, t.port, request, sink);
  }
  return {
    fetchTarget,
    host: {
      origin: d.origin,
      ...(d.artifactHost ? { artifactHost: d.artifactHost } : {}),
      ...(d.artifacts ? { artifacts: d.artifacts } : {}),
      ...(d.deploy ? { ...d.deploy, contained: d.contained } : {}),
      probe: (t: SiteTarget, at = "/"): Promise<{ answering: boolean; detail?: string }> => new Promise((resolve) => {
        let settled = false;
        const done = (r: { answering: boolean; detail?: string }): void => { if (!settled) { settled = true; resolve(r); } };
        void fetchTarget(t, { method: "GET", path: at.startsWith("/") ? at : `/${at}`, headers: { "user-agent": "vyre-site-check", host: "localhost" } }, {
          head: () => done({ answering: true }), data: () => undefined, end: () => undefined,
          fail: (reason) => done({ answering: false, detail: /ECONNREFUSED/.test(reason) ? `Nothing is listening on port ${t.port}.` : reason }),
        });
        setTimeout(() => done({ answering: false, detail: `Port ${t.port} did not answer in time.` }), 5000).unref();
      }),
      logs: async (t: SiteTarget, slug: string, lines: number): Promise<string[]> => {
        if (t.computerId === undefined) return [];
        const node = d.nodeOf(t.computerId);
        if (node === null) return d.localLogs(t.computerId, slug, lines);
        return (await d.stream.ask(node, "siteLogs", { computerId: t.computerId, slug, lines })) as string[];
      },
      // the agent's own disk, on the person's own computer. On a server the disk is the server's, not the agent's
      readLocal: async (p: string) => {
        if (d.contained) return null;
        const root = path.resolve(p);
        let stat: fs.Stats;
        try { stat = fs.statSync(root); } catch { return null; }
        const out: { path: string; base64: string; mime: string }[] = [];
        let size = 0;
        const add = (file: string, rel: string): void => {
          const bytes = fs.readFileSync(file);
          size += bytes.length;
          if (size > LOCAL_MAX || out.length >= LOCAL_FILES) throw new Error("That folder is too large to publish. Serve it from a port instead.");
          out.push({ path: rel, base64: bytes.toString("base64"), mime: mimeOf(rel) });
        };
        if (stat.isFile()) { add(root, path.basename(root)); return out; }
        const walk = (dir: string, prefix: string): void => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
            else if (e.isFile()) add(path.join(dir, e.name), `${prefix}${e.name}`);
          }
        };
        walk(root, "");
        return out;
      },
    },
  };
}
