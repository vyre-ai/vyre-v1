// The edge a browser walk opens: it holds its port from the first moment, says so plainly when the port is taken, and fronts a daemon that is still starting.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { edge } from "../../apps/app/tests/real-app-harness.test.ts";

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "edge-dist-"));
fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>app</title>");

test("an edge asked for a port someone else holds fails with an error to catch, not an uncaught one that leaves the walk's daemon running", async () => {
  const taken = http.createServer();
  await new Promise<void>((r) => taken.listen(0, "127.0.0.1", () => r()));
  const port = (taken.address() as { port: number }).port;
  try {
    await assert.rejects(edge(dist, "http://127.0.0.1:1", undefined, port), /EADDRINUSE/);
  } finally { taken.close(); }
});

test("an edge listens before its daemon exists: the app is served at once, the gateway answers 'still starting' until the daemon's address is known, then passes through", async () => {
  let daemonUrl = "";
  const e = await edge(dist, () => daemonUrl);
  const daemon = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"data":"from the daemon"}'); });
  try {
    assert.match(await (await fetch(`${e.origin}/`)).text(), /<title>app<\/title>/);
    assert.equal((await fetch(`${e.origin}/v1/spaces/get`, { method: "POST" })).status, 503);
    await new Promise<void>((r) => daemon.listen(0, "127.0.0.1", () => r()));
    daemonUrl = `http://127.0.0.1:${(daemon.address() as { port: number }).port}`;
    assert.equal(await (await fetch(`${e.origin}/v1/spaces/get`, { method: "POST" })).text(), '{"data":"from the daemon"}');
  } finally { e.close(); daemon.close(); }
});
