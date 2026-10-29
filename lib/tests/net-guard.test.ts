// The guarded fetch the API drivers use for an address a person typed: it checks, then connects to the checked address, streams the body, and honours abort.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AddressRefused, createGuardedFetch } from "../net-guard.ts";

async function server(h: http.RequestListener) {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { port: (s.address() as AddressInfo).port, close: () => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }) };
}

test("a guarded fetch streams a body from a checked address, sends the request body, and reads text and json", async () => {
  const got: string[] = [];
  const s = await server((req, res) => { const p: Buffer[] = []; req.on("data", (c) => p.push(c)); req.on("end", () => { got.push(Buffer.concat(p).toString()); res.writeHead(200, { "x-a": "b" }); res.write("one "); setTimeout(() => res.end("two"), 10); }); });
  const f = createGuardedFetch({ own: true });
  const r = await f(`http://127.0.0.1:${s.port}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}', signal: new AbortController().signal });
  assert.deepEqual([r.ok, r.status, r.headers.get("X-A")], [true, 200, "b"]);
  let text = "";
  for await (const c of r.body!) text += Buffer.from(c).toString();
  assert.equal(text, "one two");
  assert.deepEqual(got, ['{"a":1}']);
  await s.close();
});

test("a guarded fetch refuses loopback off the own computer and link-local always, before any connection", async () => {
  const s = await server((_q, res) => { got += 1; res.end("x"); });
  let got = 0;
  const sig = new AbortController().signal;
  await assert.rejects(createGuardedFetch({ own: false })(`http://127.0.0.1:${s.port}/`, { method: "GET", headers: {}, signal: sig }), AddressRefused);
  await assert.rejects(createGuardedFetch({ own: true })("http://169.254.169.254/", { method: "GET", headers: {}, signal: sig }), AddressRefused);
  assert.equal(got, 0);
  await s.close();
});

test("aborting the signal ends a stream in progress", async () => {
  const s = await server((_q, res) => { res.writeHead(200); res.write("start"); });
  const ac = new AbortController();
  const r = await createGuardedFetch({ own: true })(`http://127.0.0.1:${s.port}/`, { method: "GET", headers: {}, signal: ac.signal });
  const it = r.body![Symbol.asyncIterator]();
  assert.equal(Buffer.from((await it.next()).value as Uint8Array).toString(), "start");
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(it.next());
  await s.close();
});
