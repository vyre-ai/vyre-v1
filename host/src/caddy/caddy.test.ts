// Route JSON for staging and production hosts, the base config and the ACME policy, and the checks on host names and upstreams.
import test from "node:test";
import assert from "node:assert/strict";
import {
  acmePolicy, baseConfig, BASIC_USER, hostOf, LE_STAGING, normalizeHost, normalizeUpstream, RouteError, routesOf, siteRoute, withServer,
} from "./index.ts";

const HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

test("a staging route is noindex, basic auth, then the reverse proxy", () => {
  assert.deepEqual(siteRoute("staging-abc.acme.vyre.run", "site-abc:3000", { username: BASIC_USER, hash: HASH }), {
    "@id": "vyre-route-staging-abc.acme.vyre.run",
    match: [{ host: ["staging-abc.acme.vyre.run"] }],
    handle: [
      { handler: "headers", response: { set: { "X-Robots-Tag": ["noindex, nofollow"] } } },
      { handler: "authentication", providers: { http_basic: { hash: { algorithm: "bcrypt" }, accounts: [{ username: "vyre", password: HASH }] } } },
      { handler: "reverse_proxy", upstreams: [{ dial: "site-abc:3000" }] },
    ],
    terminal: true,
  });
});

test("a production route is only the reverse proxy", () => {
  assert.deepEqual(siteRoute("www.Example-Firm.com.", "site-abc:3000", null), {
    "@id": "vyre-route-www.example-firm.com",
    match: [{ host: ["www.example-firm.com"] }],
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "site-abc:3000" }] }],
    terminal: true,
  });
});

test("basic auth takes a bcrypt hash and refuses a password", () => {
  for (const bad of ["hunter2", "", "$2a$10$tooshort", "$1$salt$md5hashmd5hashmd5hashmd"]) {
    assert.throws(() => siteRoute("staging-a.acme.vyre.run", "s:1", { username: "vyre", hash: bad }), RouteError, bad);
  }
});

test("host names are lower-case DNS names; patterns, ports, paths and addresses are refused", () => {
  assert.equal(normalizeHost("  Staging-1.Acme.Vyre.Run. "), "staging-1.acme.vyre.run");
  assert.equal(normalizeHost("localhost"), "localhost");
  for (const bad of ["", "*.example.com", "example.com:8443", "http://example.com", "example.com/x", "1.2.3.4", "a..example.com", "-a.example.com", "a b.example.com", "example", "x".repeat(64) + ".com"]) {
    assert.throws(() => normalizeHost(bad), RouteError, bad);
  }
  assert.throws(() => normalizeHost(5 as never), RouteError);
});

test("upstreams are name:port or address:port with a real port", () => {
  for (const ok of ["site-abc:3000", "10.0.0.5:8080", "[::1]:80", "gateway:8420", "127.0.0.1:65535"]) assert.equal(normalizeUpstream(ok), ok);
  for (const bad of ["site", "site:0", "site:70000", "http://site:80", "", "site:80/x", "sp ace:80", "site:"]) {
    assert.throws(() => normalizeUpstream(bad), RouteError, bad);
  }
});

test("the base config is one server on 443 with no routes, and no tls app unless ACME is configured", () => {
  assert.deepEqual(baseConfig(), { apps: { http: { servers: { vyre: { listen: [":443"], routes: [] } } } } });
  assert.deepEqual(baseConfig({ listen: [":8443"], acme: { ca: "production" } }), { apps: { http: { servers: { vyre: { listen: [":8443"], routes: [] } } } } });
});

test("ACME: staging CA, contact email, or both, as an issuer policy", () => {
  assert.equal(acmePolicy(undefined), null);
  assert.deepEqual(acmePolicy({ ca: "staging" }), { issuers: [{ module: "acme", ca: LE_STAGING }] });
  assert.deepEqual(acmePolicy({ email: "ops@firm.com" }), { issuers: [{ module: "acme", email: "ops@firm.com" }] });
  assert.deepEqual(acmePolicy({ email: "ops@firm.com", ca: "staging" }), { issuers: [{ module: "acme", email: "ops@firm.com", ca: LE_STAGING }] });
  const cfg = baseConfig({ acme: { ca: "staging", email: "ops@firm.com" } }) as { apps: { tls: { automation: { policies: unknown[] } } } };
  assert.deepEqual(cfg.apps.tls.automation.policies, [{ issuers: [{ module: "acme", email: "ops@firm.com", ca: LE_STAGING }] }]);
});

test("withServer builds from nothing, leaves a ready config alone and adds the server beside what Caddy already runs", () => {
  const fresh = withServer(undefined);
  assert.equal(fresh.changed, true);
  assert.deepEqual(fresh.config, baseConfig());

  const ready = baseConfig();
  const same = withServer(ready);
  assert.equal(same.changed, false);
  assert.equal(same.config, ready, "the same object comes back when nothing changes");

  const foreign = {
    admin: { listen: "localhost:2019" },
    apps: { http: { servers: { other: { listen: [":9000"], routes: [] } } }, tls: { automation: { policies: [{ subjects: ["x.test"] }] } } },
  };
  const merged = withServer(foreign, { acme: { ca: "staging" } });
  assert.equal(merged.changed, true);
  const apps = merged.config["apps"] as { http: { servers: Record<string, unknown> }; tls: { automation: { policies: unknown[] } } };
  assert.deepEqual(Object.keys(apps.http.servers).sort(), ["other", "vyre"]);
  assert.deepEqual(merged.config["admin"], { listen: "localhost:2019" });
  assert.deepEqual(apps.tls.automation.policies, [{ subjects: ["x.test"] }, { issuers: [{ module: "acme", ca: LE_STAGING }] }]);
  assert.deepEqual(foreign.apps.tls.automation.policies, [{ subjects: ["x.test"] }], "the input is not changed");
});

test("routesOf and hostOf read only the routes Vyre wrote", () => {
  const mine = siteRoute("a.acme.vyre.run", "s:1", null);
  const cfg = { apps: { http: { servers: { vyre: { routes: [mine, { match: [{ host: ["b.test"] }], handle: [] }] } } } } };
  assert.equal(routesOf(cfg).length, 2);
  assert.deepEqual(routesOf(cfg).map(hostOf), ["a.acme.vyre.run", undefined]);
  assert.deepEqual(routesOf(undefined), []);
  assert.deepEqual(routesOf({ apps: {} }), []);
});
