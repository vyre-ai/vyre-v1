// The setup offer is made only for a saved item that can be an app: a key, an env block, a login or a loose item. Cards, notes, codes, SSH keys and AI accounts make none.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";
import { connectorOffers } from "../handlers/connector-offer.ts";
import { listOpenOffers } from "../offer-store.ts";
import type { OfferDb } from "../offer-store.ts";

test("only a saved item that can be an app gets an offer", () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  for (const [id, kind] of [["vit_acme", "api_key"], ["vit_env", "env"], ["vit_login", "login"], ["vit_card", "card"], ["vit_note", "note"], ["vit_totp", "totp"], ["vit_ssh", "ssh_key"], ["vit_ai", "ai_subscription"]] as const) {
    run(ctx as never, { payload: { itemId: id, kind, name: `Name ${id}` } });
  }
  run(ctx as never, { payload: { itemId: "vit_nokind", name: "Old event" } });
  assert.deepEqual(listOpenOffers(ctx.db as OfferDb).map((o) => o.itemId).sort(), ["vit_acme", "vit_env", "vit_login", "vit_nokind"]);
});

test("an offer for a Mine item is for the person who saved it; an offer for a shared item is the Space's", () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  run(ctx as never, { actor: "usr_alice", payload: { itemId: "vit_mine", kind: "api_key", scope: "mine", name: "Mine key" } });
  run(ctx as never, { actor: "usr_alice", payload: { itemId: "vit_shared", kind: "api_key", scope: "shared", name: "Shared key" } });
  const ids = (viewer?: string): string[] => listOpenOffers(ctx.db as OfferDb, viewer).map((o) => o.itemId).sort();
  assert.deepEqual(ids("usr_alice"), ["vit_mine", "vit_shared"]);
  assert.deepEqual(ids("usr_bob"), ["vit_shared"], "another person does not see a Mine offer");
});

test("the offers list leaves out an AI account's key and an item that is gone or not visible", async () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  // an AI account added with an API key is saved as an api_key item, so the event alone cannot tell it apart
  for (const id of ["vit_acme", "vit_openai", "vit_gone"]) run(ctx as never, { payload: { itemId: id, kind: "api_key", name: `Name ${id}` } });
  const calls: string[] = [];
  const withCall = { ...ctx, call: async (cap: string) => {
    calls.push(cap);
    if (cap === "providers.list") return { providers: [{ id: "prv_1", itemId: "vit_openai" }] };
    if (cap === "vault.items.list") return { items: [{ id: "vit_acme" }, { id: "vit_openai" }] };
    throw new Error(`unexpected ${cap}`);
  } };
  const out = await connectorOffers(withCall as never);
  assert.deepEqual(out.offers.map((o) => o.itemId), ["vit_acme"]);
  assert.deepEqual(calls.sort(), ["providers.list", "vault.items.list"]);
});
