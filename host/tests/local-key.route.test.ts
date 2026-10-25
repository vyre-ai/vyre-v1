// POST /local/vault/key/unlock and /lock (ruling 62, 63): loopback only, for the bearer's own person, on their own node, never echoing the key.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createKeyring } from "../src/seams/keyring.ts";
import { createLocalKeyRoute } from "../src/routes/local-key.ts";

async function rig(allowed: (p: string) => boolean = () => true) {
  const keyring = createKeyring({ allowed });
  const route = createLocalKeyRoute({ person: (h) => (h["authorization"] === "Bearer tok-a" ? "usr_a" : null), keyring, allowed });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const call = (p: string, o: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: o.method ?? "POST", headers: { host: `127.0.0.1:${port}`, authorization: "Bearer tok-a", "content-type": "application/json", ...o.headers } }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve({ status: r.statusCode ?? 0, body: b }));
    });
    req.on("error", reject);
    req.end(o.body === undefined ? undefined : JSON.stringify(o.body));
  });
  return { keyring, call, close: () => server.close() };
}
const B64 = Buffer.alloc(32, 5).toString("base64");

test("unlock holds the key for the bearer's person and answers 204 with nothing in the body; lock clears it", async () => {
  const r = await rig();
  try {
    const u = await r.call("/local/vault/key/unlock", { body: { key: B64 } });
    assert.deepEqual([u.status, u.body], [204, ""]);
    assert.deepEqual(r.keyring.get("usr_a"), new Uint8Array(32).fill(5));
    const l = await r.call("/local/vault/key/lock");
    assert.equal(l.status, 204);
    assert.equal(r.keyring.get("usr_a"), null);
  } finally { r.close(); }
});

test("a request that is not plainly local is refused: a proxy header, a Host that is not loopback", async () => {
  const r = await rig();
  try {
    for (const headers of [{ "x-forwarded-for": "203.0.113.9" }, { forwarded: "for=203.0.113.9" }, { host: "vault.example.com" }, { host: "127.0.0.1.evil.com" }]) {
      const x = await r.call("/local/vault/key/unlock", { headers, body: { key: B64 } });
      assert.equal(x.status, 403, JSON.stringify(headers));
    }
    assert.equal(r.keyring.get("usr_a"), null, "nothing was held");
  } finally { r.close(); }
});

test("no token is 401, a node that is not the person's own is 403, a bad key is 422, a GET is 405, and the key is never in an answer", async () => {
  const r = await rig((p) => p !== "usr_a");
  try {
    assert.equal((await r.call("/local/vault/key/unlock", { headers: { authorization: "Bearer nope" }, body: { key: B64 } })).status, 401);
    const notMine = await r.call("/local/vault/key/unlock", { body: { key: B64 } });
    assert.equal(notMine.status, 403);
    assert.ok(!notMine.body.includes(B64));
  } finally { r.close(); }
  const own = await rig();
  try {
    assert.equal((await own.call("/local/vault/key/unlock", { body: { key: "AAAA" } })).status, 422);
    assert.equal((await own.call("/local/vault/key/unlock", { body: {} })).status, 422);
    assert.equal((await own.call("/local/vault/key/unlock", { method: "GET" })).status, 405);
    assert.equal((await own.call("/other")).status, 404);
  } finally { own.close(); }
});
