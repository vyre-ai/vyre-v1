// @ts-check
// The relay's HTTP server keeps an idle connection open longer than a proxy or a browser leaves it idle (Node's default closes it at 5 s, and a request sent on it at that moment is reset).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRelay } from "../server.js";

test("the relay's server keeps an idle connection open longer than a proxy does, and its header time stays at 60 s (it faces the internet)", async () => {
  const relay = createRelay();
  try {
    assert.ok(relay.server.keepAliveTimeout >= 120_000, `keepAliveTimeout ${relay.server.keepAliveTimeout} ms`);
    assert.ok(relay.server.headersTimeout <= 60_000, `headersTimeout ${relay.server.headersTimeout} ms`);
  } finally {
    await relay.close();
  }
});

/** How long the connection sits idle: above Node's old 5 s default, or the test passes without the fix. */
const IDLE_MS = 6_000;

test("a request sent on a reused connection after 6 s idle goes out on the same connection (the relay keeps it open)", async () => {
  const relay = createRelay();
  const base = await relay.listen(0);
  const port = Number(new URL(base).port);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  /** @returns {Promise<{ status: number, localPort: number }>} */
  const get = () =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/health", agent }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, localPort: req.socket?.localPort ?? 0 }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    const first = await get();
    await new Promise((r) => setTimeout(r, IDLE_MS));
    const second = await get();
    assert.equal(second.status, 200);
    assert.equal(second.localPort, first.localPort, "the relay did not close the idle connection at 5 s");
  } finally {
    agent.destroy();
    await relay.close();
  }
});
