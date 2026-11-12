// internalOnly lets a provider-notice recorder run for the webhook route, the module's own queued poll and another module's call. A call another module only forwarded for someone is none of those.
import test from "node:test";
import assert from "node:assert/strict";
import { hostOnly, internalOnly } from "../src/ctx/host-only.ts";

const trace = { traceId: "ab".repeat(16) };
const refused = (fn: () => void): void => assert.throws(fn, (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant");

test("internalOnly: the webhook route, a queued poll and another module's call pass", () => {
  internalOnly({ origin: "hook", depth: 0, trace }, "x.receive");
  internalOnly({ origin: "schedule", depth: 0, trace }, "x.receive");
  internalOnly({ origin: "user", depth: 1, trace }, "x.receive");
  internalOnly({ origin: "user", depth: 1, forwarded: false, trace }, "x.receive");
});

test("internalOnly: a person at the gateway is refused", () => {
  refused(() => internalOnly({ origin: "user", depth: 0, trace }, "x.receive"));
  refused(() => internalOnly({ origin: "mcp", depth: 0, trace }, "x.receive"));
});

test("internalOnly: a forwarded call is refused whatever its depth or origin, even when the origin is schedule or hook", () => {
  for (const origin of ["user", "schedule", "hook", "gate", "module"]) {
    for (const depth of [0, 1, 2, 5]) refused(() => internalOnly({ origin, depth, forwarded: true, trace }, "x.receive"));
  }
});

test("hostOnly: still only the host's own top-level hook call", () => {
  hostOnly({ origin: "hook", depth: 0, trace }, "x.hook");
  refused(() => hostOnly({ origin: "hook", depth: 1, trace }, "x.hook"));
  refused(() => hostOnly({ origin: "user", depth: 0, trace }, "x.hook"));
});
