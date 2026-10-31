// The setup offer is made only for a saved item that can be an app: a key, an env block, a login or a loose item. Cards, notes, codes, SSH keys and AI accounts make none.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";
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
