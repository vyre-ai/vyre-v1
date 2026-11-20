// A Space that moved from the relay to its own domain on the same name: the browsers that opened it through the relay keep the relay's worker (/__vyre/sw.js, scope /). The server answers that
// script with a worker that retires itself, never cached, so the browser's own update check replaces the old worker and the page is served directly.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRelayWorkerRoute, RETIRING_WORKER } from "../src/routes/relay-worker.ts";

async function serve(): Promise<{ url: string; close(): Promise<void> }> {
  const route = createRelayWorkerRoute();
  const server = http.createServer((req, res) => {
    if (route.handle(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

test("/__vyre/sw.js is a self-retiring worker with no-store caching; nothing else is answered", async () => {
  const s = await serve();
  try {
    const r = await fetch(`${s.url}/__vyre/sw.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /javascript/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("service-worker-allowed"), "/");
    const text = await r.text();
    assert.equal(text, RETIRING_WORKER);
    for (const w of ["skipWaiting", "clients.claim", "unregister", "navigate"]) assert.ok(text.includes(w), w);
    assert.equal((await fetch(`${s.url}/__vyre/sw.js`, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(`${s.url}/__vyre/info.json`)).status, 404);
    assert.equal((await fetch(`${s.url}/__vyre/sw.js`, { method: "POST" })).status, 404);
  } finally {
    await s.close();
  }
});
