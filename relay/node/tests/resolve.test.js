// from vyre 0.6.9 relay/node/resolve.test.js@57ce975b8
// The edge's question to the directory, over HTTP against a stand-in that speaks the directory's wire: GET /v1/tunnel/resolve?host=, the relay's secret in x-vyre-relay, every
// answer wrapped as { data: ... }. The first version of this question read the answer as { route } while the directory sends { data: { route } }, so a real edge served no one;
// every other test of the tunnel used a lookup of its own shape. Fail closed: any answer that is not a route for exactly this host, any error and any timeout is "nobody serves it".
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { directoryResolve } from "../resolve.js";
import { newRouteKey, routeId } from "../wire.js";

const SECRET = "s".repeat(40);

/** A directory that serves one declared host to one route, with a suspend switch. */
async function standIn(/** @type {string} */ host, /** @type {string} */ route) {
  const state = { suspended: false, asked: /** @type {string[]} */ ([]) };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://dir");
    res.setHeader("content-type", "application/json");
    if (u.pathname !== "/v1/tunnel/resolve" || req.headers["x-vyre-relay"] !== SECRET) { res.statusCode = 403; res.end(JSON.stringify({ error: "no" })); return; }
    const asked = u.searchParams.get("host") || "";
    state.asked.push(asked);
    if (asked !== host || state.suspended) { res.statusCode = 404; res.end(JSON.stringify({ error: "unknown" })); return; }
    res.end(JSON.stringify({ data: { route } }));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return { url, state, close: () => new Promise(r => { server.close(() => r(undefined)); server.closeAllConnections(); }) };
}

test("the edge finds the route of a host a box declared, and only that", async t => {
  const k = newRouteKey(), route = routeId(k.pub);
  const dir = await standIn("documents.harlow.vyre.run", route);
  t.after(() => dir.close());
  const resolve = directoryResolve({ base: dir.url, secret: SECRET });
  assert.deepEqual(await resolve("documents.harlow.vyre.run"), { route }, "the declared host is served by the box that declared it");
  for (const h of ["harlow.vyre.run", "a.b.harlow.vyre.run", "documents.nobody.vyre.run", "documents.harlow.example.com", ""]) assert.equal(await resolve(h), null, `${h || "(empty)"} is nobody's`);
  // the relay's secret is the only way to ask: a wrong one is a plain no, and so is a directory that is down or slow
  assert.equal(await directoryResolve({ base: dir.url, secret: "x".repeat(40) })("documents.harlow.vyre.run"), null);
  assert.equal(await directoryResolve({ base: "http://127.0.0.1:1", secret: SECRET })("documents.harlow.vyre.run"), null);
  const slow = directoryResolve({ base: dir.url, secret: SECRET, timeoutMs: 50, fetch: (_u, o) => new Promise((_ok, no) => { /** @type {any} */ (o).signal.addEventListener("abort", () => no(new Error("timed out"))); }) });
  assert.equal(await slow("documents.harlow.vyre.run"), null);
  // the support switch takes the host away at the next question
  dir.state.suspended = true;
  assert.equal(await resolve("documents.harlow.vyre.run"), null, "suspended: not served");
});

test("an answer that is not { data: { route: string } } is nobody's", async t => {
  for (const body of [{ route: "x" }, { data: {} }, { data: { route: 5 } }, { data: null }, "nope"]) {
    const server = http.createServer((_q, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); });
    await new Promise(r => server.listen(0, "127.0.0.1", () => r(undefined)));
    t.after(() => { server.close(); server.closeAllConnections(); });
    const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    assert.equal(await directoryResolve({ base, secret: SECRET })("documents.harlow.vyre.run"), null, JSON.stringify(body));
  }
});
