// The golden check for a site (owner, 2 Nov), real pieces only: a small Node app runs in a container named like an agent computer, Caddy runs with automatic TLS from its internal CA, and what an agent would do
// (create a site, add a domain) puts a route there. curl gets it over HTTPS on a test hostname. The same app is reached at /p/<slug> through the daemon's public route. No Docker socket goes near the site.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { CaddyAdmin, CaddyRouter } from "../host/src/caddy/index.ts";
import { createPublicPathRoute } from "../host/src/routes/public-path.ts";
import { createDomainEdge, createSitesHost } from "../host/src/seams/sites-host.ts";
import { unixSocketHttp } from "../sandbox/src/docker.ts";
import { harness } from "../modules/sites/fixtures/world.ts";
import { configureDomainEdge } from "../modules/sites/handlers/route-domains.ts";
import { configureRoutes, routeBySlug } from "../modules/sites/handlers/route.ts";
import { handlers } from "../modules/sites/impl.ts";

const h = handlers as unknown as Record<string, (ctx: unknown, input: unknown) => Promise<any>>;
const ID = `${process.pid}a`;
const COMPUTER = `cmt_${ID}`;
const APP = `vyre-comp-${ID}`;
const CADDY = `vyre-site-caddy-${ID}`;
const ADMIN = 12019 + (process.pid % 500);
const HTTPS = 18443 + (process.pid % 500);
const HOST = "shop.site-golden.test";
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8" });
const APP_JS = `require("http").createServer((q,s)=>{s.setHeader("content-type","text/plain");s.setHeader("set-cookie","x=1");s.end("hello from the agent's app at "+q.url+" prefix "+(q.headers["x-forwarded-prefix"]||"none")+" cookie "+(q.headers.cookie||"none")+"\\n")}).listen(3000,"0.0.0.0")`;

test("an agent's Node app gets a public address: HTTPS through Caddy on a test hostname, and /p/<slug> through the daemon", async (t) => {
  const ran = docker("run", "-d", "--rm", "--name", APP, "--network", "bridge", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "node:24-bookworm-slim", "node", "-e", APP_JS);
  assert.equal(ran.status, 0, ran.stderr);
  const conf = `/tmp/${CADDY}.json`;
  fs.writeFileSync(conf, JSON.stringify({ admin: { listen: `127.0.0.1:${ADMIN}` } }));
  const up = docker("run", "-d", "--rm", "--name", CADDY, "--network", "host", "-v", `${conf}:/etc/caddy/admin.json:ro`, "caddy:2-alpine", "caddy", "run", "--config", "/etc/caddy/admin.json");
  assert.equal(up.status, 0, up.stderr);
  t.after(() => { docker("rm", "-f", APP); docker("rm", "-f", CADDY); fs.rmSync(conf, { force: true }); configureRoutes(null); configureDomainEdge(null); });
  const adminUrl = `http://127.0.0.1:${ADMIN}`;
  for (let i = 0; i < 50 && !(await fetch(`${adminUrl}/config/`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 200));
  // the first-install config: what compose and the Caddyfile give, on ports this box has free
  const admin = new CaddyAdmin({ baseUrl: adminUrl });
  await admin.load({ admin: { listen: `127.0.0.1:${ADMIN}` }, apps: { http: { https_port: HTTPS, http_port: HTTPS + 1, servers: { vyre: { listen: [`:${HTTPS}`], routes: [] } } }, tls: { automation: { policies: [{ issuers: [{ module: "internal" }] }] } } } });
  const router = new CaddyRouter({ admin, space: "spc_golden", tls: { port: HTTPS } });

  // the computer's address, from Docker, the way the host finds it
  const dockerHttp = unixSocketHttp();
  const localAddress = async (id: string): Promise<string | null> => {
    const r = await dockerHttp({ method: "GET", path: `/containers/vyre-comp-${id.replace(/^cmt_/, "")}/json` });
    return r.status === 200 ? ((JSON.parse(new TextDecoder().decode(r.body)) as { NetworkSettings: { Networks: Record<string, { IPAddress: string }> } }).NetworkSettings.Networks["bridge"]?.IPAddress ?? null) : null;
  };
  const deps = {
    origin: () => ({ origin: "https://team.site-golden.test", relay: false }), nodeOf: () => null, localAddress, localLogs: async () => [], contained: true,
    stream: { portFetch: () => undefined, ask: async () => null, connected: () => false },
  };
  const made = createSitesHost(deps);
  configureRoutes(made.host as never);
  configureDomainEdge({ ...createDomainEdge({ ...deps, router, peerAddress: () => null }), dnsOk: async () => true });
  const base = harness();
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_sites_core.sql", "0002_promote_tables.sql", "0003_routes.sql"]) db.exec(fs.readFileSync(new URL(`../modules/sites/migrations/${f}`, import.meta.url), "utf8"));
  const ctx = { ...base.ctx, db: { all: (s: string, ...a: unknown[]) => db.prepare(s).all(...(a as never[])), run: (s: string, ...a: unknown[]) => ({ changes: Number(db.prepare(s).run(...(a as never[])).changes) }) }, call: async () => ({}) };

  // what an agent does: name it, say where it runs, check it answers, publish it, add a domain
  const site = (await h["sites.create"]!(ctx, { name: "Shop", computerId: COMPUTER, port: 3000 })).site;
  let answering = false;
  for (let i = 0; i < 40 && !answering; i++) { answering = (await h["sites.status"]!(ctx, { siteId: site.siteId })).answering; if (!answering) await new Promise((r) => setTimeout(r, 250)); }
  assert.ok(answering, "the port answers");
  await h["sites.promote"]!(ctx, { siteId: site.siteId });
  const domain = await h["sites.domain_add"]!(ctx, { siteId: site.siteId, domain: HOST });
  assert.deepEqual(domain.records, [{ type: "CNAME", name: HOST, value: "team.site-golden.test" }]);

  let curl = { status: 1, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  for (let i = 0; i < 40; i++) {
    curl = spawnSync("curl", ["-sSk", "--max-time", "5", "--resolve", `${HOST}:${HTTPS}:127.0.0.1`, "-D", "-", `https://${HOST}:${HTTPS}/hello`], { encoding: "utf8" });
    if (curl.status === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`curl https://${HOST}:\n${String(curl.stdout)}\n`);
  assert.equal(curl.status, 0, String(curl.stderr));
  assert.match(String(curl.stdout), /^HTTP\/[12](\.\d)? 200/);
  assert.match(String(curl.stdout), /hello from the agent's app at \/hello/);

  // the same app at /p/<slug>, through the daemon's public route: its own path, no cookie in, none out, in the sandbox
  const route = createPublicPathRoute({ forms: () => null, origin: () => null, site: (slug) => routeBySlug(ctx, slug), fetch: (target, r, sink) => made.fetchTarget(target, r, sink) });
  const gw = http.createServer((q, s) => { if (!route.handle(q, s)) { s.writeHead(599); s.end(); } });
  await new Promise<void>((r) => gw.listen(0, "127.0.0.1", r));
  t.after(() => { gw.closeAllConnections(); gw.close(); });
  const r = await fetch(`http://127.0.0.1:${(gw.address() as AddressInfo).port}/p/${site.slug}/page`, { headers: { cookie: "vyre=1" } });
  const body = await r.text();
  process.stdout.write(`/p/${site.slug}/page: ${r.status} ${body}`);
  assert.equal(r.status, 200);
  assert.match(body, /at \/p\/shop\/page prefix \/p\/shop cookie none/);
  assert.equal(r.headers.get("set-cookie"), null);
  assert.match(String(r.headers.get("content-security-policy")), /sandbox allow-scripts/);

  // the computer stops: the address says so, and stop takes the public path down
  await h["sites.stop"]!(ctx, { siteId: site.siteId });
  assert.equal((await fetch(`http://127.0.0.1:${(gw.address() as AddressInfo).port}/p/${site.slug}/page`)).status, 404);
  // nothing here gave the site a socket
  const inspected = JSON.parse(docker("inspect", APP).stdout) as [{ Mounts: unknown[]; HostConfig: { Binds: unknown; Privileged: boolean; NetworkMode: string } }];
  assert.deepEqual(inspected[0].Mounts, []);
  assert.equal(inspected[0].HostConfig.Privileged, false);
  assert.equal(inspected[0].HostConfig.NetworkMode, "bridge");
});
