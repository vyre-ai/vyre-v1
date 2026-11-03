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
