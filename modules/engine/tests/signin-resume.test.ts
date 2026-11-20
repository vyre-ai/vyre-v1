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

test("only an event that says an AI account arrived reaches the engine: not a share turned off, a login edit or a token refresh", async () => {
  const run = (consumers["engine.signin_resume"] as { run: (c: unknown, e: unknown) => Promise<{ skipped?: string }> })
    .run;
  const withKind = (kind: string | undefined) => ({
    call: async () => {
      if (!kind) throw new Error("not found");
      return { item: { kind } };
    },
  });
  const skipped = async (c: unknown, e: unknown) => (await run(c, e)).skipped === "not_an_account";
  assert.equal(await skipped({}, { name: "engine.subscription_share_changed", payload: { enabled: false } }), true);
  assert.equal(await skipped({}, { name: "engine.subscription_share_changed", payload: { enabled: true } }), false);
  assert.equal(await skipped({}, { name: "provider.added", payload: {} }), false);
  assert.equal(
    await skipped(withKind("login"), { name: "vault.item_updated", payload: { itemId: "v" } }),
    true,
    "a login edit",
  );
  assert.equal(
    await skipped(withKind("other"), { name: "vault.item_updated", payload: { itemId: "v" } }),
    true,
    "a token refresh",
  );
  assert.equal(
    await skipped(withKind(undefined), { name: "vault.item_updated", payload: { itemId: "v" } }),
    false,
    "unreadable counts as saved",
  );
  assert.equal(await skipped(withKind("api_key"), { name: "vault.item_updated", payload: { itemId: "v" } }), false);
  // a re-sign-in of a Mine item: the Vault refuses the host, with or without the kind on the event, and the resume still goes
  assert.equal(
    await skipped(withKind(undefined), {
      name: "vault.item_updated",
      payload: { itemId: "v", kind: "ai_subscription" },
    }),
    false,
    "kind on the event",
  );
  assert.equal(
    await skipped(withKind("ai_subscription"), { name: "vault.item_created", payload: { kind: "ai_subscription" } }),
    false,
  );
});
