// The artifact host (artifact-host.ts): a one-time code becomes a cookie session of this host only, the clean address serves the page to that session, access is asked on every request, and a browser
// without the session is told it has no access. Nothing here touches the app's origin: another host is not ours.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ARTIFACT_COOKIE, createArtifactHostRoute } from "./artifact-host.ts";
import { PUBLIC_SANDBOX } from "./public-path.ts";

const HOST = "mla-a.vyre.run";
const APP = "https://mla.vyre.run";

function rig() {
  const codes = new Map<string, { siteId: string; at: number }>();
  const sessions = new Map<string, { siteId: string; person: string }>();
  const shared = new Set<string>(["usr_aliza"]);
  let now = 1_000;
  const route = createArtifactHostRoute({
    host: () => HOST, appOrigin: () => APP, appOrigins: () => [APP, "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"],
    exchange: async (code) => {
      const c = codes.get(code); codes.delete(code);   // single use
      if (!c || now - c.at > 60_000) return null;
      const token = `s${sessions.size}`.padEnd(48, "0");
      sessions.set(token, { siteId: c.siteId, person: "usr_aliza" });
      return { siteId: c.siteId, token, maxAgeSeconds: 43_200 };
    },
    // access is asked on every request: the person must still be on the share
    artifact: async (siteId, token) => { const s = sessions.get(token); return s && s.siteId === siteId && shared.has(s.person) ? { siteId, access: "private", live: true, blocked: false, target: { folderId: "fld_a" } } : null; },
    serving: { forms: () => null, origin: () => APP, fetch: async (_t, _r, sink) => sink.fail("none"), file: async (_f, rel) => ({ mime: "text/html", bytes: new TextEncoder().encode(`<p>page ${rel}</p>`) }) } as never,
  });
  const server = http.createServer((req, res) => { if (route.handle(req, res)) return; res.writeHead(200); res.end("the app"); });
  return new Promise<{ url: string; codes: typeof codes; shared: typeof shared; tick(ms: number): void; get(path: string, h?: Record<string, string>): Promise<Response>; close(): Promise<void> }>((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      ok({ url, codes, shared, tick: (ms) => { now += ms; }, get: (p, h = {}) => raw(url, p, { host: HOST, ...h }), close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) });
    });
  });
}
/** A request with a Host of our choosing (fetch will not send one). Answers as a Response. */
function raw(base: string, path: string, headers: Record<string, string>): Promise<Response> {
  return new Promise((ok, fail) => {
    const u = new URL(base);
    const r = http.request({ host: u.hostname, port: u.port, path, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) h.append(k, x);
        ok(new Response([204, 304].includes(res.statusCode ?? 0) ? null : Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: h }));
      });
    });
    r.on("error", fail);
    r.end();
  });
}
const CODE = "a".repeat(48);
const cookieOf = (r: Response): string => /__vyre_a=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";

test("the code is single use: the first trade sets an HttpOnly Secure Lax cookie and lands on the clean address, the second finds nothing", async () => {
  const s = await rig();
  try {
    s.codes.set(CODE, { siteId: "sit_one", at: 1_000 });
    const first = await s.get(`/x/${CODE}`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.get("location"), "/sit_one/");
    const set = first.headers.get("set-cookie") ?? "";
    assert.match(set, new RegExp(`^${ARTIFACT_COOKIE}=[0-9a-z]{48}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$`));
    assert.ok(!(first.headers.get("location") ?? "").includes(CODE), "no code in the address it lands on");
    assert.equal((await s.get(`/x/${CODE}`)).status, 404, "a second use is refused");
    // the desktop viewer frames it from another origin: that one is partitioned, never plain third-party
    s.codes.set("b".repeat(48), { siteId: "sit_one", at: 1_000 });
    assert.match((await s.get(`/x/${"b".repeat(48)}?embed=1`)).headers.get("set-cookie") ?? "", /SameSite=None; Partitioned/);
  } finally { await s.close(); }
});

test("a code ends after a minute", async () => {
  const s = await rig();
  try {
    s.codes.set(CODE, { siteId: "sit_one", at: 1_000 });
    s.tick(60_001);
    assert.equal((await s.get(`/x/${CODE}`)).status, 404);
  } finally { await s.close(); }
});

test("the clean address serves the page with the cookie and says no access without it; revoking the share ends it on the next request", async () => {
  const s = await rig();
  try {
    s.codes.set(CODE, { siteId: "sit_one", at: 1_000 });
    const cookie = `${ARTIFACT_COOKIE}=${cookieOf(await s.get(`/x/${CODE}`))}`;
    const page = await s.get("/sit_one/", { cookie });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<p>page index.html</p>");
    const csp = page.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes(PUBLIC_SANDBOX) && !csp.includes("allow-same-origin"), "sandboxed like every public page");
    assert.ok(csp.includes("frame-ancestors https://mla.vyre.run tauri://localhost http://tauri.localhost https://tauri.localhost"), "framed by the app's origins only");
    const none = await s.get("/sit_one/");
    assert.equal(none.status, 403);
    assert.match(await none.text(), /You don&#39;t have access to this page.*https:\/\/mla\.vyre\.run\/a\/sit_one/s);
    assert.equal((await s.get("/sit_two/", { cookie })).status, 403, "that session is for one artifact");
    s.shared.delete("usr_aliza");
    assert.equal((await s.get("/sit_one/", { cookie })).status, 403, "removed from the share: out at once");
  } finally { await s.close(); }
});

test("another host is not ours: the app's origin falls through untouched, with its own rules", async () => {
  const s = await rig();
  try {
    const r = await raw(s.url, "/a/sit_one/", { host: "mla.vyre.run", cookie: `${ARTIFACT_COOKIE}=${"c".repeat(48)}` });
    assert.equal(await r.text(), "the app");
  } finally { await s.close(); }
});
