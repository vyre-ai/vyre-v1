// @ts-check
// The relay's HTTP server keeps an idle connection open longer than a proxy or a browser leaves it idle (Node's default closes it at 5 s, and a request sent on it at that moment is reset).
import test from "node:test";
import assert from "node:assert/strict";
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
