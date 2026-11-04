// A Space on this computer (reached at 127.0.0.1) has no public address, so its artifact host is a.localhost:<port>: browsers send *.localhost to loopback, which keeps the separate origin and the
// cookie flow without a certificate. The code is on that host, the cookie has no Secure flag (the page is plain http), the keyed address does not exist, and access is asked on every request.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { boot, seededDir } from "./memory-live-kit.ts";
import { api, join, ok, standIn } from "./member-key-kit.ts";

function ask(d: { url: string }, path: string, headers: Record<string, string> = {}, host?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(d.url);
    const r = http.request({ host: u.hostname, port: u.port, path, method: "GET", headers: { host: host ?? u.host, ...headers } }, (res) => { const c: Buffer[] = []; res.on("data", (x: Buffer) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(c).toString("utf8") })); });
    r.on("error", reject); r.end();
  });
}
const cookieOf = (h: http.IncomingHttpHeaders): string => /(__vyre_a=[^;]+)/.exec(String(h["set-cookie"]?.[0] ?? ""))?.[1] ?? "";

test("a Space at 127.0.0.1 opens artifacts on a.localhost:<port>, by a one-time code, with no token in any address", { timeout: 120_000 }, async () => {
  delete process.env["VYRE_ARTIFACT_HOST"];
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    const port = new URL(d.url).port;
    const HOST = `a.localhost:${port}`;
    const rubab = await join(d, "rubab");
    const sara = await join(d, "sara");
    const made = await ok(d, d.token, "sites.artifact_publish", { title: "Local test", html: "<p>local page</p>", idempotencyKey: "al-1" });
    const id = made.artifactId as string;
    await ok(d, d.token, "access.share", { resource: { type: "site", id }, subject: { kind: "person", id: rubab.personId }, level: "view", idempotencyKey: "al-share" });
    await d.hooks?.pump?.();
    assert.ok([403, 404].includes((await api(d, sara.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "al-sara" })).status), "not shared: no code");

    const open = await ok(d, rubab.token, "sites.artifact_open", { artifactId: id, idempotencyKey: "al-open" });
    const code = /\/x\/([0-9a-f]{48})/.exec(open.path)?.[1] as string;
    assert.equal(open.url, `http://${HOST}/x/${code}`, "the one-time code on a.localhost, never a keyed address");
    assert.ok(!/\/k\//.test(open.url) && !/\/k\//.test(open.path));

    // the keyed address of old serves nothing on the app's own origin
    assert.notEqual((await ask(d, `/a/${id}/k/${"0".repeat(48)}/`)).body, "<p>local page</p>");
    // the code is traded once for a cookie of that host; plain http, so no Secure flag; the address it lands on is clean
    const first = await ask(d, open.path, {}, HOST);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, `/${id}/`);
    const cookie = cookieOf(first.headers);
    assert.ok(cookie, "a session cookie");
    assert.match(String(first.headers["set-cookie"]?.[0]), /HttpOnly; SameSite=Lax/);
    assert.ok(!/Secure/.test(String(first.headers["set-cookie"]?.[0])), "plain http: no Secure flag");
    assert.equal((await ask(d, open.path, {}, HOST)).status, 404, "a second use is refused");
    // incognito: no cookie, no page; with the session: the page; the app's own origin never takes the cookie
    assert.equal((await ask(d, `/${id}/`, {}, HOST)).status, 403);
    const page = await ask(d, `/${id}/`, { cookie }, HOST);
    assert.equal(page.status, 200);
    assert.equal(page.body, "<p>local page</p>");
    assert.match(String(page.headers["content-security-policy"]), /sandbox allow-scripts/);
    assert.notEqual((await ask(d, `/${id}/`, { cookie })).body, "<p>local page</p>", "the app's origin does not serve it");
    assert.notEqual((await ask(d, `/${id}/`, { cookie }, `a.localhost:${Number(port) + 1}`)).body, "<p>local page</p>", "nor another port");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
