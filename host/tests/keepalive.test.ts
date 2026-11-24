// A connection a client has used stays open for longer than a client or a proxy leaves it idle. Node closes an idle connection after 5 s; a reverse proxy (Caddy keeps upstream connections for 2 minutes) or a browser
// that sends on it at that moment gets a reset, and a POST is not retried: a person's save fails at random (CI, 24 Nov: overview.real, "read ECONNRESET" on POST /v1/records/update after about 10 s idle).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { KEEP_ALIVE_MS, createLiveHub } from "../src/ws.ts";

test("the daemon's server keeps an idle connection open longer than a proxy does, and its header time is longer still", () => {
  const hub = createLiveHub({ session: () => null });
  try {
    assert.ok(hub.server.keepAliveTimeout >= 120_000, `keepAliveTimeout ${hub.server.keepAliveTimeout} ms`);
    assert.ok(hub.server.headersTimeout > hub.server.keepAliveTimeout, "headersTimeout is above keepAliveTimeout");
    assert.equal(KEEP_ALIVE_MS, hub.server.keepAliveTimeout);
  } finally {
    void hub.close();
  }
});

test("a POST sent on a reused connection after 6 s idle goes out on the same connection and is answered", async () => {
  const hub = createLiveHub({ session: () => null });
  const port = await hub.listen(0);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const post = (): Promise<{ status: number; localPort: number }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          agent,
          path: "/v1/x",
          headers: { "content-type": "application/json", "content-length": 2 },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0, localPort: req.socket?.localPort ?? 0 }));
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
  try {
    const first = await post();
    await new Promise((r) => setTimeout(r, 6_000));
    const second = await post();
    assert.equal(second.status, 426, "the hub answers (it is not a gateway: upgrade required)");
    assert.equal(
      second.localPort,
      first.localPort,
      "the second request reused the first connection: the server did not close it at 5 s",
    );
  } finally {
    agent.destroy();
    await hub.close();
  }
});
