// The box's half of the artifact host (host/src/seams/relay.ts): the relay marks a request as the artifact host's (a: true, with its host name) and only then does a cookie go in, a Set-Cookie come out and the
// artifact paths pass. The app's origin keeps its rule exactly: no Cookie ever, and the artifact paths are not its paths.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { artifactPathOk, publicPathOk, servePublic } from "../host/src/seams/relay.ts";

const CODE = "a".repeat(48);

test("artifactPathOk: the code and an artifact's own address, nothing near them", () => {
  for (const p of [`/x/${CODE}`, `/x/${CODE}/`, `/x/${CODE}?embed=1`, "/sit_abc/", "/sit_abc/assets/app.js?v=1", "/sit_abc"]) assert.equal(artifactPathOk(p), true, p);
  for (const p of ["/", "/x/short", "/x/zz", "/v1/identity/whoami", "/mcp", "/sit_abc/../v1/x", "/sit_abc/%2e%2e/x", "/sit_abc/a%2Fb", "/p/forms/quote", "/a/sit_abc/", `/x/${CODE}/../v1`]) assert.equal(artifactPathOk(p), false, p);
  assert.equal(publicPathOk("/sit_abc/"), false, "not a path of the app's origin");
});

test("cookies cross only for the artifact host: its cookie goes in, its Set-Cookie comes out; on the app's origin the Cookie is dropped and the artifact paths are refused", async (t) => {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => { seen.push({ url: req.url ?? "", headers: req.headers }); req.resume(); res.writeHead(200, { "set-cookie": ["__vyre_a=s1; Path=/; HttpOnly; Secure; SameSite=Lax"], "content-type": "text/plain" }); res.end("ok"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const ask = (path: string, extra: Record<string, unknown>): Promise<unknown[]> => new Promise((resolve) => {
    const sent: unknown[] = [];
    servePublic((m) => { sent.push(m); if ((m as { t: string }).t === "p.end" || (m as { t: string }).t === "p.err") resolve(sent); }, { id: "r1", method: "GET", path, ip: "203.0.113.9", headers: { cookie: "__vyre_a=abc; other=1", "user-agent": "x" }, ...extra }, new Uint8Array(0), port);
  });
  const head = (sent: unknown[]): { status: number; headers: Record<string, string> } => sent.find((m) => (m as { t: string }).t === "p.res") as never;

  const on = await ask("/sit_abc/", { a: true, host: "mla-a.vyre.run" });
  assert.equal(seen.at(-1)!.headers.cookie, "__vyre_a=abc; other=1");
  assert.equal(seen.at(-1)!.headers.host, "mla-a.vyre.run");
  assert.match(head(on).headers["set-cookie"] ?? "", /^__vyre_a=s1; Path=\/; HttpOnly; Secure; SameSite=Lax/);

  const app = await ask("/p/forms/quote", {});
  assert.equal(seen.at(-1)!.headers.cookie, undefined, "the app's origin: no Cookie whatever the relay sent");
  assert.equal(head(app).headers["set-cookie"], undefined, "and no Set-Cookie comes back");

  const before = seen.length;
  assert.equal(head(await ask("/sit_abc/", {})).status, 400, "an artifact path on the app's origin is refused");
  assert.equal(head(await ask("/p/forms/quote", { a: true, host: "mla-a.vyre.run" })).status, 400, "and the app's paths are not the artifact host's");
  assert.equal(head(await ask("/sit_abc/", { a: true, host: "evil host" })).status, 400, "a host name that is not one is refused");
  assert.equal(seen.length, before, "none of them reached the daemon");
});
