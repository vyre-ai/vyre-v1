// The module entry: every capability the manifest declares for stripe has a handler, and the handlers answer through the entry the host loads.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers, verifyWebhook } from "../impl.ts";
import { contractErrors, EVENTS, harness, NOW, RECORDED, WEBHOOK_SECRET } from "../fixtures/harness.ts";
import { signatureOf } from "../handlers/index.ts";

test("impl serves exactly the capabilities the manifest declares for stripe", () => {
  const declared = [...new Set(registry.capabilities.filter((c) => c.module === "stripe").map((c) => c.name))].sort();
  assert.equal(declared.length, 19);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
});

test("a read, a write and the webhook go through the entry the host loads and answer in the frozen shapes", async () => {
  const h = harness();
  const ctx = h.ctx as never;
  h.on("GET /v1/balance", { status: 200, body: RECORDED.balance });
  assert.deepEqual(contractErrors("stripe.health", "out", await handlers["stripe.health"]!(ctx, {})), []);
  h.on("GET /v1/customers/cus_NffrFeUfNV2Hib", { status: 200, body: RECORDED.customer });
  assert.deepEqual(contractErrors("stripe.customer.get", "out", await handlers["stripe.customer.get"]!(ctx, { customerId: "cus_NffrFeUfNV2Hib" })), []);
  const body = JSON.stringify(EVENTS.paid);
  const t = Math.floor(NOW / 1000);
  const input = await verifyWebhook(h.ctx, { signature: `t=${t},v1=${await signatureOf(WEBHOOK_SECRET, t, body)}`, body });
  const out = await handlers["stripe.receive_webhook"]!({ ...ctx, origin: "hook", depth: 0 }, input);   // only the server records a webhook (host-only)
  assert.deepEqual(contractErrors("stripe.receive_webhook", "out", out), []);
  assert.deepEqual(h.emitted.map((e) => e.name), ["stripe.event_received", "payment.succeeded"]);
});

test("stripe.receive_webhook is host-only: a call from a person, another module or anything but the server's own host call is refused", async () => {
  const h = harness();
  const ctx = h.ctx as never;
  for (const call of [{ origin: "user", depth: 0 }, { origin: "mcp", depth: 0 }, { origin: "hook", depth: 1 }]) {
    await assert.rejects(handlers["stripe.receive_webhook"]!({ ...(ctx as object), ...call } as never, { eventId: "e", type: "x", objectId: "o", amount: 0, currency: "USD", at: 1 }), (e: { error?: { code?: string } }) => e.error?.code === "permission.no_grant", JSON.stringify(call));
  }
});
