import test from "node:test";
import assert from "node:assert/strict";
import { BRING_IN_OPENING, appNameOf, editMappingOpening, syncOpening } from "./opening.ts";

test("Sync to Records names the app and the handle and never a value", () => {
  assert.equal(syncOpening({ name: "  Lawmatics  ", handle: "#Dana_Lawmatics" }), "Sync Lawmatics to Records. Vault handle #Dana_Lawmatics. Load the crm-sync-builder skill. Never ask for the key.");
  const leaked = syncOpening({ name: "sk_live_ABCDEF123456", handle: "#X" });
  assert.equal(leaked.includes("sk_live"), false);
  assert.match(leaked, /Sync this app to Records/);
  assert.equal(appNameOf("x".repeat(80)).length, 60);
});

test("the other two openings load the skill and keep a key out of chat", () => {
  assert.match(BRING_IN_OPENING, /Load the crm-sync-builder skill/);
  assert.match(BRING_IN_OPENING, /Never ask me to paste a key/);
  assert.equal(editMappingOpening({ app: "Ledger", type: "person" }), "Change how Ledger syncs to Records. Record type person. Read the spec with sync_specs_get, change it, check it with sync_specs_validate and apply it again. Load the crm-sync-builder skill.");
});
