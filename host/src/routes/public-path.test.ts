// The public path in the daemon: nothing that names a person gets in, nothing the browser applies to the origin gets out, and nothing under /p/ falls through to a signed-in route.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { APP_FRAME_ANCESTORS, createPublicPathRoute, formTarget, PUBLIC_SANDBOX } from "./public-path.ts";
import { publicPathOk } from "../seams/relay.ts";

async function serve(inner: { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } | null): Promise<{ url: string; fell: string[]; close(): Promise<void> }> {
  const fell: string[] = [];
  const route = createPublicPathRoute({ forms: () => inner, origin: () => "https://harbor.vyre.run" });
  const server = http.createServer((req, res) => { if (route.handle(req, res)) return; fell.push(req.url ?? ""); res.writeHead(200); res.end("the app"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fell, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("formTarget: each op of a form page goes to its one handler, with its method, and anything else goes nowhere", () => {
  const u = (s: string): URL => new URL(s, "http://x");
  assert.equal(formTarget("GET", false, "quote", u("/p/forms/quote?t=abc")), "/f/quote?t=abc");
  assert.equal(formTarget("GET", true, "meet", u("/p/forms/book/meet")), "/book/meet");
  assert.equal(formTarget("POST", false, "quote", u("/p/forms/quote?op=submit")), "/f/submit");
  assert.equal(formTarget("POST", false, "quote", u("/p/forms/quote?op=upload&t=abc")), "/f/upload/quote?t=abc");
  assert.equal(formTarget("POST", true, "meet", u("/p/forms/book/meet?op=create")), "/book/create");
  assert.equal(formTarget("GET", true, "meet", u("/p/forms/book/meet?op=availability&slug=meet&tz=UTC")), "/book/availability?slug=meet&tz=UTC");
  assert.equal(formTarget("POST", false, "quote", u("/p/forms/quote")), null);
  assert.equal(formTarget("GET", false, "quote", u("/p/forms/quote?op=submit")), null);
  assert.equal(formTarget("POST", true, "quote", u("/p/forms/quote?op=submit")), null);
  assert.equal(formTarget("POST", false, "quote", u("/p/forms/quote?op=anything")), null);
});

test("/p/forms: Cookie, Authorization and a forged address never reach the form; the visitor the relay saw does; Set-Cookie never leaves; the sandbox joins the page's own policy", async () => {
  let seen: http.IncomingHttpHeaders = {};
  let path = "";
  const s = await serve({ handle(req, res) { seen = { ...req.headers }; path = req.url ?? ""; res.setHeader("set-cookie", "a=1"); res.writeHead(200, { "content-security-policy": "default-src 'none'", "set-cookie": "b=2", "content-type": "text/html" }); res.end("form"); return true; } });
  try {
    const r = await fetch(`${s.url}/p/forms/quote?t=abc`, { headers: { cookie: "s=1", authorization: "Bearer stolen", "x-forwarded-for": "1.2.3.4", "x-vyre-public-base": "/evil", "x-vyre-visitor": "203.0.113.7" } });
    assert.equal(await r.text(), "form");
    assert.equal(path, "/f/quote?t=abc");
    for (const h of ["cookie", "authorization", "x-vyre-visitor"]) assert.equal(seen[h], undefined, h);
    assert.equal(seen["x-forwarded-for"], "203.0.113.7");
    assert.equal(seen["x-vyre-public-base"], "/p/forms/quote");
    assert.equal(seen["x-vyre-public-origin"], "https://harbor.vyre.run");
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal(r.headers.get("content-security-policy"), `default-src 'none', ${PUBLIC_SANDBOX}`);
    assert.ok(!PUBLIC_SANDBOX.includes("allow-same-origin"));
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
  } finally { await s.close(); }
});

test("nothing under /p/ falls through to a route behind it, and everything else does", async () => {
  const s = await serve({ handle() { return false; } });
  try {
    for (const p of ["/p", "/p/", "/p/v1/identity.whoami", "/p/forms/quote/extra", "/p/forms/Bad_Slug"]) {
      const r = await fetch(`${s.url}${p}`);
      assert.equal(r.status, 404, p);
      assert.ok(String(r.headers.get("content-security-policy")).includes(PUBLIC_SANDBOX), p);
    }
    assert.equal((await fetch(`${s.url}/p/forms/quote`)).status, 404, "a form the handler does not know");
    assert.deepEqual(s.fell, []);
    assert.equal(await (await fetch(`${s.url}/f/quote`)).text(), "the app");
    assert.deepEqual(s.fell, ["/f/quote"]);
  } finally { await s.close(); }
});

test("publicPathOk: the box passes only the plain public path to the gateway", () => {
  for (const p of ["/p", "/p/", "/p/forms/quote?op=submit&x=..%2f", "/p/site/a/b.css"]) assert.ok(publicPathOk(p), p);
  for (const p of ["/", "/v1/identity.whoami", "/pp", "/p/../v1/x", "/p/%2e%2e/v1/x", "/p/.%2e/v1/x", "/p/..%2fv1", "/p/a%2Fb", "/p/a%5cb", "/p/a\\b", `/p/${"a".repeat(5000)}`]) assert.ok(!publicPathOk(p), p);
});

test("an artifact's plain address opens the app, and only a token below it serves anything", async () => {
  const s = await serve(null);
  try {
    const r = await fetch(`${s.url}/a/sit_abc`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/#subject=artifact:sit_abc");
    // a token in the address is gone: the public path answers nothing for it
    const miss = await fetch(`${s.url}/a/sit_abc/k/${"0".repeat(48)}/`);
    assert.ok(!(await miss.text()).includes("the page"), "the public path serves no artifact for it; the app takes the request");
    assert.match(APP_FRAME_ANCESTORS, /^frame-ancestors 'self' tauri:\/\/localhost http:\/\/tauri\.localhost https:\/\/tauri\.localhost$/);
    assert.ok(!String((await fetch(`${s.url}/p/nothing/`)).headers.get("content-security-policy")).includes("frame-ancestors"));
  } finally { await s.close(); }
});

test("the desktop shell's own CSP lets its artifact viewer frame a Space's address (it fell back to default-src 'self' and the frame was blank)", async () => {
  const { readFileSync } = await import("node:fs");
  const conf = JSON.parse(readFileSync(new URL("../../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { app?: { security?: { csp?: string } } };
  const csp = conf.app?.security?.csp ?? "";
  const frame = /(?:^|;)\s*frame-src ([^;]+)/.exec(csp)?.[1] ?? "";
  assert.ok(frame.split(/\s+/).includes("https:"), `frame-src names https: (a Space's own address); csp: ${csp}`);
  assert.ok(frame.split(/\s+/).includes("http://a.localhost:*"), "and a.localhost, where a Space on this computer serves its artifacts");
  assert.ok(!/frame-src[^;]*\*(?:\s|;|$)/.test(csp.replace(/:\*/g, "")), "no bare wildcard");
});
