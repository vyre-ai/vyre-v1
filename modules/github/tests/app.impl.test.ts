// The module entry: every capability the manifest declares for github has a handler, and the handlers answer through the entry the host loads.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers, signatureOf, verifyWebhook } from "../impl.ts";
import { contractErrors, harness, RECORDED, WEBHOOK_SECRET } from "../fixtures/harness.ts";

test("impl serves exactly the capabilities the manifest declares for github", () => {
  const declared = [...new Set(registry.capabilities.filter((c) => c.module === "github").map((c) => c.name))].sort();
  assert.equal(declared.length, 28);
  assert.deepEqual(Object.keys(handlers).sort(), declared);
});

test("a read, a write and the webhook go through the entry the host loads and answer in the frozen shapes", async () => {
  const h = harness();
  const ctx = h.ctx as never;
  h.on("GET /app", { status: 200, body: RECORDED.app });
  assert.deepEqual(contractErrors("github.health", "out", await handlers["github.health"]!(ctx, {})), []);
  h.reach();
  h.on("GET /repos/vyre-ai/website", { status: 200, body: RECORDED.repo });
  assert.deepEqual(contractErrors("github.repo.get", "out", await handlers["github.repo.get"]!(ctx, { repo: "vyre-ai/website" })), []);
  const body = JSON.stringify({ zen: "Keep it logically awesome." });
  const input = await verifyWebhook(h.ctx, { signature: await signatureOf(WEBHOOK_SECRET, body), event: "ping", deliveryId: "dlv-1", body });
  const out = await handlers["github.receive_webhook"]!(ctx, input);
  assert.deepEqual(contractErrors("github.receive_webhook", "out", out), []);
  assert.deepEqual(h.emitted.map((e) => e.name), ["github.event_received"]);
});
