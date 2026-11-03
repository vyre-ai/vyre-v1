// The deploy tests' world, real pieces only where they matter: real SQLite with the sites migrations, the real sites module handlers and host seam, the real Docker engine of the box (the
// runner talks to its socket), and the real site-host route behind a small HTTP server that answers for <slug>.sites.test. Files, the Vault and access are scripted.
// A test file uses one of these per app kind and cleans up every container, image, volume and network it made (by the vyre.site label).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { harness } from "../fixtures/world.ts";
import { createSitesHost } from "../../../host/src/seams/sites-host.ts";
import { createSiteHostRoute } from "../../../host/src/routes/site-host.ts";
import { configureRoutes, containerAddress, routeByHost, routeByTicket } from "../handlers/route.ts";
import { checkPassword, newTicket, SESSION_MS } from "../handlers/release.ts";
import { handlers } from "../impl.ts";

export const HEAVY = process.env["VYRE_HEAVY_DOCKER"] === "1";
export const SKIP = HEAVY ? false : "needs Docker: set VYRE_HEAVY_DOCKER=1 on a box with a Docker engine (box B, the heavy job)";
export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "sites");
export const DOMAIN = "sites.test";
const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function docker(...a: string[]): { status: number | null; stdout: string; stderr: string } { return spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 }); }

export function deployWorld(o: { vault?: Record<string, string>; members?: string[] } = {}) {
  const base = harness();
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_sites_core.sql", "0002_promote_tables.sql", "0003_routes.sql", "0004_deploy.sql"]) db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const sdb = { all: (s: string, ...a: unknown[]) => db.prepare(s).all(...(a as never[])), run: (s: string, ...a: unknown[]) => ({ changes: Number(db.prepare(s).run(...(a as never[])).changes) }) };
  const vault = new Map(Object.entries(o.vault ?? {}));
  const secrets = new Map<string, string>();
  const files = new Map<string, { name: string; bytes: Buffer; folder: string }>();
  const folders = new Map<string, { name: string; parent: string | null }>();
  const members = new Set(["usr_owner", ...(o.members ?? [])]);
  const ctx = {
    ...base.ctx, db: sdb, now: () => Date.now(),
    vault: {
      async fill(handle: string, into: { kind: string; ref: string }) {
        const v = vault.get(handle);
        if (v === undefined) throw new Error(`no grant on ${handle}`);
        if (into.kind === "site_env") secrets.set(into.ref, v);
      },
      use: (handle: string) => ({ handle }),
    },
    seal: { seal: (v: Uint8Array) => ({ keyId: "k", nonce: "n", bytes: Buffer.from(v).toString("base64") }), unseal: (s: { bytes: string }) => new Uint8Array(Buffer.from(s.bytes, "base64")) },
    async call(cap: string, input: unknown): Promise<unknown> {
      const i = input as Record<string, string>;
      if (cap === "files.list") {
        const folder = i["folder"] as string;
        return { files: [...files.entries()].filter(([, f]) => f.folder === folder).map(([fileId, f]) => ({ fileId, name: f.name, size: f.bytes.length })), folders: [...folders.entries()].filter(([, f]) => f.parent === folder).map(([folderId, f]) => ({ folderId, name: f.name })) };
      }
      if (cap === "files.read") { const f = files.get(i["fileId"] as string); return f ? { base64: f.bytes.toString("base64"), mime: "application/octet-stream" } : {}; }
      if (cap === "files.get") { const f = files.get(i["fileId"] as string); return f ? { file: { name: f.name, size: f.bytes.length } } : {}; }
      if (cap === "computers.hosts") return { available: false };
      throw new Error(`unscripted call ${cap}`);
    },
  };
  const made = createSitesHost({
    origin: () => ({ origin: "https://space.test", relay: false }), nodeOf: () => null, localAddress: async () => null, localLogs: async () => [], contained: false,
    stream: { portFetch: () => undefined, ask: async () => null, connected: () => false },
    containerAddress: (c) => containerAddress(c),
    deploy: { dockerSocket: "/var/run/docker.sock", take: (ref) => { const v = secrets.get(ref); secrets.delete(ref); return v; }, tmp: os.tmpdir(), sitesDomain: () => DOMAIN, domainOf: () => null, hostRoute: async () => undefined },
  });
  configureRoutes(made.host as never);
  const route = createSiteHostRoute({
    own: (x) => x === "space.test", site: (x) => routeByHost({ db: sdb }, x, DOMAIN), ticket: async (id, t) => (await routeByTicket({ db: sdb }, id, t, Date.now()))?.principal ?? null,
    may: (p, s) => p === s.owner || (s.access !== "private" && members.has(p)), checkPassword, newSession: (id, p) => newTicket(sdb, id, p, SESSION_MS, Date.now()),
    address: (c) => containerAddress(c), origin: () => "https://space.test",
  });
  const server = http.createServer((q, s) => { if (!route.handle(q, s)) { s.writeHead(599); s.end("not a site"); } });
  const ready = new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
  const sites: string[] = [];

  /** One request to a site's own address through the route, with the Host header a browser would send. */
  async function get(slug: string, p: string, opt: { cookie?: string; method?: string; body?: string; type?: string } = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    const port = await ready;
    return new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path: p, method: opt.method ?? "GET", headers: { host: `${slug}.${DOMAIN}`, ...(opt.cookie ? { cookie: opt.cookie } : {}), ...(opt.type ? { "content-type": opt.type } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      });
      r.on("error", reject);
      r.end(opt.body);
    });
  }

  /** Make a site from a fixture folder (copied, as an agent's own computer would) and deploy it, waiting for the end. */
  async function deploy(fixture: string, input: Record<string, unknown> = {}): Promise<{ site: any; deployment: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = `${fixture} ${process.pid}${Math.random().toString(36).slice(2, 6)}`;
    const site = (await h["sites.create"]!(ctx, { name, source: { path: path.join(FIXTURES, fixture) }, ...input })).site;
    sites.push(site.siteId);
    const out = await h["sites.deploy"]!(ctx, { siteId: site.siteId, wait: true });
    return { site: (await h["sites.get"]!(ctx, { siteId: site.siteId })).site, deployment: out.deployment };
  }

  async function buildLog(siteId: string): Promise<string> { return ((await h["sites.logs"]!(ctx, { siteId, build: true, tail: 1000 })).lines as string[]).join("\n"); }

  function cleanup(): void {
    server.closeAllConnections(); server.close();
    configureRoutes(null);
    for (const id of sites) {
      const ids = docker("ps", "-aq", "--filter", `label=vyre.site=${id}`).stdout.split("\n").filter(Boolean);
      if (ids.length) docker("rm", "-f", "-v", ...ids);
      const imgs = docker("images", "-q", "--filter", `label=vyre.site=${id}`).stdout.split("\n").filter(Boolean);
      if (imgs.length) docker("rmi", "-f", ...new Set(imgs));
      const hex = id.replace(/^sit_/, "");
      docker("volume", "rm", "-f", `vyre-site-${hex.slice(-12)}-postgres-data`, `vyre-site-${hex.slice(-12)}-redis-data`);
      docker("network", "rm", `vyre-site-${hex.slice(-16)}`);
    }
  }

  /** Make a site from a fixture without deploying it yet. */
  async function create(fixture: string, input: Record<string, unknown> = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const site = (await h["sites.create"]!(ctx, { name: `${fixture} ${process.pid}${Math.random().toString(36).slice(2, 6)}`, source: { path: path.join(FIXTURES, fixture) }, ...input })).site;
    sites.push(site.siteId);
    return site;
  }

  /** A cookie for a person, the way a browser gets one: the sign-in link, traded at the site's address. */
  async function signIn(slug: string, siteId: string, as = "usr_owner"): Promise<string> {
    const link = await h["sites.signin_link"]!({ ...ctx, principal: { kind: "person", id: as } }, { siteId, next: "/" });
    const u = new URL(link.url);
    const r = await get(slug, `${u.pathname}${u.search}`);
    if (r.status !== 302) throw new Error(`sign-in answered ${r.status}: ${r.body.slice(0, 200)}`);
    return String(r.headers["set-cookie"]).split(";")[0] as string;
  }

  return { ctx, h, db, sdb, vault, files, folders, members, get, deploy, create, signIn, buildLog, cleanup, track: (id: string) => sites.push(id), as: (p: string) => ({ ...ctx, principal: { kind: "person" as const, id: p } }) };
}
