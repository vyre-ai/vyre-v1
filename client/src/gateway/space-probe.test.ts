import test from "node:test";
import assert from "node:assert/strict";
import { probeDirectSpace, spaceHealth } from "./space-probe.ts";

const routes = async () => [{ method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 }];
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (status: number): Response => new Response("<!doctype html><title>Vyre</title>", { status, headers: { "content-type": "text/html; charset=utf-8" } });
const MLA_HEALTH = { ok: true, version: "1.0.0-rc.14", roles: ["space"], space: "spc_01JMLA", head: 12, startedAt: 1 };
const OPTIONS = { data: { name: "MLA", fingerprint: "ab12 cd34", password: true, github: false, sso: [], secondFactorRequired: false } };

function fake(answer: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  return { asked, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); asked.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`); return answer(url, init); }) as typeof fetch };
}

test("an mla-style server on a vyre.run name answers /healthz as a Space: direct", async () => {
  const f = fake((url) => url === "https://mla.vyre.run/healthz" ? json(200, MLA_HEALTH) : html(404));
  assert.equal(await probeDirectSpace("https://mla.vyre.run", { fetch: f.fetch, routes }), true);
  assert.deepEqual(f.asked, ["GET /healthz"], "one ask when /healthz answers");
});

test("an rc.14 server whose /healthz the desktop app cannot read (no CORS) still proves itself through the sign-in options", async () => {
  const f = fake((url) => { if (url.endsWith("/healthz")) throw new TypeError("Load failed"); return json(200, OPTIONS); });
  assert.equal(await probeDirectSpace("https://mla.vyre.run", { fetch: f.fetch, routes }), true);
  assert.deepEqual(f.asked, ["GET /healthz", "POST /v1/identity/sign_in_options"]);
});

test("a relay phone name is never direct: the shell page, asleep, 405 or 404 are not a Space's answers", async () => {
  for (const shell of [html(200), html(503), html(404), new Response(null, { status: 404 })]) {
    const f = fake((_url, init) => init?.method === "POST" ? new Response(null, { status: 405 }) : shell.clone());
    assert.equal(await probeDirectSpace("https://irfad.vyre.run", { fetch: f.fetch, routes }), false);
  }
  // the browser blocks both reads (no CORS from the relay)
  const blocked = fake(() => { throw new TypeError("Load failed"); });
  assert.equal(await probeDirectSpace("https://irfad.vyre.run", { fetch: blocked.fetch, routes }), false);
});

test("JSON that is not a Space's health (wrong role, no spc_ id, an error) is not direct", async () => {
  for (const body of [{ ok: true, roles: ["device"], space: "spc_x" }, { ok: true, roles: ["space"], space: null }, { ok: true, roles: ["space"], space: "nope" }, { data: { ok: true } }, { error: "not found" }]) {
    assert.equal(spaceHealth(body), false, JSON.stringify(body));
    const f = fake((url) => url.endsWith("/healthz") ? json(200, body) : json(404, { error: { code: "not_found", message: "no" } }));
    assert.equal(await probeDirectSpace("https://x.vyre.run", { fetch: f.fetch, routes }), false, JSON.stringify(body));
  }
  // a JSON health with an HTML content type is not taken either
  const f = fake((url) => url.endsWith("/healthz") ? new Response(JSON.stringify(MLA_HEALTH), { status: 200, headers: { "content-type": "text/html" } }) : html(405));
  assert.equal(await probeDirectSpace("https://x.vyre.run", { fetch: f.fetch, routes }), false);
});

test("a probe that times out answers false, quickly, and aborts its request", async () => {
  let aborted = 0;
  const hang: typeof fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); }); })) as typeof fetch;
  const t0 = Date.now();
  assert.equal(await probeDirectSpace("https://slow.vyre.run", { fetch: hang, routes, timeoutMs: 50 }), false);
  assert.ok(Date.now() - t0 < 2000, "both asks are bounded");
  assert.equal(aborted, 2);
});

test("an address that is not http(s) is never probed", async () => {
  const f = fake(() => json(200, MLA_HEALTH));
  for (const a of ["javascript:alert(1)", "not a url", "file:///healthz"]) assert.equal(await probeDirectSpace(a, { fetch: f.fetch, routes }), false);
  assert.deepEqual(f.asked, []);
});
