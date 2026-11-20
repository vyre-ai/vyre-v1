import test from "node:test";
import assert from "node:assert/strict";
import { accountArrival, accountMayHaveArrived, kindReader, type ReadKind } from "./account-arrival.ts";

const kinds = (m: Record<string, string>) => async (id: string) => m[id];

test("what an event says about an AI account: connected, saved, or nothing", async () => {
  assert.equal(await accountArrival({ name: "provider.added", payload: {} }), "account");
  assert.equal(
    await accountArrival({ name: "engine.subscription_share_changed", payload: { enabled: true } }),
    "account",
  );
  assert.equal(await accountArrival({ name: "engine.subscription_share_changed", payload: { enabled: false } }), null);
  assert.equal(await accountArrival({ name: "engine.subscription_share_changed", payload: {} }), null);
  assert.equal(await accountArrival({ name: "engine.subscription_share_changed" }), null);
  assert.equal(await accountArrival({ name: "vault.item_created", payload: { kind: "ai_subscription" } }), "account");
  assert.equal(await accountArrival({ name: "vault.item_created", payload: { kind: "api_key" } }), "saved");
  for (const kind of ["login", "card", "note", "totp", "ssh_key", "env", "other"])
    assert.equal(await accountArrival({ name: "vault.item_created", payload: { kind } }), null, kind);
  assert.equal(await accountArrival({ name: "turn.completed", payload: {} }), null);
});

test("a changed item is an account only when the Vault says its kind is an AI sign-in or key; an unreadable kind counts as saved so a re-sign-in resumes", async () => {
  const read = kinds({ a: "api_key", s: "ai_subscription", l: "login", o: "other" });
  const up = (itemId: string) => ({ name: "vault.item_updated", payload: { itemId } });
  assert.equal(await accountArrival(up("a"), read), "saved");
  assert.equal(await accountArrival(up("s"), read), "saved");
  assert.equal(await accountArrival(up("l"), read), null, "a login edit");
  assert.equal(await accountArrival(up("o"), read), null, "a token refresh of another kind");
  assert.equal(await accountArrival(up("missing"), read), "saved", "an item that cannot be read");
  assert.equal(await accountArrival(up("a")), "saved", "no way to read the kind");
  assert.equal(await accountArrival(up("a"), async () => Promise.reject(new Error("down"))), "saved");
  assert.equal(await accountMayHaveArrived(up("a"), read), true);
  assert.equal(await accountMayHaveArrived(up("l"), read), false);
});

test("an update carries its own kind; the Vault is asked only when it does not, and a refusing Vault does not hide it", async () => {
  const refuse: ReadKind = async () => {
    throw new Error("not_found: a Mine item of someone else");
  };
  const up = (kind?: string) => ({ name: "vault.item_updated", payload: { itemId: "v", ...(kind ? { kind } : {}) } });
  assert.equal(await accountArrival(up("api_key"), refuse), "saved");
  assert.equal(await accountArrival(up("ai_subscription"), refuse), "saved");
  assert.equal(await accountArrival(up("login"), refuse), null);
  assert.equal(await accountArrival(up("api_key")), "saved", "no reader needed when the event has the kind");
  assert.equal(await accountArrival(up(), refuse), "saved", "an older event the Vault refuses still resumes");
  // the event's kind wins over the Vault
  assert.equal(await accountArrival(up("login"), kinds({ v: "api_key" })), null);
});

test("kindReader reads the kind once through vault.item.get and survives a refusal", async () => {
  const calls: unknown[] = [];
  const read = kindReader(async (cap, input) => {
    calls.push([cap, input]);
    return { item: { kind: "api_key" } };
  })!;
  assert.equal(await read("vit_1"), "api_key");
  assert.deepEqual(calls, [["vault.item.get", { itemId: "vit_1" }]]);
  assert.equal(await kindReader(async () => Promise.reject(new Error("no")))!("vit_2"), undefined);
  assert.equal(kindReader(undefined), undefined);
});
