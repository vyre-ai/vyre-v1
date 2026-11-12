// resolveVaultItem (host/src/seams/vault.ts): a handle two people's Mine items share names the asker's own first, then a shared one, so another person's hidden item never shadows one the
// asker may use (lead follow-up 1, 12 Nov: a hidden item must answer as a missing one, and must not stand in front of a usable one).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveVaultItem } from "../src/seams/vault.ts";

const rows = [
  { id: "vit_olivia", name: "Api", handle: "#Api", scope: "mine", owner: "usr_olivia" },
  { id: "vit_noah", name: "Api", handle: "#Api", scope: "mine", owner: "usr_noah" },
  { id: "vit_team", name: "Deploy", handle: "#Deploy", scope: "shared", owner: "usr_olivia" },
  { id: "vit_tess", name: "Deploy", handle: "#Deploy", scope: "mine", owner: "usr_tess" },
];
const db = { all: () => rows };

test("a shared handle resolves to the asker's own Mine item first, then a shared item, before anyone else's", () => {
  assert.equal(resolveVaultItem(db, "vault_item", "handle", "#Api.key", "usr_noah"), "vit_noah");
  assert.equal(resolveVaultItem(db, "vault_item", "handle", "#Api.key", "usr_olivia"), "vit_olivia");
  assert.equal(resolveVaultItem(db, "vault_item", "handle", "#Deploy.key", "usr_noah"), "vit_team", "a shared item before another person's Mine item");
  assert.equal(resolveVaultItem(db, "vault_item", "handle", "#Deploy.key", "usr_tess"), "vit_tess");
  assert.equal(resolveVaultItem(db, "vault_item", "handle", "#Nothing.key", "usr_noah"), null);
  assert.equal(resolveVaultItem(db, "vault_item", "name", "Deploy", "usr_noah"), "vit_team");
});
