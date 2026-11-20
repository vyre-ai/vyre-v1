import test from "node:test";
import assert from "node:assert/strict";
import { accountMayHaveArrived } from "./account-arrival.ts";

test("an account may have arrived for provider.added and a share turned on, never for a share turned off", () => {
  assert.equal(accountMayHaveArrived({ name: "provider.added", payload: {} }), true);
  assert.equal(accountMayHaveArrived({ name: "vault.item_created" }), true);
  assert.equal(accountMayHaveArrived({ name: "engine.subscription_share_changed", payload: { enabled: true } }), true);
  assert.equal(
    accountMayHaveArrived({ name: "engine.subscription_share_changed", payload: { enabled: false } }),
    false,
  );
  assert.equal(accountMayHaveArrived({ name: "engine.subscription_share_changed", payload: {} }), false);
  assert.equal(accountMayHaveArrived({ name: "engine.subscription_share_changed" }), false);
});
