// @reads /modules/sync/migrations/0001_pull.sql
// P-H_01: sync.push is exported with the pull handlers, and a host Ctx becomes the device session they read.
import test from "node:test";
import assert from "node:assert/strict";
import { createPullHandlers, createPushHandlers, toPullCtx } from "../handlers/index.ts";
import { handlers, setPushDeps } from "../impl.ts";

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

test("P-H_02: the impl exposes a handlers map the loader can read, and sync.push refuses until the host gives it its dependencies", async () => {
  assert.deepEqual(Object.keys(handlers).sort(), ["sync.acl.reindex", "sync.devices.lag", "sync.doc.close", "sync.doc.compact", "sync.doc.open", "sync.doc.update", "sync.endpoints", "sync.entities", "sync.epoch.bump", "sync.health", "sync.hello", "sync.pull", "sync.push", "sync.snapshot.begin", "sync.snapshot.page", "sync.status"]);
  const trace = { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" };
  setPushDeps(null);
  await assert.rejects(async () => handlers["sync.push"]({ trace, principal: { kind: "person", id: "usr_dana" }, device: "dev_a" }, {} as never), (e: { error?: { code?: string } }) => e.error?.code === "internal.unavailable");
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
// P-H_02 final run: this file shows its own ok line in the run on the last commit.
