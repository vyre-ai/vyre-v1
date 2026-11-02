// POST /local/vault/key/unlock and /lock (ruling 62, 63): loopback only, for the bearer's own person, on their own node, never echoing the key.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createKeyring } from "../src/seams/keyring.ts";
import { createLocalKeyRoute } from "../src/routes/local-key.ts";

const CALLERS: Record<string, { person: string; sessionId?: string }> = { "Bearer tok-a": { person: "usr_a", sessionId: "ses_a" }, "Bearer tok-b": { person: "usr_b", sessionId: "ses_b" }, "Bearer admin": { person: "usr_a" } };

async function rig(allowed: (p: string, s?: string) => boolean = () => true, live?: (s: string) => boolean) {
  const keyring = createKeyring({ allowed, ...(live ? { live } : {}) });
  const route = createLocalKeyRoute({ caller: (h) => CALLERS[String(h["authorization"])] ?? null, keyring, allowed });
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

// Owner ruling 3 Nov (R62 amended): a Space server holds a member's key while their session is signed in. The door is /vault/key/*, https only, a device session only, bound to that session.
const SPACE = { host: "team.example.com", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" };
/** A Space server: no person's own node, so only a live session may hand a key over (daemon.ts). */
const serverRule = (alive: Set<string>) => (_p: string, s?: string): boolean => s !== undefined && alive.has(s);

test("the Space door holds a member's key over https for their own session, answers status for them alone, and drops it when the session ends", async () => {
  const alive = new Set(["ses_a", "ses_b"]);
  const r = await rig(serverRule(alive), (id) => alive.has(id));
  try {
    const u = await r.call("/vault/key/unlock", { headers: SPACE, body: { key: B64 } });
    assert.deepEqual([u.status, u.body], [204, ""]);
    assert.deepEqual(r.keyring.get("usr_a"), new Uint8Array(32).fill(5));
    assert.deepEqual(JSON.parse((await r.call("/vault/key/status", { headers: SPACE })).body), { held: true });
    // another member asks: their own answer, never usr_a's key
    assert.deepEqual(JSON.parse((await r.call("/vault/key/status", { headers: { ...SPACE, authorization: "Bearer tok-b" } })).body), { held: false });
    assert.equal(r.keyring.get("usr_b"), null);
    alive.delete("ses_a");   // sign-out, a revoked device or a password change ends the session
    assert.equal(r.keyring.get("usr_a"), null, "the key goes with the session");
  } finally { r.close(); }
});

test("the Space door refuses plain http from another machine, a session that has ended, and a caller with no device session; nothing is held", async () => {
  const alive = new Set(["ses_a"]);
  const r = await rig(serverRule(alive), (id) => alive.has(id));
  try {
    assert.equal((await r.call("/vault/key/unlock", { headers: { ...SPACE, "x-forwarded-proto": "http" }, body: { key: B64 } })).status, 403);
    assert.equal((await r.call("/vault/key/unlock", { headers: { ...SPACE, authorization: "Bearer admin" }, body: { key: B64 } })).status, 403);
    assert.equal((await r.call("/vault/key/unlock", { headers: { ...SPACE, authorization: "Bearer tok-b" }, body: { key: B64 } })).status, 403, "ses_b is not signed in");
    assert.equal((await r.call("/vault/key/unlock", { headers: SPACE, method: "GET" })).status, 405);
    assert.equal(r.keyring.holds("usr_a") || r.keyring.holds("usr_b"), false);
    // the loopback door stays local only
    assert.equal((await r.call("/local/vault/key/unlock", { headers: SPACE, body: { key: B64 } })).status, 403);
  } finally { r.close(); }
});
