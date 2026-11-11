// The door in front of a deployed site, with a plain HTTP server standing in for the app: who gets in for each access, the sign-in link traded for a cookie, our cookie and x-vyre-*
// never reaching the app, the app's own cookies passing both ways, and the Space's own name never treated as a site.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createSiteHostRoute, createSiteSigninPage } from "./site-host.ts";
import type { HostSite } from "./site-host.ts";

const TOKEN = "a".repeat(48), OTHER = "b".repeat(48), PW = "c".repeat(48);

async function world(access: string) {
  const seen: http.IncomingHttpHeaders[] = [];
  const app = http.createServer((q, s) => { seen.push(q.headers); s.setHeader("set-cookie", ["app=1; Path=/", "two=2"]); s.end(`app ${q.method} ${q.url}`); });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const site: HostSite = { siteId: "sit_1", name: "CX", access, live: true, blocked: false, owner: "usr_owner", passwordHash: "hash", target: { container: "c1", port: (app.address() as AddressInfo).port } };
  const tickets = new Map([[TOKEN, "usr_anem"], [OTHER, "usr_gone"], [PW, "visitor:password"]]);
  const route = createSiteHostRoute({
    own: (h) => h === "space.test", site: (h) => (h === "cx.space.test" ? site : null), ticket: async (_id, t) => tickets.get(t) ?? null,
    may: (p, x) => p === x.owner || (x.access !== "private" && p === "usr_anem"), checkPassword: async (g) => g === "right", newSession: async () => PW,
    address: async () => "127.0.0.1", origin: () => "https://space.test",
  });
  const page = createSiteSigninPage();
  const gw = http.createServer((q, s) => { if (!route.handle(q, s) && !page.handle(q, s)) { s.writeHead(599); s.end(); } });
  await new Promise<void>((r) => gw.listen(0, "127.0.0.1", r));
  const call = (path: string, o: { host?: string; cookie?: string; method?: string; body?: string; headers?: Record<string, string> } = {}) => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: (gw.address() as AddressInfo).port, path, method: o.method ?? "GET", headers: { host: o.host ?? "cx.space.test", ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers })); });
    r.on("error", reject); r.end(o.body);
  });
  const close = (): void => { app.close(); gw.close(); };
  return { site, call, seen, close };
}

test("space: a visitor goes to sign in, a member's link becomes a cookie, a non-member is refused, and our cookie never reaches the app", async (t) => {
  const w = await world("space");
  t.after(w.close);
  const anon = await w.call("/dash?x=1");
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.location, "https://space.test/sites/signin?site=sit_1&next=%2Fdash%3Fx%3D1");
  const signin = await w.call(`/__vyre/signin?t=${TOKEN}&next=/dash`);
  assert.equal(signin.status, 302);
  assert.equal(signin.headers.location, "/dash");
  assert.match(String(signin.headers["set-cookie"]), /^__vyre_site=c{48}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400$/);
  assert.equal((await w.call(`/__vyre/signin?t=${OTHER}`)).status, 403, "a link for someone who may not see it");
  const ok = await w.call("/api", { cookie: `__vyre_site=${TOKEN}; theirs=1`, headers: { "x-vyre-user": "forged" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body, "app GET /api");
  assert.deepEqual(ok.headers["set-cookie"], ["app=1; Path=/", "two=2"], "the app's own cookies come back");
  const h = w.seen.at(-1)!;
  assert.equal(h.cookie, "theirs=1");
  assert.equal(h["x-vyre-user"], "usr_anem");
  assert.equal(h.host, "cx.space.test");
  assert.equal(h["x-forwarded-proto"], "https");
  assert.equal((await w.call("/", { cookie: `__vyre_site=${OTHER}` })).status, 403);
  assert.equal((await w.call("/", { method: "POST", body: "x" })).status, 401, "a write with no cookie is refused, not redirected");
  assert.equal((await w.call("/__vyre/signin?t=../../x&next=//evil.example")).status, 403);
});

test("password: a form, a wrong password, the right one; a next that leaves the site goes home", async (t) => {
  const w = await world("password");
  t.after(w.close);
  assert.match((await w.call("/")).body, /This site has a password/);
  assert.equal((await w.call("/__vyre/password", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=wrong&next=/" })).status, 401);
  const right = await w.call("/__vyre/password", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=right&next=//evil.example" });
  assert.equal(right.status, 303);
  assert.equal(right.headers.location, "/");
  assert.equal((await w.call("/x", { cookie: `__vyre_site=${PW}` })).body, "app GET /x");
});

test("public, private, stopped and taken down; the Space's own name and an unknown one are not sites", async (t) => {
  const w = await world("public");
  t.after(w.close);
  const put = await w.call("/form", { method: "PUT", body: "{}" });
  assert.equal(put.body, "app PUT /form", "any method reaches a public app");
  w.site.access = "private";
  assert.equal((await w.call("/", { cookie: `__vyre_site=${TOKEN}` })).status, 403, "a member it is not shared with");
  w.site.live = false;
  assert.equal((await w.call("/")).status, 404);
  w.site.live = true; w.site.blocked = true;
  assert.equal((await w.call("/")).status, 451);
  assert.equal((await w.call("/", { host: "space.test" })).status, 599);
  assert.equal((await w.call("/", { host: "nope.example" })).status, 599);
  const page = await w.call("/sites/signin?site=sit_1&next=/", { host: "space.test" });
  assert.equal(page.status, 200);
  assert.match(page.body, /sites\/signin_link/);
  assert.match(String(page.headers["content-security-policy"]), /connect-src 'self'/);
});

test("clientOnNetwork: a container on the network is a client; the host's own side of the bridge (the gateway), which Docker's published-port NAT arrives from, is not", async () => {
  const { clientOnNetwork } = await import("./site-host.ts");
  const computers = ["192.168.48.0/20", "192.168.32.0/20"];
  // the compose topology: vyred has 192.168.16.2 on the default network and 192.168.48.2 on the computer's network
  assert.equal(clientOnNetwork("192.168.48.2", "192.168.48.3", computers), true, "the computer itself (a container) is a computer");
  assert.equal(clientOnNetwork("192.168.48.2", "::ffff:192.168.48.3", computers), true, "an IPv4-mapped address is the same");
  assert.equal(clientOnNetwork("192.168.48.2", "192.168.48.1", computers), false, "the owner's browser arriving through the published port is the bridge gateway, not a computer");
  assert.equal(clientOnNetwork("192.168.48.2", "::ffff:192.168.48.1", computers), false);
  assert.equal(clientOnNetwork("192.168.16.2", "192.168.16.1", computers), false, "the default network is no computer network");
  assert.equal(clientOnNetwork("127.0.0.1", "127.0.0.1", computers), false, "Caddy's loopback proxy is the Space's own");
  assert.equal(clientOnNetwork("192.168.48.2", "10.0.0.5", computers), false, "a client outside the subnet is not on it");
  assert.equal(clientOnNetwork("192.168.16.2", "192.168.48.3", computers), false, "a computer reaching the default network's address is not on its own network (it cannot, but the rule is about its own network)");
  assert.equal(clientOnNetwork("::1", "::1", computers), false, "IPv6 loopback is the Space's own");
  assert.equal(clientOnNetwork("fd00::2", "fd00::3", computers), false, "an IPv6 pair is no IPv4 computer network (the networks are IPv4)");
  assert.equal(clientOnNetwork("::ffff:192.168.48.2", "::ffff:192.168.48.3", computers), true, "both ends IPv4-mapped, as a dual-stack socket reports them");
  assert.equal(clientOnNetwork(undefined, undefined, computers), false);
  assert.equal(clientOnNetwork("192.168.48.2", "192.168.48.3", []), false);
});

// Review 6b (12 Nov): the daemon's guard asked whether the request arrived on an address inside an agent network, so a page in an agent's browser that called the host's LAN or public address, or another
// bridge's gateway, got the whole API. agentCaller decides by where the request comes from.
test("agentCaller: a caller inside an agent network is an agent on whatever address of the host it reached; the network's gateway (the host, a published port) is not", async () => {
  const { agentCaller } = await import("./site-host.ts");
  const nets = ["172.29.0.0/16", "192.168.48.0/20"];
  for (const local of ["172.29.0.1", "172.17.0.1", "10.0.0.5", "203.0.113.7", "127.0.0.1", undefined]) {
    assert.equal(agentCaller(local, "172.29.0.2", nets), true, `the Space browser reaching ${String(local)}`);
    assert.equal(agentCaller(local, "::ffff:192.168.48.3", nets), true, `an agent computer reaching ${String(local)}`);
  }
  assert.equal(agentCaller("172.29.0.1", "172.29.0.1", nets), false, "the host's own side of the bridge");
  assert.equal(agentCaller("10.0.0.5", "10.0.0.9", nets), false, "a person on the LAN");
  assert.equal(agentCaller("127.0.0.1", "127.0.0.1", nets), false, "this computer");
  assert.equal(agentCaller("172.29.0.1", "172.29.0.2", []), false, "no agent networks known");
});
