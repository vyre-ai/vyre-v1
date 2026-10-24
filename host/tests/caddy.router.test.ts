// The router against an in-memory Caddy admin API: what is sent, in what order, what is replaced, what stays, and how Caddy's refusals surface.
import test from "node:test";
import assert from "node:assert/strict";
import { CaddyAdmin, CaddyError, CaddyRouter, RouteError } from "../src/caddy/index.ts";
import { FakeCaddy } from "../src/caddy/fake.ts";

const HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const clock = { t: 1_760_000_000_000 };

function rig(o: { secret?: string; withAuth?: boolean } = {}) {
  const caddy = new FakeCaddy();
  const asked: { handle: string; space: string }[] = [];
  const hashed: string[] = [];
  const router = new CaddyRouter({
    admin: new CaddyAdmin({ fetch: caddy.fetch }), space: "spc_1", now: () => clock.t,
    ...(o.withAuth === false ? {} : {
      vault: { secret: async (handle: string, space: string) => { asked.push({ handle, space }); return o.secret ?? "correct horse battery"; } },
      hasher: { hash: async (p: string) => { hashed.push(p); return HASH; } },
    }),
  });
  return { caddy, router, asked, hashed };
}
const seq = (c: FakeCaddy): string[] => c.calls.map((x) => `${x.method} ${x.path}`);

test("the first route loads the base config, then adds the route by id", async () => {
  const r = rig();
  await r.router.setRoute({ host: "www.firm.com", upstream: "site-1:3000", auth: null });
  assert.deepEqual(seq(r.caddy), ["GET /config/", "POST /load", "GET /id/vyre-route-www.firm.com", "POST /config/apps/http/servers/vyre/routes"]);
  assert.deepEqual(await r.router.hosts(), ["www.firm.com"]);
});

test("setting the same host again replaces the route in place and never loads the base again", async () => {
  const r = rig();
  await r.router.setRoute({ host: "www.firm.com", upstream: "site-1:3000", auth: null });
  r.caddy.calls.length = 0;
  await r.router.setRoute({ host: "WWW.firm.com", upstream: "site-2:4000", auth: null });
  assert.deepEqual(seq(r.caddy), ["GET /config/", "GET /id/vyre-route-www.firm.com", "PATCH /id/vyre-route-www.firm.com"]);
  const routes = (r.caddy.config as { apps: { http: { servers: { vyre: { routes: { handle: { upstreams?: { dial: string }[] }[] }[] } } } } }).apps.http.servers.vyre.routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.handle[0]!.upstreams![0]!.dial, "site-2:4000");
});

test("removing a route deletes it by id; removing it again sends nothing", async () => {
  const r = rig();
  await r.router.setRoute({ host: "a.acme.vyre.run", upstream: "s:1", auth: null });
  await r.router.setRoute({ host: "b.acme.vyre.run", upstream: "s:2", auth: null });
  r.caddy.calls.length = 0;
  await r.router.removeRoute("a.acme.vyre.run");
  assert.deepEqual(seq(r.caddy), ["GET /id/vyre-route-a.acme.vyre.run", "DELETE /id/vyre-route-a.acme.vyre.run"]);
  assert.deepEqual(await r.router.hosts(), ["b.acme.vyre.run"]);
  r.caddy.calls.length = 0;
  await r.router.removeRoute("a.acme.vyre.run");
  assert.deepEqual(seq(r.caddy), ["GET /id/vyre-route-a.acme.vyre.run"]);
});

test("a staging route reads its password from the Vault, hashes it, and only the hash reaches Caddy", async () => {
  const r = rig({ secret: "s3cret-preview-pw" });
  await r.router.setRoute({ host: "staging-abc.acme.vyre.run", upstream: "site-abc:3000", auth: { handle: "#Site_abc_Staging" } });
  assert.deepEqual(r.asked, [{ handle: "#Site_abc_Staging", space: "spc_1" }]);
  assert.deepEqual(r.hashed, ["s3cret-preview-pw"]);
  const sent = JSON.stringify(r.caddy.calls);
  assert.ok(sent.includes(HASH));
  assert.ok(!sent.includes("s3cret-preview-pw"), "the password itself is never sent");
});

test("a protected route without a Vault and hasher, or with an empty key, is refused before Caddy is touched", async () => {
  const none = rig({ withAuth: false });
  await assert.rejects(none.router.setRoute({ host: "staging-a.acme.vyre.run", upstream: "s:1", auth: { handle: "#K" } }), RouteError);
  assert.equal(none.caddy.calls.length, 0);
  const empty = rig({ secret: "" });
  await assert.rejects(empty.router.setRoute({ host: "staging-a.acme.vyre.run", upstream: "s:1", auth: { handle: "#K" } }), RouteError);
  assert.equal(empty.caddy.calls.length, 0);
});

test("bad hosts and upstreams are refused before Caddy is touched", async () => {
  const r = rig();
  await assert.rejects(r.router.setRoute({ host: "*.firm.com", upstream: "s:1", auth: null }), RouteError);
  await assert.rejects(r.router.setRoute({ host: "a.firm.com", upstream: "http://s:1", auth: null }), RouteError);
  await assert.rejects(r.router.removeRoute("nope"), RouteError);
  assert.equal(r.caddy.calls.length, 0);
});

test("what Caddy already runs is kept when the Vyre server is added", async () => {
  const r = rig();
  r.caddy.config = { admin: { listen: "localhost:2019" }, apps: { http: { servers: { other: { listen: [":9000"], routes: [{ "@id": "mine" }] } } } } };
  await r.router.setRoute({ host: "a.firm.com", upstream: "s:1", auth: null });
  const servers = (r.caddy.config as { apps: { http: { servers: Record<string, { routes: unknown[] }> } } }).apps.http.servers;
  assert.deepEqual(Object.keys(servers).sort(), ["other", "vyre"]);
  assert.deepEqual(servers["other"]!.routes, [{ "@id": "mine" }]);
  assert.equal(servers["vyre"]!.routes.length, 1);
  assert.deepEqual((r.caddy.config as { admin: unknown }).admin, { listen: "localhost:2019" });
});

test("loaded() is false for an empty Caddy and true once the Vyre server exists", async () => {
  const r = rig();
  assert.equal(await r.router.loaded(), false);
  assert.deepEqual(await r.router.ensureBase(), { created: true });
  assert.equal(await r.router.loaded(), true);
  assert.deepEqual(await r.router.ensureBase(), { created: false });
});

test("the public ingress is a route with no auth to the gateway", async () => {
  const r = rig();
  await r.router.setIngress("acme.vyre.run", "127.0.0.1:8420");
  await r.router.setIngress("console.acme.vyre.run", "127.0.0.1:8420");
  assert.deepEqual(await r.router.hosts(), ["acme.vyre.run", "console.acme.vyre.run"]);
  assert.ok(!JSON.stringify(r.caddy.config).includes("authentication"));
});

test("a second writer taking the id between the check and the append turns into a replace", async () => {
  const r = rig();
  await r.router.ensureBase();
  r.caddy.beforeAppend = (route) => {
    r.caddy.beforeAppend = null;
    ((r.caddy.config as { apps: { http: { servers: { vyre: { routes: unknown[] } } } } }).apps.http.servers.vyre.routes).push({ ...route, handle: [] });
  };
  await r.router.setRoute({ host: "a.firm.com", upstream: "s:1", auth: null });
  const routes = (r.caddy.config as { apps: { http: { servers: { vyre: { routes: { handle: unknown[] }[] } } } } }).apps.http.servers.vyre.routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0]!.handle.length, 1, "our route replaced the other writer's");
});

test("Caddy's refusals carry its own message and status; a dead admin API says it did not answer", async () => {
  const r = rig();
  await r.router.ensureBase();
  r.caddy.failNext = { status: 400, body: JSON.stringify({ error: "loading new config: unknown module" }) };
  await assert.rejects(r.router.setRoute({ host: "a.firm.com", upstream: "s:1", auth: null }), (e: unknown) => e instanceof CaddyError && e.status === 400 && /unknown module/.test(e.message));
  r.caddy.down = true;
  await assert.rejects(r.router.hosts(), (e: unknown) => e instanceof CaddyError && e.status === 0 && /did not answer/.test(e.message));
});

test("an admin call that never answers is cut off at the timeout", async () => {
  const admin = new CaddyAdmin({ timeoutMs: 20, fetch: (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); }) });
  await assert.rejects(admin.config(), (e: unknown) => e instanceof CaddyError && /within 20 ms/.test(e.message));
});

test("the admin client reads an empty or null body as nothing and a body that is not JSON as an error", async () => {
  const mk = (status: number, body: string) => new CaddyAdmin({ fetch: async () => ({ status, text: async () => body }) });
  assert.equal(await mk(200, "null").config(), undefined);
  assert.equal(await mk(200, "").config(), undefined);
  assert.equal(await mk(404, "{}").config(), undefined);
  assert.deepEqual(await mk(200, '{"apps":{}}').config(), { apps: {} });
  await assert.rejects(mk(200, "<html>").config(), CaddyError);
  await assert.rejects(mk(500, "boom").config(), (e: unknown) => e instanceof CaddyError && e.status === 500 && e.body === "boom");
});
