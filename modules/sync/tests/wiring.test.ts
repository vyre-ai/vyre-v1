// @reads /modules/sync/migrations/0001_pull.sql
// P-H_01: sync.push is exported with the pull handlers, and a host Ctx becomes the device session they read.
import test from "node:test";
import assert from "node:assert/strict";
import { createPullHandlers, createPushHandlers, toPullCtx } from "../handlers/index.ts";

test("the handler index exports pull and push together", () => {
  assert.equal(typeof createPullHandlers, "function");
  assert.equal(typeof createPushHandlers, "function");
});

test("toPullCtx carries person, device and trace, and defaults the class", () => {
  const trace = { traceId: "0123456789abcdef0123456789abcdef" };
  assert.deepEqual(toPullCtx({ trace, principal: { id: "usr_dana" }, device: "dev_a" }, "phone"), { trace, principal: "usr_dana", deviceId: "dev_a", deviceClass: "phone" });
  assert.equal(toPullCtx({ trace, principal: { id: "usr_dana" }, device: "dev_a" }).deviceClass, "desktop");
  assert.equal(toPullCtx({ trace, principal: { id: "usr_dana" } }).deviceId, "", "no device: the push handler's own device check refuses it");
});
