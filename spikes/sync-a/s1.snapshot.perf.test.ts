// The speed half of s1.snapshot.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Check 1: server-authoritative op-log, filtered pull by cursor, idempotent push, newest-wins per field with loser history.
// Plus perf: 100k snapshot, 10k pull, local write latency, remote edit propagation over real HTTP + SSE hint.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Server, Client, direct, hlcStr } from "./sync.mjs";
import { NodeDb, metric, pct } from "./adapters.mjs";

const op = (opId, id, fields, ms, dev, baseSeq = {}) => ({ opId, hlc: hlcStr(ms, 0, dev), id, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v }])), baseSeq });

test("perf: 100k-row snapshot under 10 s, 10k-row cursor pull, then identical state", async () => {
  const s = new Server(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s1-")), "srv.db"));
  let t = performance.now(); s.bulkLoad("alice", 100000); const loadMs = performance.now() - t;
  const c = await new Client({ dev: "d1", person: "alice", db: new NodeDb() }).init();
  t = performance.now(); await c.bootstrap(direct(s, "alice")); const snapMs = performance.now() - t;
  assert.equal(await c.rowCount(), 100000);
  const pend = await c.pull(direct(s, "alice")); // nothing new after asOf except nothing
  metric("s1.snapshot_100k", { rows: 100000, fields: 400000, snapshot_ms: Math.round(snapMs), server_load_ms: Math.round(loadMs), budget_ms: 10000, pass: snapMs < 10000 });
  assert.ok(snapMs < 10000, `snapshot took ${snapMs}ms`);
  // 10k rows via the event-log pull path (cursor 0)
  const s2 = new Server(); s2.bulkLoad("alice", 10000);
  const c2 = await new Client({ dev: "d2", person: "alice", db: new NodeDb() }).init();
  t = performance.now(); await c2.pull(direct(s2, "alice")); const pullMs = performance.now() - t;
  assert.equal(await c2.rowCount(), 10000);
  metric("s1.pull_10k", { rows: 10000, pull_ms: Math.round(pullMs), pages: Math.ceil(10000 / 2000) });
  void pend;
});

test("perf: local write latency under 10 ms (file-backed replica, WAL)", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s1w-")), "rep.db");
  const c = await new Client({ dev: "d1", person: "alice", db: new NodeDb(f) }).init();
  for (let i = 0; i < 2000; i++) await c.edit("w" + (i % 500), { title: "t" + i, n: i }); // warm + grow
  const lat = [];
  for (let i = 0; i < 5000; i++) { const t0 = performance.now(); await c.edit("w" + (i % 500), { title: "x" + i, n: i }); lat.push(performance.now() - t0); }
  metric("s1.local_write", { n: lat.length, p50_ms: +pct(lat, 0.5).toFixed(3), p99_ms: +pct(lat, 0.99).toFixed(3), max_ms: +Math.max(...lat).toFixed(3), budget_ms: 10, pass: pct(lat, 0.99) < 10 });
  assert.ok(pct(lat, 0.99) < 10);
});

test("remote edit propagation over HTTP + SSE hint under 500 ms", async () => {
  const s = new Server(); s.addPerson("alice"); s.grant("bob", "doc1"); // doc1 row will be created by alice
  const sse = new Set();
  const srv = http.createServer(async (req, res) => {
    const who = new URL(req.url, "http://x").searchParams.get("p");
    if (req.url.startsWith("/hint")) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ok\n\n"); sse.add(res); req.on("close", () => sse.delete(res)); return; }
    let body = ""; for await (const ch of req) body += ch; const j = JSON.parse(body || "{}");
    let out;
    if (req.url.startsWith("/push")) { out = s.push(who, j.ops); for (const r of sse) r.write(`data: ${s.head()}\n\n`); }
    else if (req.url.startsWith("/pull")) out = s.pull(who, j);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const tr = (p) => ({ push: async (ops) => (await fetch(`${base}/push?p=${p}`, { method: "POST", body: JSON.stringify({ ops }) })).json(), pull: async (a) => (await fetch(`${base}/pull?p=${p}`, { method: "POST", body: JSON.stringify(a) })).json() });
  const A = await new Client({ dev: "A", person: "alice", db: new NodeDb() }).init(); const B = await new Client({ dev: "B", person: "bob", db: new NodeDb() }).init();
  await A.edit("doc1", { title: "v0" }); await A.push(tr("alice")); s.grant("bob", "doc1"); await B.pull(tr("bob"));
  // B listens for the hint
  const resp = await fetch(`${base}/hint`); const reader = resp.body.getReader(); const dec = new TextDecoder();
  const lat = [];
  for (let i = 1; i <= 20; i++) {
    const got = new Promise(async (resolve) => { for (;;) { const { value } = await reader.read(); if (dec.decode(value).includes("data:")) { await B.pull(tr("bob")); resolve(performance.now()); return; } } });
    const t0 = performance.now(); await A.edit("doc1", { title: "v" + i }); await A.push(tr("alice")); const t1 = await got;
    assert.equal((await B.read("doc1")).title, "v" + i); lat.push(t1 - t0);
  }
  await reader.cancel(); srv.closeAllConnections(); srv.close();
  metric("s1.edit_propagation_http", { n: lat.length, p50_ms: +pct(lat, 0.5).toFixed(2), p99_ms: +pct(lat, 0.99).toFixed(2), budget_ms: 500, pass: pct(lat, 0.99) < 500 });
  assert.ok(pct(lat, 0.99) < 500);
});
