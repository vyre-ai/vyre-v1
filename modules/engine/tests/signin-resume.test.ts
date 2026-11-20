// A turn waiting for a sign-in goes on when an AI account arrives by any road: a Vault item saved, or an account connected (provider.added: a pasted key, a subscription sign-in, a Space key) or shared with the Space.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";

test("engine.signin_resume listens to every way an AI account can arrive", () => {
  const on = (consumers["engine.signin_resume"] as { on: string[] }).on;
  for (const name of [
    "vault.item_updated",
    "vault.item_created",
    "provider.added",
    "engine.subscription_share_changed",
  ])
    assert.ok(on.includes(name), `engine.signin_resume listens to ${name}`);
});
