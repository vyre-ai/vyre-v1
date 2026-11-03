// GET /local/daemon/busy and POST /local/daemon/drain: what the desktop shell asks before it stops a daemon to update the app. Loopback and the admin token only; a turn that can go on on the server
// is handed over on drain, one that cannot is counted and waited for.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { createLocalWork, createLocalWorkRoute } from "../src/routes/local-work.ts";

const same = (a: string, b: string): boolean => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function rig() {
  const work = createLocalWork();
  const route = createLocalWorkRoute({ token: "adm_1", work, sameToken: same });
  const server = http.createServer((req, res) => { if (!route.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const call = (p: string, method = "GET", token = "adm_1") => new Promise<{ status: number; body: { data?: { turns: number; sources: Array<{ name: string; turns: number }> } } }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: token ? { authorization: `Bearer ${token}` } : {} }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve({ status: r.statusCode ?? 0, body: b ? JSON.parse(b) : {} }));
    });
    req.on("error", reject);
    req.end();
  });
  return { work, call, close: () => server.close() };
}

test("busy counts the turns of every source; nothing running is 0", async () => {
  const r = await rig();
  try {
    assert.deepEqual((await r.call("/local/daemon/busy")).body.data, { turns: 0, sources: [] });
    let engine = 2;
    r.work.add({ name: "engine", running: () => engine });
    const off = r.work.add({ name: "links", running: () => 1 });
    const b = await r.call("/local/daemon/busy");
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.data, { turns: 3, sources: [{ name: "engine", turns: 2 }, { name: "links", turns: 1 }] });
    engine = 0; off();
    assert.equal((await r.call("/local/daemon/busy")).body.data?.turns, 0);
  } finally { r.close(); }
});

test("drain hands over the turns a source can move to the server and leaves the ones it cannot to be waited for", async () => {
  const r = await rig();
  try {
    let linked = 2, local = 1;
    const handed: string[] = [];
    r.work.add({ name: "engine", running: () => local });
    r.work.add({ name: "links", running: () => linked, handOver: async () => { handed.push("links"); linked = 0; } });
    r.work.add({ name: "idle", running: () => 0, handOver: () => { handed.push("idle"); } });
    const d = await r.call("/local/daemon/drain", "POST");
    assert.equal(d.status, 200);
    assert.deepEqual(handed, ["links"], "only a source with turns running hands over");
    assert.deepEqual(d.body.data, { turns: 1, sources: [{ name: "engine", turns: 1 }, { name: "links", turns: 0 }, { name: "idle", turns: 0 }] });
    local = 0;
    assert.equal((await r.call("/local/daemon/drain", "POST")).body.data?.turns, 0);
  } finally { r.close(); }
});

test("a source that throws counts as nothing and a failed hand-over still answers", async () => {
  const r = await rig();
  try {
    r.work.add({ name: "broken", running: () => { throw new Error("gone"); } });
    r.work.add({ name: "stuck", running: () => 1, handOver: () => Promise.reject(new Error("the Space is unreachable")) });
    const d = await r.call("/local/daemon/drain", "POST");
    assert.deepEqual(d.body.data, { turns: 1, sources: [{ name: "broken", turns: 0 }, { name: "stuck", turns: 1 }] });
  } finally { r.close(); }
});

test("without the admin token it is 401, a wrong method is 405, and any other path is not this route", async () => {
  const r = await rig();
  try {
    assert.equal((await r.call("/local/daemon/busy", "GET", "")).status, 401);
    assert.equal((await r.call("/local/daemon/busy", "GET", "adm_2")).status, 401);
    assert.equal((await r.call("/local/daemon/drain", "GET")).status, 405);
    assert.equal((await r.call("/local/daemon/busy", "POST")).status, 405);
    assert.equal((await r.call("/local/daemon/other")).status, 404);
  } finally { r.close(); }
});
